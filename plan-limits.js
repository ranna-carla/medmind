'use strict';

const https = require('https');

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------

const PLANS = {
  free: {
    modulesMax: 3,
    revisionsMax: 5,
    flashdecksMax: 10,
    feedbacksMaxPerDay: 10,
  },
  plus: {
    modulesMax: 10,
    revisionsMax: 15,
    flashdecksMax: 30,
    feedbacksMaxPerDay: 30,
  },
  pro: {
    modulesMax: 999999,
    revisionsMax: 999999,
    flashdecksMax: 999999,
    feedbacksMaxPerDay: 999999,
  },
};

// Fair-use caps applied to pro users
const FAIR_USE = {
  revisionsMax: 50,
  modulesMax: 100,
};

// ---------------------------------------------------------------------------
// Firebase / Firestore constants
// ---------------------------------------------------------------------------

const FIREBASE_PROJECT = 'medmind-pro';
const FIREBASE_API_KEY = 'AIzaSyCvoPA9OOC3o42ERViKs1IjRIOuwOon0UU';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Perform an HTTP GET and return parsed JSON.
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

/**
 * Perform an HTTP PATCH (update) to Firestore REST.
 */
function httpPatch(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Convert a Firestore REST document to a plain JS object.
 */
function docToJS(firestoreDoc) {
  if (!firestoreDoc || !firestoreDoc.fields) return {};
  const result = {};
  for (const [key, value] of Object.entries(firestoreDoc.fields)) {
    result[key] = parseFirestoreValue(value);
  }
  return result;
}

function parseFirestoreValue(value) {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
  if (value.doubleValue !== undefined) return parseFloat(value.doubleValue);
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.nullValue !== undefined) return null;
  if (value.timestampValue !== undefined) return new Date(value.timestampValue);
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values || []).map(parseFirestoreValue);
  }
  if (value.mapValue !== undefined) {
    return docToJS(value.mapValue);
  }
  return undefined;
}

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function jsToFirestoreDoc(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return { fields };
}

// ---------------------------------------------------------------------------
// Firestore REST helpers
// ---------------------------------------------------------------------------

/**
 * GET a Firestore document via REST API.
 * @param {string} collection
 * @param {string} docId
 * @param {string} [idToken] - optional Firebase ID token for auth
 */
async function firestoreGet(collection, docId, idToken) {
  let url = `${FIRESTORE_BASE}/${collection}/${docId}?key=${FIREBASE_API_KEY}`;
  if (idToken) {
    // Append auth token as header is not trivially supported in plain https.get,
    // so we encode it as a custom bearer approach via fetch-like wrapper
    url = `${FIRESTORE_BASE}/${collection}/${docId}?key=${FIREBASE_API_KEY}`;
  }
  const { status, body } = await httpGet(url);
  if (status === 404 || (body && body.error && body.error.code === 404)) {
    return null;
  }
  if (status !== 200) {
    throw new Error(`Firestore GET failed (${status}): ${JSON.stringify(body)}`);
  }
  return body;
}

/**
 * PATCH (update) a Firestore document via REST API.
 */
