# MedMind Plus — Planos + IA Local + Landing Page — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3-tier subscription system (Free/Plus/Pro) with Ollama local AI for Free tier, Haiku API for paid tiers, Stripe payments, usage limits, and in-app landing page.

**Architecture:** AI Router pattern — a single `ai-router.js` dispatches AI calls to Ollama (Free) or Haiku API (Plus/Pro) based on user plan. Plan middleware checks usage limits before every AI call. Stripe webhooks manage subscription lifecycle. Landing page integrated into `index.html`.

**Tech Stack:** Node.js, Firebase Firestore, Firebase Admin SDK, Ollama (qwen2.5:7b), Anthropic Haiku API, Stripe, Vanilla JS/HTML5 PWA

**Spec:** `docs/superpowers/specs/2026-03-27-planos-ia-local-landing-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `ollama-client.js` | Translates Anthropic-format payloads to Ollama HTTP API at localhost:11434. Returns Anthropic-shaped responses. |
| `ai-router.js` | Routes AI calls by plan (Free→Ollama, Plus→Haiku+delay, Pro→Haiku). Exports `callAI({plan, feature, payload})`. |
| `plan-limits.js` | Plan definitions, limit checking, usage increment, daily/monthly reset, accumulation logic. |
| `stripe-handler.js` | Stripe checkout session creation, webhook processing, portal session, idempotency. |
| `setup-ollama.sh` | Installs Ollama, pulls qwen2.5:7b, verifies health. |
| `.env.example` | Documents required env vars (Stripe keys). |

### Modified Files
| File | Changes |
|------|---------|
| `server.js` | Add `verifyUserToken()`, import ai-router + plan-limits + stripe-handler, replace 7 `callAnthropic()` calls, add 4 Stripe endpoints, add raw body handler for webhooks, add Ollama health check to start. |
| `flashcard-server.js` | Import ai-router, replace 3 `callAnthropic()` calls. |
| `index.html` | Add landing page section, plan badges, usage bar, upgrade modals, upsell during generation, Stripe.js checkout. |
| `firestore.rules` | Add `subscriptions/{userId}` (read: owner/admin, write: false) and `stripe_events/{eventId}` (read/write: false). |
| `start.sh` | Add Ollama health check before Node.js startup. |
| `package.json` | Add `pdf-parse`, `stripe`, `firebase-admin` dependencies. |

---

## Chunk 1: Ollama Client + AI Router (Backend Core)

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pdf-parse, stripe, and firebase-admin**

```bash
cd /Users/macmini-win7/projects/projects/medmindplus
npm install pdf-parse stripe firebase-admin
```

- [ ] **Step 2: Verify package.json updated**

```bash
cat package.json | grep -E "pdf-parse|stripe|firebase-admin"
```

Expected: all three dependencies listed.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: adicionar pdf-parse e stripe"
```

---

### Task 2: Create ollama-client.js

**Files:**
- Create: `ollama-client.js`

- [ ] **Step 1: Create the Ollama client**

```javascript
// ollama-client.js — Translates Anthropic-format calls to Ollama API
const http = require('http');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'localhost';
const OLLAMA_PORT = parseInt(process.env.OLLAMA_PORT || '11434');
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

// Concurrency control — max 1 Ollama request at a time (Mac Mini M2 16GB constraint)
let ollamaQueue = Promise.resolve();
let queueLength = 0;

function getQueuePosition() { return queueLength; }

function enqueue(fn) {
  queueLength++;
  const p = ollamaQueue.then(fn).finally(() => { queueLength--; });
  ollamaQueue = p.catch(() => {}); // prevent unhandled rejection chain
  return p;
}

/**
 * Check if Ollama is reachable and model is loaded.
 * @returns {Promise<boolean>}
 */
function isOllamaHealthy() {
  return new Promise(resolve => {
    const req = http.request({
      hostname: OLLAMA_HOST, port: OLLAMA_PORT,
      path: '/api/tags', method: 'GET', timeout: 3000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const hasModel = (data.models || []).some(m => m.name.startsWith(DEFAULT_MODEL.split(':')[0]));
          resolve(res.statusCode === 200 && hasModel);
        } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/**
 * Call Ollama with Anthropic-shaped payload, return Anthropic-shaped response.
 * @param {object} payload - { model?, max_tokens, temperature, system, messages }
 * @param {number} [timeoutMs=900000] - timeout in ms (default 15min)
 * @returns {Promise<object>} Anthropic-compatible response
 */
function callOllama(payload, timeoutMs = 900000) {
  return new Promise((resolve, reject) => {
    const model = payload.model || DEFAULT_MODEL;

    // Build Ollama messages array
    const messages = [];
    if (payload.system) {
      messages.push({ role: 'system', content: payload.system });
    }
    for (const msg of (payload.messages || [])) {
      let content;
      if (Array.isArray(msg.content)) {
        // Anthropic format: [{type:"text", text:"..."}, {type:"document",...}]
        // Ollama: concatenate text parts only, skip documents
        content = msg.content
          .filter(p => p.type === 'text')
          .map(p => p.text)
          .join('\n\n');
      } else {
        content = msg.content;
      }
      messages.push({ role: msg.role, content });
    }

    // Detect if we should force JSON output
    const wantsJson = (payload.system || '').toLowerCase().includes('json');

    const ollamaPayload = {
      model,
      messages,
      stream: false,
      options: {
        temperature: payload.temperature ?? 0,
        num_predict: payload.max_tokens || 4096,
      },
    };
    if (wantsJson) ollamaPayload.format = 'json';

    const body = JSON.stringify(ollamaPayload);

    const req = http.request({
      hostname: OLLAMA_HOST, port: OLLAMA_PORT,
      path: '/api/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (data.error) return reject(new Error('Ollama: ' + data.error));
          // Return Anthropic-shaped response
          resolve({
            content: [{ type: 'text', text: data.message?.content || '' }],
            usage: {
              input_tokens: data.prompt_eval_count || 0,
              output_tokens: data.eval_count || 0,
            },
            stop_reason: data.done_reason || 'end_turn',
            model: data.model || model,
          });
        } catch (e) { reject(new Error('Ollama parse error: ' + e.message)); }
      });
    });

    req.on('error', err => reject(new Error('Ollama connection error: ' + err.message)));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Ollama timeout (${Math.round(timeoutMs/1000)}s). A IA local esta demorando mais que o esperado.`));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Queued version of callOllama — serializes requests to prevent memory issues.
 */
