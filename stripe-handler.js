/**
 * stripe-handler.js
 * Handles Stripe checkout, webhooks, and portal for MedMind Plus subscriptions.
 */

const fs = require('fs');
const path = require('path');

// Load env vars from .env file in same directory
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// Initialize Firebase Admin SDK
const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'medmind-pro' });
}
const db = admin.firestore();

// Initialize Stripe (lazy — actual API calls will fail without a valid key)
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[stripe-handler] WARNING: STRIPE_SECRET_KEY is not configured.');
}
const StripeLib = require('stripe');
const stripe = process.env.STRIPE_SECRET_KEY
  ? StripeLib(process.env.STRIPE_SECRET_KEY)
  : new Proxy({}, {
      get: () => () => { throw new Error('[stripe-handler] STRIPE_SECRET_KEY is not configured.'); },
    });

/**
 * Firestore write via Admin SDK (bypasses security rules).
 * @param {string} collection
 * @param {string} docId
 * @param {object} fields
 */
async function firestoreSet(collection, docId, fields) {
  await db.collection(collection).doc(docId).set(fields, { merge: true });
}

/**
 * Check if a Stripe event has already been processed (idempotency).
 * @param {string} eventId
 * @returns {Promise<boolean>}
 */
async function isEventProcessed(eventId) {
  const doc = await db.collection('stripe_events').doc(eventId).get();
  return doc.exists;
}

/**
 * Mark a Stripe event as processed.
 * @param {string} eventId
 */
async function markEventProcessed(eventId) {
  await db.collection('stripe_events').doc(eventId).set({
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Create a Stripe Checkout session for a subscription.
 * @param {object} params
 * @param {string} params.plan - 'plus' or 'pro'
 * @param {string} params.userId
 * @param {string} params.userEmail
 * @param {string} params.successUrl
 * @param {string} params.cancelUrl
 * @returns {Promise<{ sessionId: string, url: string }>}
 */
async function createCheckoutSession({ plan, userId, userEmail, successUrl, cancelUrl }) {
  const priceMap = {
    plus: process.env.STRIPE_PRICE_PLUS,
    pro: process.env.STRIPE_PRICE_PRO,
  };

  const priceId = priceMap[plan];
  if (!priceId) {
    throw new Error(`[stripe-handler] No price configured for plan: ${plan}`);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    client_reference_id: userId,
    customer_email: userEmail,
    metadata: { userId, plan },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return { sessionId: session.id, url: session.url };
}

/**
 * Create a Stripe Billing Portal session.
 * @param {object} params
 * @param {string} params.stripeCustomerId
 * @param {string} params.returnUrl
 * @returns {Promise<{ url: string }>}
 */
async function createPortalSession({ stripeCustomerId, returnUrl }) {
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });

  return { url: session.url };
}

/**
 * Process a verified Stripe event, with idempotency checks.
 * @param {object} event - Stripe event object
 */
async function processStripeEvent(event) {
  const alreadyProcessed = await isEventProcessed(event.id);
  if (alreadyProcessed) {
    console.log(`[stripe-handler] Event ${event.id} already processed, skipping.`);
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId || session.client_reference_id;
      const plan = session.metadata?.plan || 'plus';
      const customerId = session.customer;
      const subscriptionId = session.subscription;

      if (!userId) {
        console.warn('[stripe-handler] checkout.session.completed: missing userId in metadata.');
        break;
      }

      await firestoreSet('users', userId, {
        subscription: {
          plan,
          status: 'active',
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        usage: {
          flashcardsGenerated: 0,
          quizzesTaken: 0,
          duelsPlayed: 0,
          arenasJoined: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });

      console.log(`[stripe-handler] Subscription created for user ${userId} on plan ${plan}.`);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      // Find the user by stripeCustomerId
      const usersSnap = await db
        .collection('users')
        .where('subscription.stripeCustomerId', '==', customerId)
        .limit(1)
        .get();

      if (usersSnap.empty) {
        console.warn(`[stripe-handler] customer.subscription.deleted: no user found for customer ${customerId}.`);
        break;
      }

      const userDoc = usersSnap.docs[0];
      await firestoreSet('users', userDoc.id, {
        subscription: {
          plan: 'free',
          status: 'canceled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });

      console.log(`[stripe-handler] Subscription canceled, user ${userDoc.id} downgraded to free.`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.warn(
        `[stripe-handler] Payment failed for customer ${invoice.customer}, invoice ${invoice.id}.`
      );
      break;
    }

    default:
      console.log(`[stripe-handler] Unhandled event type: ${event.type}`);
  }

  await markEventProcessed(event.id);
}

/**
 * Verify a Stripe webhook signature and return the event.
 * @param {Buffer|string} rawBody
 * @param {string} signature - Value of stripe-signature header
 * @returns {object} Stripe event
 */
function verifyWebhook(rawBody, signature) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('[stripe-handler] STRIPE_WEBHOOK_SECRET is not configured.');
  }
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

module.exports = {
  createCheckoutSession,
  createPortalSession,
  processStripeEvent,
  verifyWebhook,
};