async function firestorePatch(collection, docId, data) {
  const doc = jsToFirestoreDoc(data);
  const fieldPaths = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const url = `${FIRESTORE_BASE}/${collection}/${docId}?key=${FIREBASE_API_KEY}&${fieldPaths}`;
  const { status, body } = await httpPatch(url, doc);
  if (status !== 200) {
    throw new Error(`Firestore PATCH failed (${status}): ${JSON.stringify(body)}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function thisMonthStr() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// ---------------------------------------------------------------------------
// Default subscription shape
// ---------------------------------------------------------------------------

function defaultSub(userId) {
  return {
    userId,
    plan: 'free',
    modulesUsed: 0,
    revisionsUsed: 0,
    flashdecksUsed: 0,
    feedbacksUsedToday: 0,
    feedbacksUsedTotal: 0,
    lastFeedbackDay: todayStr(),
    lastResetMonth: thisMonthStr(),
  };
}

// ---------------------------------------------------------------------------
// getSubscription
// ---------------------------------------------------------------------------

/**
 * Read subscription from Firestore. Returns default free sub if not found.
 * Applies daily reset for feedbacks and monthly reset for revisions/modules/flashdecks.
 *
 * @param {string} userId
 * @param {string} [idToken]
 * @returns {Promise<object>} subscription object
 */
async function getSubscription(userId, idToken) {
  let sub;
  try {
    const doc = await firestoreGet('subscriptions', userId, idToken);
    if (!doc) {
      sub = defaultSub(userId);
    } else {
      sub = { ...defaultSub(userId), ...docToJS(doc) };
    }
  } catch (err) {
    console.error('[plan-limits] getSubscription error:', err.message);
    sub = defaultSub(userId);
  }

  const today = todayStr();
  const thisMonth = thisMonthStr();
  const updates = {};

  // Daily reset for feedbacks
  if (sub.lastFeedbackDay !== today) {
    sub.feedbacksUsedToday = 0;
    sub.lastFeedbackDay = today;
    updates.feedbacksUsedToday = 0;
    updates.lastFeedbackDay = today;
  }

  // Monthly reset for revisions, modules, flashdecks
  if (sub.lastResetMonth !== thisMonth) {
    sub.revisionsUsed = 0;
    sub.modulesUsed = 0;
    sub.flashdecksUsed = 0;
    sub.lastResetMonth = thisMonth;
    updates.revisionsUsed = 0;
    updates.modulesUsed = 0;
    updates.flashdecksUsed = 0;
    updates.lastResetMonth = thisMonth;
  }

  // Persist resets if anything changed
  if (Object.keys(updates).length > 0) {
    try {
      await firestorePatch('subscriptions', userId, updates);
    } catch (err) {
      console.error('[plan-limits] persist reset error:', err.message);
    }
  }

  return sub;
}

// ---------------------------------------------------------------------------
// checkLimit
// ---------------------------------------------------------------------------

/**
 * Check whether the user has reached the limit for a given feature.
 *
 * @param {string} feature - 'modules' | 'revisions' | 'flashdecks' | 'feedbacks'
 * @param {object} sub - subscription object from getSubscription
 * @returns {null | {error: string, feature: string, used: number, max: number, plan: string}}
 */
function checkLimit(feature, sub) {
  const plan = sub.plan || 'free';
  const planDef = PLANS[plan] || PLANS.free;

  let max;
  let used;

  switch (feature) {
    case 'modules':
      max = plan === 'pro' ? FAIR_USE.modulesMax : planDef.modulesMax;
      used = sub.modulesUsed || 0;
      break;
    case 'revisions':
      max = plan === 'pro' ? FAIR_USE.revisionsMax : planDef.revisionsMax;
      used = sub.revisionsUsed || 0;
      break;
    case 'flashdecks':
      max = planDef.flashdecksMax;
      used = sub.flashdecksUsed || 0;
      break;
    case 'feedbacks':
      max = planDef.feedbacksMaxPerDay;
      used = sub.feedbacksUsedToday || 0;
      break;
    default:
      return null;
  }

  if (used >= max) {
    return {
      error: 'limit_reached',
      feature,
      used,
      max,
      plan,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// incrementUsage
// ---------------------------------------------------------------------------

/**
 * Increment usage counter for a feature on the sub object (in-memory only).
 * Caller is responsible for persisting via firestorePatch if needed.
 *
 * For feedbacks: increments feedbacksUsedToday first, then feedbacksUsedTotal.
 *
 * @param {string} feature - 'modules' | 'revisions' | 'flashdecks' | 'feedbacks'
 * @param {object} sub - subscription object (mutated in place)
 * @returns {object} the updated sub
 */
function incrementUsage(feature, sub) {
  switch (feature) {
    case 'modules':
      sub.modulesUsed = (sub.modulesUsed || 0) + 1;
      break;
    case 'revisions':
      sub.revisionsUsed = (sub.revisionsUsed || 0) + 1;
      break;
    case 'flashdecks':
      sub.flashdecksUsed = (sub.flashdecksUsed || 0) + 1;
      break;
    case 'feedbacks':
      sub.feedbacksUsedToday = (sub.feedbacksUsedToday || 0) + 1;
      sub.feedbacksUsedTotal = (sub.feedbacksUsedTotal || 0) + 1;
      break;
    default:
      break;
  }
  return sub;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  PLANS,
  FAIR_USE,
  getSubscription,
  checkLimit,
  incrementUsage,
  firestoreGet,
  docToJS,
};