function callOllamaQueued(payload, timeoutMs = 900000) {
  return enqueue(() => callOllama(payload, timeoutMs));
}

module.exports = { callOllama: callOllamaQueued, isOllamaHealthy, getQueuePosition, DEFAULT_MODEL };
```

- [ ] **Step 2: Verify file created**

```bash
node -e "const o = require('./ollama-client.js'); console.log(typeof o.callOllama, typeof o.isOllamaHealthy);"
```

Expected: `function function`

- [ ] **Step 3: Commit**

```bash
git add ollama-client.js
git commit -m "feat: criar ollama-client.js — camada de abstracao Ollama"
```

---

### Task 3: Create ai-router.js

**Files:**
- Create: `ai-router.js`

- [ ] **Step 1: Create the AI Router**

```javascript
// ai-router.js — Routes AI calls by user plan
const https = require('https');
const fs = require('fs');
const { callOllama, isOllamaHealthy, getQueuePosition } = require('./ollama-client');

// ---- Config ----
const PLAN_ENGINES = {
  free:  'ollama',
  plus:  'haiku',
  pro:   'haiku',
};

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Delay artificial: Plus recebe resultado apos 20% do tempo estimado do Free
const FREE_TIME_ESTIMATES_MS = {
  module:     20 * 60 * 1000,  // 20 min
  quiz:       15 * 60 * 1000,  // 15 min
  revision:   15 * 60 * 1000,  // 15 min
  flashcards: 8 * 60 * 1000,   // 8 min
  feedback:   20 * 1000,        // 20 seg
};
const PLUS_DELAY_FACTOR = 0.20;

// ---- Anthropic API key ----
function getAnthropicKey() {
  try {
    const env = fs.readFileSync('/Users/macmini-win7/projects/projects/imagex-ris/.env', 'utf8');
    const m = env.match(/ANTHROPIC_API_KEY=(.+)/);
    if (m && m[1].trim().startsWith('sk-ant-')) return m[1].trim();
  } catch {}
  try {
    const env = fs.readFileSync('/etc/claude-hub/api-keys.env', 'utf8');
    const m = env.match(/ANTHROPIC_API_KEY_PRODUCAO=(.+)/);
    if (m) return m[1].trim();
  } catch {}
  return '';
}

// ---- Haiku API call (with prompt caching) ----
function callHaiku(payload) {
  return new Promise((resolve, reject) => {
    // Add cache_control to system prompt for Anthropic prompt caching (90% cheaper on cached reads)
    const systemWithCache = payload.system ? [
      { type: 'text', text: payload.system, cache_control: { type: 'ephemeral' } }
    ] : undefined;

    const body = JSON.stringify({
      ...payload,
      model: HAIKU_MODEL,
      system: systemWithCache || payload.system,
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getAnthropicKey(),
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(300000, () => { req.destroy(); reject(new Error('Haiku API timeout (5min)')); });
    req.write(body);
    req.end();
  });
}

// ---- Cost logging ----
const COST_LOG_PATH = require('path').join(__dirname, 'logs', 'api-costs.jsonl');
const PRICING = {
  'ollama':  { input: 0, output: 0 },
  [HAIKU_MODEL]: { input: 0.80, output: 4.00 },
};

function logCost({ model, feature, inputTokens, outputTokens, userId, jobId, plan }) {
  try {
    const p = PRICING[model] || PRICING[HAIKU_MODEL];
    const costUsd = (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
    fs.appendFileSync(COST_LOG_PATH, JSON.stringify({
      ts: new Date().toISOString(), model, feature, plan: plan || 'unknown',
      inputTokens, outputTokens,
      costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
      userId: userId || null, jobId: jobId || null,
    }) + '\n');
  } catch (e) { console.error('[cost-log]', e.message); }
}

/**
 * Main entry point. Routes AI call based on user plan.
 * @param {object} opts
 * @param {string} opts.plan - 'free' | 'plus' | 'pro'
 * @param {string} opts.feature - 'module' | 'quiz' | 'revision' | 'flashcards' | 'feedback'
 * @param {object} opts.payload - Anthropic-format payload (model, max_tokens, temperature, system, messages)
 * @param {string} [opts.userId]
 * @param {string} [opts.jobId]
 * @returns {Promise<{result: object, deliverAt: number|null}>}
 *   result: Anthropic-shaped response
 *   deliverAt: timestamp when Plus results should be delivered (null for Free/Pro)
 */
async function callAI({ plan, feature, payload, userId, jobId }) {
  const engine = PLAN_ENGINES[plan] || 'ollama';
  let result;

  if (engine === 'ollama') {
    const healthy = await isOllamaHealthy();
    if (!healthy) {
      throw new Error('ai_unavailable|IA local temporariamente indisponivel. Tente novamente em alguns minutos ou faca upgrade para Plus.');
    }
    // Ollama — strip PDF base64, use text only
    result = await callOllama(payload, 900000);
    logCost({ model: 'ollama', feature, inputTokens: result.usage?.input_tokens || 0, outputTokens: result.usage?.output_tokens || 0, userId, jobId, plan });
    return { result, deliverAt: null };
  }

  // Haiku (Plus and Pro)
  result = await callHaiku(payload);
  logCost({ model: HAIKU_MODEL, feature, inputTokens: result.usage?.input_tokens || 0, outputTokens: result.usage?.output_tokens || 0, userId, jobId, plan });

  // Plus: calculate delivery timestamp (delay)
  let deliverAt = null;
  if (plan === 'plus' && feature !== 'feedback') {
    const estimatedFreeMs = FREE_TIME_ESTIMATES_MS[feature] || 600000;
    deliverAt = Date.now() + Math.round(estimatedFreeMs * PLUS_DELAY_FACTOR);
  }

  return { result, deliverAt };
}

module.exports = { callAI, callHaiku, getAnthropicKey, HAIKU_MODEL, logCost };
```

- [ ] **Step 2: Verify file loads**

```bash
node -e "const r = require('./ai-router.js'); console.log(typeof r.callAI);"
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add ai-router.js
git commit -m "feat: criar ai-router.js — roteamento de IA por plano"
```

---

### Task 4: Create plan-limits.js

**Files:**
- Create: `plan-limits.js`

- [ ] **Step 1: Create the plan limits module**

```javascript
// plan-limits.js — Plan definitions, limit checking, usage tracking
const https = require('https');
const FIREBASE_API_KEY = 'AIzaSyCvoPA9OOC3o42ERViKs1IjRIOuwOon0UU';
const FIREBASE_PROJECT = 'medmind-pro';

// ---- Plan definitions ----
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
    modulesMax: 999999,  // "unlimited" with fair-use
    revisionsMax: 999999,
    flashdecksMax: 999999,
    feedbacksMaxPerDay: 999999,
  },
};

// Fair-use thresholds for Pro
const FAIR_USE = {
  revisionsMax: 50,
  modulesMax: 100,
};

// ---- Firestore helpers (using user's idToken) ----
function firestoreGet(collection, docId, idToken) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${collection}/${docId}`,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + idToken },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode === 404) return resolve(null);
        try {
          const json = JSON.parse(text);
          if (json.error) return resolve(null);
          resolve(json);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// Parse Firestore value to JS
function fromFirestoreValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) {
    const obj = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) obj[k] = fromFirestoreValue(val);
    return obj;
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ('timestampValue' in v) return v.timestampValue;
  return null;
}

// Convert Firestore doc to plain JS
function docToJS(firestoreDoc) {
  if (!firestoreDoc?.fields) return null;
  const obj = {};
  for (const [k, v] of Object.entries(firestoreDoc.fields)) obj[k] = fromFirestoreValue(v);
  return obj;
}

/**
 * Get or create user's subscription doc.
 * @returns {object} { plan, usage, ... }
 */
async function getSubscription(userId, idToken) {
  const doc = await firestoreGet('subscriptions', userId, idToken);
  if (doc) {
    const sub = docToJS(doc);
    if (sub) {
      // Apply daily/monthly resets on read
      const today = new Date().toISOString().slice(0, 10);
      const thisMonth = today.slice(0, 7);
      let needsUpdate = false;

      if (!sub.usage) sub.usage = {};

      // Daily reset
      if (sub.usage.lastDailyReset !== today) {
        const plan = PLANS[sub.plan] || PLANS.free;
        const unused = Math.max(0, (plan.feedbacksMaxPerDay || 0) - (sub.usage.feedbacksUsedToday || 0));
        sub.usage.feedbacksAccumulated = Math.min(
          (sub.usage.feedbacksAccumulated || 0) + unused,
          plan.feedbacksMaxPerDay * 30
        );
        sub.usage.feedbacksUsedToday = 0;
        sub.usage.lastDailyReset = today;
        needsUpdate = true;
      }

      // Monthly reset
      if (sub.usage.lastMonthlyReset !== thisMonth) {
        sub.usage.modulesUsed = 0;
        sub.usage.revisionsUsed = 0;
        sub.usage.flashdecksUsed = 0;
        sub.usage.feedbacksAccumulated = 0;
        sub.usage.lastMonthlyReset = thisMonth;
        needsUpdate = true;
      }

      // Persist resets via Admin SDK
      if (needsUpdate) {
        try {
          const admin = require('firebase-admin');
          const db = admin.firestore();
          await db.collection('subscriptions').doc(userId).set({ usage: sub.usage, updatedAt: new Date().toISOString() }, { merge: true });
        } catch (e) { console.error('[plan-limits] Failed to persist reset:', e.message); }
      }
      return sub;
    }
  }

  // No subscription found — return default free plan
  return {
    plan: 'free',
    status: 'active',
    usage: {
      modulesUsed: 0, revisionsUsed: 0, flashdecksUsed: 0,
      feedbacksUsedToday: 0, feedbacksAccumulated: 0,
      lastDailyReset: new Date().toISOString().slice(0, 10),
      lastMonthlyReset: new Date().toISOString().slice(0, 7),
    },
  };
}

/**
 * Check if user can perform an action. Returns null if OK, or error object.
 * @param {string} feature - 'module' | 'revision' | 'flashdeck' | 'feedback'
 * @param {object} sub - subscription object from getSubscription()
 */
function checkLimit(feature, sub) {
  const plan = PLANS[sub.plan] || PLANS.free;
  const usage = sub.usage || {};

  switch (feature) {
    case 'module':
      if ((usage.modulesUsed || 0) >= plan.modulesMax) {
        return { error: 'limit_reached', feature, used: usage.modulesUsed, max: plan.modulesMax, upgrade: true };
      }
      // Pro fair-use
      if (sub.plan === 'pro' && (sub.fairUse?.modulesThisMonth || 0) >= FAIR_USE.modulesMax) {
        return { error: 'fair_use', feature, message: 'Limite de uso justo atingido. Tente novamente amanha.' };
      }
      break;
    case 'revision':
      if ((usage.revisionsUsed || 0) >= plan.revisionsMax) {
        return { error: 'limit_reached', feature, used: usage.revisionsUsed, max: plan.revisionsMax, upgrade: true };
      }
      if (sub.plan === 'pro' && (sub.fairUse?.revisionsThisMonth || 0) >= FAIR_USE.revisionsMax) {
        return { error: 'fair_use', feature, message: 'Limite de uso justo atingido. Tente novamente amanha.' };
      }
      break;
    case 'flashdeck':
      if ((usage.flashdecksUsed || 0) >= plan.flashdecksMax) {
        return { error: 'limit_reached', feature, used: usage.flashdecksUsed, max: plan.flashdecksMax, upgrade: true };
      }
      break;
    case 'feedback': {
      const dailyLeft = Math.max(0, plan.feedbacksMaxPerDay - (usage.feedbacksUsedToday || 0));
      const accumulated = usage.feedbacksAccumulated || 0;
      if (dailyLeft + accumulated <= 0) {
        return { error: 'limit_reached', feature, used: usage.feedbacksUsedToday, max: plan.feedbacksMaxPerDay, upgrade: true };
      }
      break;
    }
  }
  return null; // OK
}

/**
 * Increment usage counter after successful AI call.
 * @returns {object} updated usage
 */
function incrementUsage(feature, sub) {
  if (!sub.usage) sub.usage = {};
  switch (feature) {
    case 'module':
      sub.usage.modulesUsed = (sub.usage.modulesUsed || 0) + 1;
      if (sub.fairUse) sub.fairUse.modulesThisMonth = (sub.fairUse.modulesThisMonth || 0) + 1;
      break;
    case 'revision':
      sub.usage.revisionsUsed = (sub.usage.revisionsUsed || 0) + 1;
      if (sub.fairUse) sub.fairUse.revisionsThisMonth = (sub.fairUse.revisionsThisMonth || 0) + 1;
      break;
    case 'flashdeck':
      sub.usage.flashdecksUsed = (sub.usage.flashdecksUsed || 0) + 1;
      break;
    case 'feedback': {
      const plan = PLANS[sub.plan] || PLANS.free;
      if ((sub.usage.feedbacksUsedToday || 0) < plan.feedbacksMaxPerDay) {
        sub.usage.feedbacksUsedToday = (sub.usage.feedbacksUsedToday || 0) + 1;
      } else {
        // Consume from accumulated
        sub.usage.feedbacksAccumulated = Math.max(0, (sub.usage.feedbacksAccumulated || 0) - 1);
      }
      break;
    }
  }
  return sub.usage;
}

module.exports = { PLANS, FAIR_USE, getSubscription, checkLimit, incrementUsage, firestoreGet, docToJS };
```

- [ ] **Step 2: Verify file loads**

```bash
node -e "const p = require('./plan-limits.js'); console.log(Object.keys(p.PLANS));"
```

Expected: `[ 'free', 'plus', 'pro' ]`

- [ ] **Step 3: Commit**

```bash
git add plan-limits.js
git commit -m "feat: criar plan-limits.js — definicoes de planos e controle de limites"
```

---

## Chunk 2: Stripe Handler + Auth + server.js Integration

### Task 5: Create stripe-handler.js

**Files:**
- Create: `stripe-handler.js`

- [ ] **Step 1: Create .env.example with required vars**

Create `.env.example`:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_PRICE_PLUS=price_...
STRIPE_PRICE_PRO=price_...
GOOGLE_APPLICATION_CREDENTIALS=/path/to/medmind-pro-service-account.json
```

**IMPORTANT:** Download a service account key from Firebase Console > Project Settings > Service Accounts > Generate New Private Key. Save as `medmind-pro-service-account.json` (NOT in git).

- [ ] **Step 2: Create the Stripe handler module**

```javascript
// stripe-handler.js — Stripe checkout, webhooks, portal
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load env vars from .env file
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv();

// Firebase Admin SDK for server-side Firestore writes (bypasses security rules)
const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'medmind-pro',
    // Uses Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS env var
    // For Mac Mini: run `gcloud auth application-default login` once
  });
}
const db = admin.firestore();

let stripe;
try {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} catch (e) {
  console.warn('[stripe] Stripe not configured:', e.message);
}

const PRICE_MAP = {
  plus: process.env.STRIPE_PRICE_PLUS,
  pro: process.env.STRIPE_PRICE_PRO,
};

// ---- Firestore write via Admin SDK (server-side, bypasses rules) ----
async function firestoreSet(collection, docId, fields) {
  await db.collection(collection).doc(docId).set(fields, { merge: true });
}

// Check if Stripe event was already processed (idempotency)
async function isEventProcessed(eventId) {
  const doc = await db.collection('stripe_events').doc(eventId).get();
  return doc.exists;
}

async function markEventProcessed(eventId) {
  await db.collection('stripe_events').doc(eventId).set({ processedAt: new Date().toISOString() });
}

/**
 * Create Stripe Checkout Session
 */
async function createCheckoutSession({ plan, userId, userEmail, successUrl, cancelUrl }) {
  if (!stripe) throw new Error('Stripe nao configurado');
  const priceId = PRICE_MAP[plan];
  if (!priceId) throw new Error('Plano invalido: ' + plan);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl || 'https://medmind.win7med.com.br/?checkout=success',
    cancel_url: cancelUrl || 'https://medmind.win7med.com.br/?checkout=cancel',
    client_reference_id: userId,
    customer_email: userEmail,
    metadata: { userId, plan },
  });

  return { sessionId: session.id, url: session.url };
}

/**
 * Create Stripe Customer Portal session
 */
async function createPortalSession({ stripeCustomerId, returnUrl }) {
  if (!stripe) throw new Error('Stripe nao configurado');
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl || 'https://medmind.win7med.com.br/',
  });
  return { url: session.url };
}

/**
 * Process Stripe webhook event
 */
async function processStripeEvent(event) {
  console.log('[stripe-webhook]', event.type, event.id);

  // Idempotency: skip if already processed
  if (await isEventProcessed(event.id)) {
    console.log('[stripe-webhook] Event already processed:', event.id);
    return;
  }
  await markEventProcessed(event.id);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.client_reference_id || session.metadata?.userId;
      const plan = session.metadata?.plan || 'plus';
      if (!userId) { console.error('[stripe] No userId in session'); return; }

      const today = new Date().toISOString().slice(0, 10);
      const thisMonth = today.slice(0, 7);

      await firestoreSet('subscriptions', userId, {
        plan,
        status: 'active',
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: '', // will be set by invoice.paid
        usage: {
          modulesUsed: 0, revisionsUsed: 0, flashdecksUsed: 0,
          feedbacksUsedToday: 0, feedbacksAccumulated: 0,
          lastDailyReset: today, lastMonthlyReset: thisMonth,
        },
        fairUse: { revisionsThisMonth: 0, modulesThisMonth: 0 },
        updatedAt: new Date().toISOString(),
      });
      console.log('[stripe] Subscription created for', userId, plan);
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      const sub = invoice.subscription;
      if (!sub) return;
      // Find userId by subscription ID (would need lookup — simplified here)
      console.log('[stripe] Invoice paid for subscription', sub);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;
      if (!userId) { console.error('[stripe] No userId in deleted subscription'); return; }

      await firestoreSet('subscriptions', userId, {
        plan: 'free',
        status: 'canceled',
        updatedAt: new Date().toISOString(),
      });
      console.log('[stripe] Subscription canceled for', userId);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log('[stripe] Payment failed for', invoice.subscription);
      break;
    }
  }
}

/**
 * Verify Stripe webhook signature and return event
 */
function verifyWebhook(rawBody, signature) {
  if (!stripe) throw new Error('Stripe nao configurado');
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

module.exports = { createCheckoutSession, createPortalSession, processStripeEvent, verifyWebhook };
```

- [ ] **Step 3: Commit**

```bash
git add stripe-handler.js .env.example
git commit -m "feat: criar stripe-handler.js — checkout, webhooks, portal"
```

---

### Task 6: Add verifyUserToken to server.js

**Files:**
- Modify: `server.js:228-255`

- [ ] **Step 1: Add verifyUserToken function after verifyAdminToken (line 255)**

Add after line 255 (after `verifyAdminToken` closing brace):

```javascript
// Verifica ID token de qualquer usuario autenticado (nao precisa ser admin)
function verifyUserToken(idToken) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ idToken });
    const req = https.request({
      hostname: 'identitytoolkit.googleapis.com',
      path: `/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          const user = json.users && json.users[0];
          if (!user) return reject(new Error('Token invalido'));
          resolve({ uid: user.localId, email: user.email });
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout ao verificar token')); });
    req.write(body);
    req.end();
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add server.js
git commit -m "feat: adicionar verifyUserToken em server.js"
```

---

### Task 7: Integrate AI Router into server.js

**Files:**
- Modify: `server.js` (lines 1-6, 15-18, 32-45, 97-124, 382-549, 784-806)

This is the largest task — it replaces `callAnthropic` with `callAI` across all 7 call sites.

- [ ] **Step 1: Add imports at top of server.js (after line 5)**

Add after `const path = require('path');`:

```javascript
const { callAI } = require('./ai-router');
const { getSubscription, checkLimit, incrementUsage } = require('./plan-limits');
const { createCheckoutSession, createPortalSession, processStripeEvent, verifyWebhook } = require('./stripe-handler');
```

- [ ] **Step 2: Add local Ollama pricing to PRICING (line 15-18)**

Replace the PRICING object:

```javascript
const PRICING = {
  'claude-sonnet-4-6':          { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001':  { input: 0.80, output: 4.00  },
  'ollama':                     { input: 0, output: 0 },
};
```

- [ ] **Step 3: Comment out getAnthropicKey and callAnthropic (lines 32-124)**

Comment out (do not delete) both functions. They are now in `ai-router.js`:

```javascript
// MOVED TO ai-router.js — kept commented for reference
// function getAnthropicKey() { ... }
// function callAnthropic(payload) { ... }
```

- [ ] **Step 4: Update processJob to use callAI (lines 382-446)**

Replace the `processJob` function. Key changes:
- Accept `plan` parameter
- Use `callAI` instead of `callAnthropic`
- Handle `deliverAt` for Plus delay
- Use pdf-parse for Ollama when pdfBase64 is provided

Add at top of file (after imports):
```javascript
let pdfParse;
try { pdfParse = require('pdf-parse'); } catch {}
```

Replace processJob signature and the two callAnthropic calls (lines 383-413):

```javascript
async function processJob(jobId, { pdfBase64, pdfText, discipline, title, professor, observations }, plan) {
  try {
    jobs[jobId].progress = 'Gerando conteudo e questoes...';

    const ctx = `Disciplina: ${discipline}\nTitulo: ${title}\n${professor ? 'Professor(a): ' + professor + '\n' : ''}${observations ? 'Observacoes: ' + observations + '\n' : ''}`;

    // Trunca texto
    let textContent = pdfText;
    if (!textContent && pdfBase64 && pdfParse) {
      try {
        const buf = Buffer.from(pdfBase64, 'base64');
        const parsed = await pdfParse(buf);
        textContent = parsed.text;
      } catch (e) { console.error('[pdf-parse]', e.message); }
    }
    const truncatedText = textContent && textContent.length > 40000 ? textContent.slice(0, 40000) + '\n\n[...texto truncado]' : textContent;

    // Monta parte do PDF — Ollama so aceita texto, Haiku aceita base64
    const engine = plan === 'free' ? 'ollama' : 'haiku';
    const pdfPart = (engine === 'haiku' && pdfBase64)
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } }
      : { type: 'text', text: 'Conteudo do PDF:\n\n' + (truncatedText || '') };

    // Dispara as duas chamadas
    const contentPromise = callAI({
      plan, feature: 'module', jobId,
      payload: { max_tokens: 20000, temperature: 0, system: PROMPT_CONTENT, messages: [{ role: 'user', content: [pdfPart, { type: 'text', text: 'Gere o modulo para:\n' + ctx }] }] }
    }).then(({ result, deliverAt }) => {
      if (result?.stop_reason === 'max_tokens') throw new Error('PDF muito extenso — envie apenas as paginas mais importantes da aula.');
      jobs[jobId].progress = 'Conteudo pronto, aguardando questoes...';
      if (deliverAt && (!jobs[jobId].deliverAt || deliverAt > jobs[jobId].deliverAt)) jobs[jobId].deliverAt = deliverAt;
      return result;
    });

    const quizPromise = callAI({
      plan, feature: 'quiz', jobId,
      payload: { max_tokens: 14000, temperature: 0, system: PROMPT_QUIZ, messages: [{ role: 'user', content: [pdfPart, { type: 'text', text: 'Gere as questoes para:\n' + ctx }] }] }
    }).then(({ result, deliverAt }) => {
      if (result?.stop_reason === 'max_tokens') throw new Error('PDF muito extenso para gerar todas as questoes.');
      jobs[jobId].progress = 'Questoes prontas!';
      if (deliverAt && (!jobs[jobId].deliverAt || deliverAt > jobs[jobId].deliverAt)) jobs[jobId].deliverAt = deliverAt;
      return result;
    });

    const [contentResult, quizResult] = await Promise.all([contentPromise, quizPromise]);
```

The rest of processJob (lines 417-446) stays the same — it parses JSON and merges quiz into module. Only change: after `jobs[jobId].status = 'ready'`, add delay check:

```javascript
    // If Plus plan, set status to 'delayed' instead of 'ready'
    if (jobs[jobId].deliverAt && Date.now() < jobs[jobId].deliverAt) {
      jobs[jobId].status = 'delayed';
    } else {
      jobs[jobId].status = 'ready';
    }
```

- [ ] **Step 5: Update processRevisionJob to use callAI (lines 452-520)**

Replace `callAnthropic` calls at lines 467, 473, 479 with `callAI`:

```javascript
// Replace each callAnthropic with:
callAI({ plan, feature: 'revision', jobId, payload: { max_tokens: 4096, temperature: 0, system: PROMPT_REV_OBJ, messages: [{ role: 'user', content: topic }] } }).then(({ result }) => { /* same .then logic but use result */ })
```

Same pattern for PROMPT_REV_ESC and PROMPT_REV_PRA calls.

Add `plan` parameter to function signature: `async function processRevisionJob(jobId, topics, plan)`

- [ ] **Step 6: Update processFlashcardJob to use callAI (lines 523-549)**

Replace `callAnthropic` at line 534:

```javascript
async function processFlashcardJob(jobId, topics, qty, moduleContent, plan) {
  // ... existing userMsg logic ...
  const { result } = await callAI({
    plan, feature: 'flashcards', jobId,
    payload: { max_tokens: 8000, temperature: 0, system: PROMPT_FLASHCARDS, messages: [{ role: 'user', content: userMsg }] }
  });
```

- [ ] **Step 7: Update /revision-feedback endpoint to use callAI (lines 784-806)**

Replace `callAnthropic` at line 792:

```javascript
// After verifying user token and getting subscription:
const { result } = await callAI({
  plan: sub.plan, feature: 'feedback',
  payload: { max_tokens: 500, system: PROMPT_FEEDBACK, messages: [{ role: 'user', content: `Pergunta: ${body.question}\n\nResposta esperada: ${body.expectedAnswer}\n\nResposta do aluno: ${body.userAnswer}` }] }
});
```

- [ ] **Step 8: Update /generate-module endpoint to check limits and pass plan (lines 608-627)**

After `const body = await readBody(req);`, add auth and limit check:

```javascript
let user, sub;
try {
  user = await verifyUserToken(body.idToken);
  sub = await getSubscription(user.uid, body.idToken);
} catch { sub = { plan: 'free', usage: {} }; user = { uid: body.userId || 'anon' }; }

const limitErr = checkLimit('module', sub);
if (limitErr) {
  res.writeHead(429, CORS);
  res.end(JSON.stringify(limitErr));
  return;
}
incrementUsage('module', sub);
```

Then pass `sub.plan` to processJob: `processJob(jobId, body, sub.plan);`

- [ ] **Step 9: Same pattern for /generate-revision and /generate-flashcards endpoints**

Add auth + limit check + pass plan to each endpoint.

- [ ] **Step 10: Update /job-status to handle 'delayed' status (line 630-637)**

```javascript
if (req.method === 'GET' && jobMatch) {
  const job = jobs[jobMatch[1]];
  if (!job) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'Job nao encontrado' })); return; }
  // Check if delayed job should be released
  if (job.status === 'delayed' && job.deliverAt && Date.now() >= job.deliverAt) {
    job.status = 'ready';
  }
  res.writeHead(200, CORS);
  res.end(JSON.stringify({ status: job.status, progress: job.progress, module: job.module, quiz: job.quiz, cards: job.cards, error: job.error, topicsDone: job.topicsDone, topicsTotal: job.topicsTotal, stepsDone: job.stepsDone, stepsTotal: job.stepsTotal, deliverAt: job.deliverAt || null }));
  return;
}
```

- [ ] **Step 11: Add Stripe endpoints before the static file handler**

Add these 4 endpoints in the server's request handler. **CRITICAL: The `/stripe-webhook` handler MUST be the FIRST route after the CORS preflight handler (line 604-606), BEFORE any route that calls `readBody()`, because it needs the raw body for signature verification.**

```javascript
// POST /stripe-webhook — raw body, no auth (verified by signature)
if (req.method === 'POST' && req.url === '/stripe-webhook') {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks);
    try {
      const event = verifyWebhook(rawBody, req.headers['stripe-signature']);
      await processStripeEvent(event);
      res.writeHead(200, CORS); res.end('ok');
    } catch (err) {
      console.error('[stripe-webhook]', err.message);
      res.writeHead(400, CORS); res.end(JSON.stringify({ error: err.message }));
    }
  });
  return;
}

// POST /create-checkout-session
if (req.method === 'POST' && req.url === '/create-checkout-session') {
  try {
    const body = await readBody(req);
    const user = await verifyUserToken(body.idToken);
    const result = await createCheckoutSession({ plan: body.plan, userId: user.uid, userEmail: user.email });
    res.writeHead(200, CORS); res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, CORS); res.end(JSON.stringify({ error: err.message }));
  }
  return;
}

// POST /create-portal-session
if (req.method === 'POST' && req.url === '/create-portal-session') {
  try {
    const body = await readBody(req);
    const user = await verifyUserToken(body.idToken);
    const sub = await getSubscription(user.uid, body.idToken);
    if (!sub.stripeCustomerId) throw new Error('Nenhuma assinatura ativa');
    const result = await createPortalSession({ stripeCustomerId: sub.stripeCustomerId });
    res.writeHead(200, CORS); res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, CORS); res.end(JSON.stringify({ error: err.message }));
  }
  return;
}

// POST /subscription-status (POST to avoid token in URL)
if (req.method === 'POST' && req.url === '/subscription-status') {
  try {
    const body = await readBody(req);
    const user = await verifyUserToken(body.idToken);
    const sub = await getSubscription(user.uid, body.idToken);
    res.writeHead(200, CORS); res.end(JSON.stringify({ plan: sub.plan, status: sub.status, usage: sub.usage }));
  } catch (err) {
    res.writeHead(500, CORS); res.end(JSON.stringify({ error: err.message }));
  }
  return;
}
```

- [ ] **Step 12: Commit**

```bash
git add server.js
git commit -m "feat: integrar ai-router, limites e Stripe em server.js"
```

---

### Task 8: Integrate AI Router into flashcard-server.js

**Files:**
- Modify: `flashcard-server.js`

- [ ] **Step 1: Replace callAnthropic with callAI**

At line 1, add import:
```javascript
const { callAI } = require('./ai-router');
```

Comment out `getKey()` (lines 9-21) and `callAnthropic()` (lines 23-49).

Replace the 3 call sites in processFlashcardJob, processRevisionJob, and the feedback endpoint to use `callAI({ plan: 'free', feature, payload })`.

Note: flashcard-server.js defaults to Free plan since it has no auth. When the main server is fully operational, this server can be retired.

- [ ] **Step 2: Commit**

```bash
git add flashcard-server.js
git commit -m "feat: integrar ai-router em flashcard-server.js"
```

---

### Task 9: Update Firestore rules

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Add subscriptions and stripe_events rules**

Add before the closing `}}` (before line 118):

```
    // Assinaturas — leitura pelo proprio usuario ou admin; escrita APENAS pelo servidor
    match /subscriptions/{userId} {
      allow read: if request.auth != null && (request.auth.uid == userId || isAdmin());
      allow write: if false;
    }

    // Eventos Stripe processados (idempotency) — server-only
    match /stripe_events/{eventId} {
      allow read, write: if false;
    }
```

- [ ] **Step 2: Commit**

```bash
git add firestore.rules
git commit -m "feat: adicionar regras Firestore para subscriptions e stripe_events"
```

---

### Task 10: Update start.sh with Ollama check

**Files:**
- Modify: `start.sh`

- [ ] **Step 1: Add Ollama check after line 8 (mkdir)**

```bash
# --- Ollama ---
if command -v ollama &> /dev/null; then
  if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Iniciando Ollama..."
    ollama serve >> "$LOGS/ollama.log" 2>&1 &
    sleep 3
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
      echo "  Ollama OK"
    else
      echo "  AVISO: Ollama nao iniciou. Plano Free indisponivel."
    fi
  else
    echo "Ollama ja esta rodando."
  fi
else
  echo "AVISO: Ollama nao instalado. Execute: brew install ollama && ollama pull qwen2.5:7b"
fi
```

- [ ] **Step 2: Create setup-ollama.sh**

```bash
#!/bin/bash
# setup-ollama.sh — Instala e configura Ollama para MedMind Free tier
echo "=== MedMind — Setup Ollama ==="

if ! command -v ollama &> /dev/null; then
  echo "Instalando Ollama..."
  brew install ollama
fi

echo "Iniciando Ollama..."
ollama serve &
sleep 3

echo "Baixando modelo qwen2.5:7b (~5GB)..."
ollama pull qwen2.5:7b

echo "Testando..."
RESULT=$(curl -s http://localhost:11434/api/chat -d '{
  "model": "qwen2.5:7b",
  "messages": [{"role": "user", "content": "Responda em JSON: {\"ok\": true}"}],
  "format": "json",
  "stream": false
}')
echo "Resposta: $RESULT"

echo ""
echo "Setup concluido! Modelo qwen2.5:7b pronto."
```

- [ ] **Step 3: Commit**

```bash
chmod +x setup-ollama.sh
git add start.sh setup-ollama.sh
git commit -m "feat: adicionar checagem Ollama em start.sh e setup-ollama.sh"
```

---

## Chunk 3: Landing Page + Frontend Integration

### Task 11: Add landing page and plan UI to index.html

**Files:**
- Modify: `index.html`

This task adds the pricing landing page, upgrade modals, usage indicators, and upsell banners. Since `index.html` is ~4600 lines, changes are additive (new sections) rather than modifying existing code.

- [ ] **Step 1: Add landing page section**

Use the `frontend-design` skill to create the landing page section. Key requirements from spec Section 5:
- Dark mode (#0a0a1a background)
- Hero with "Estude medicina com IA personalizada"
- Animated speed comparison bars (Free 20min, Plus 4min, Pro 30s)
- 3 glassmorphism plan cards (Free/Plus/Pro)
- Feature comparison table
- FAQ accordion
- CTA final
- Mobile-first (cards stacked on mobile, 3-col on desktop)
- Stripe.js integration for checkout buttons

The landing page should be a `<div id="page-planos">` section that can be shown/hidden like other pages in the app.

- [ ] **Step 2: Add upgrade modal**

Modal that shows when limit is reached:
```html
<div id="modal-upgrade" class="modal-overlay" style="display:none">
  <!-- Shows: "Voce usou X/Y modulos este mes" -->
  <!-- Plus and Pro upgrade buttons -->
  <!-- "Renova em: N dias" -->
</div>
```

- [ ] **Step 3: Add upsell banner during generation**

In the generation progress UI, add speed comparison tooltip:
```html
<div id="upsell-speed" style="display:none">
  <span>No Plus: ~4 min | No Pro: ~30 seg</span>
  <a onclick="showPage('planos')">Ver planos</a>
</div>
```

- [ ] **Step 4: Add plan badge to profile**

In the profile section, show plan badge next to user name.

- [ ] **Step 5: Add usage bar to home page**

Show usage progress bars (modules used/max, revisions, etc.) on home page.

- [ ] **Step 6: Add Stripe.js script and checkout logic**

```html
<script src="https://js.stripe.com/v3/"></script>
<script>
  const stripeKey = 'pk_test_...'; // Will be loaded from server
  let stripeInstance;

  async function upgradePlan(plan) {
    const idToken = await firebase.auth().currentUser.getIdToken();
    const resp = await fetch('/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, plan })
    });
    const { url } = await resp.json();
    window.location.href = url;
  }
</script>
```

- [ ] **Step 7: Add idToken to all AI fetch calls**

Update every `fetch('/generate-*')` and `fetch('/revision-feedback')` call to include `idToken`:
```javascript
const idToken = await firebase.auth().currentUser.getIdToken();
// Add idToken to every request body
```

- [ ] **Step 8: Handle limit_reached response in frontend**

In every AI call's response handler, check for `error === 'limit_reached'`:
```javascript
if (data.error === 'limit_reached') {
  showUpgradeModal(data.feature, data.used, data.max);
  return;
}
```

- [ ] **Step 9: Handle 'delayed' status in job polling**

Update poll logic to show "Processing..." during delay:
```javascript
if (data.status === 'delayed') {
  const remainMs = (data.deliverAt || 0) - Date.now();
  progressText.textContent = `Processando... ${Math.ceil(remainMs / 1000)}s restantes`;
}
```

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "feat: adicionar landing page de planos, modais de upgrade e upsell"
```

---

### Task 12: Update admin.html with plan info

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Add Ollama model to MODEL_LABELS**

```javascript
const MODEL_LABELS = {
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'ollama': 'Ollama Local',
};
```

- [ ] **Step 2: Add plan column to user table**

Show each user's plan (Free/Plus/Pro) in the admin user list.

- [ ] **Step 3: Commit**

```bash
git add admin.html
git commit -m "feat: adicionar info de planos no admin dashboard"
```

---

## Chunk 4: Final Integration + Testing

### Task 13: Update CLAUDE.md and documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update stack section**

Add Ollama and Stripe to the stack, document new files and endpoints.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: atualizar CLAUDE.md com stack Ollama/Stripe/planos"
```

---

### Task 14: Deploy Firestore rules

- [ ] **Step 1: Deploy rules**

```bash
cd /Users/macmini-win7/projects/projects/medmindplus
firebase deploy --only firestore:rules
```

Expected: `Deploy complete!`

---

### Task 15: End-to-end testing

- [ ] **Step 1: Verify Ollama health**

```bash
curl -s http://localhost:11434/api/tags | head -20
```

Expected: model list including `qwen2.5:7b`

- [ ] **Step 2: Start server and test Free tier flashcards**

```bash
bash start.sh
# Then from browser: generate flashcards on a topic
# Verify: takes ~5-8 min, returns valid JSON cards
```

- [ ] **Step 3: Test limit enforcement**

Generate 3 modules (Free limit), then try a 4th. Expected: `limit_reached` error with upgrade modal.

- [ ] **Step 4: Test Stripe checkout flow (test mode)**

Click upgrade button, verify Stripe checkout page loads. Complete with test card `4242 4242 4242 4242`.

- [ ] **Step 5: Test Plus tier with delay**

After upgrading to Plus, generate flashcards. Expected: ~1.5 min (not instant, not 8 min).

- [ ] **Step 6: Test landing page**

Open `https://medmind.win7med.com.br` without login. Expected: landing page with 3 plan cards.

- [ ] **Step 7: Verify cost logging**

```bash
tail -5 logs/api-costs.jsonl
```

Expected: entries with `plan` field, Ollama entries with `costUsd: 0`.

---

## Dependency Map

```
Task 1 (deps)
  └─> Task 2 (ollama-client)
  └─> Task 3 (ai-router) ── depends on Task 2
  └─> Task 4 (plan-limits)
  └─> Task 5 (stripe-handler)
      └─> Task 6 (verifyUserToken) ─┐
          └─> Task 7 (server.js integration) ── depends on Tasks 2-6
              └─> Task 8 (flashcard-server.js)
              └─> Task 9 (firestore rules)
              └─> Task 10 (start.sh + setup)
                  └─> Task 11 (landing page + frontend) ── depends on Task 7
                      └─> Task 12 (admin.html)
                          └─> Task 13 (docs)
                              └─> Task 14 (deploy rules)
                                  └─> Task 15 (e2e testing)
```

Tasks 2, 4, 5 can run in parallel. Tasks 6-10 are sequential. Task 11 is the largest.
