'use strict';

/**
 * ai-router.js
 *
 * Routes AI calls to the appropriate engine based on the user's plan:
 *   - free  → Ollama (local, queued)
 *   - plus  → Claude Haiku (with artificial delay for async delivery)
 *   - pro   → Claude Haiku (full speed, no delay)
 *
 * Exports: callAI, callHaiku, getAnthropicKey, HAIKU_MODEL, logCost
 */

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const { callOllama, isOllamaHealthy } = require('./ollama-client.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/** Haiku pricing per million tokens (USD) */
const HAIKU_PRICE = {
  input:  0.80,
  output: 4.00,
};

/** Ollama pricing per million tokens (USD) — local model, zero cost */
const OLLAMA_PRICE = {
  input:  0,
  output: 0,
};

/** Plan → engine mapping */
const PLAN_ENGINE = {
  free: 'ollama',
  plus: 'haiku',
  pro:  'haiku',
};

/**
 * "Free" time estimates (ms) for each feature — used to compute Plus delays.
 * Free users wait the full duration; Plus users wait 20% of it.
 */
const FREE_ESTIMATES_MS = {
  module:     20 * 60 * 1000,  // 20 min
  quiz:       15 * 60 * 1000,  // 15 min
  revision:   15 * 60 * 1000,  // 15 min
  flashcards:  8 * 60 * 1000,  //  8 min
  feedback:   20 * 1000,       // 20 s  (kept synchronous for Plus — see below)
};

/** Plus delay = 20% of the free estimate */
const PLUS_DELAY_FACTOR = 0.20;

const COSTS_LOG_PATH = path.join(__dirname, 'logs', 'api-costs.jsonl');

// ---------------------------------------------------------------------------
// API Key resolution
// ---------------------------------------------------------------------------

/**
 * Reads the Anthropic API key from one of two known locations.
 * Tries each file in order and returns the first match found.
 *
 * Sources (in priority order):
 *   1. /Users/macmini-win7/projects/projects/imagex-ris/.env  → ANTHROPIC_API_KEY=...
 *   2. /etc/claude-hub/api-keys.env                           → ANTHROPIC_API_KEY_PRODUCAO=...
 *
 * @returns {string} The API key
 * @throws  {Error}  If neither source yields a key
 */
function getAnthropicKey() {
  const sources = [
    {
      file:    '/Users/macmini-win7/projects/projects/imagex-ris/.env',
      pattern: /^ANTHROPIC_API_KEY=(.+)$/m,
    },
    {
      file:    '/etc/claude-hub/api-keys.env',
      pattern: /^ANTHROPIC_API_KEY_PRODUCAO=(.+)$/m,
    },
  ];

  for (const { file, pattern } of sources) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const match   = content.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    } catch (_err) {
      // File not readable — try next source
    }
  }

  throw new Error(
    'Anthropic API key not found. ' +
    'Expected ANTHROPIC_API_KEY in imagex-ris/.env or ' +
    'ANTHROPIC_API_KEY_PRODUCAO in /etc/claude-hub/api-keys.env'
  );
}

// ---------------------------------------------------------------------------
// Haiku API call
// ---------------------------------------------------------------------------

/**
 * Calls the Anthropic Haiku API with the given payload.
 *
 * Applies prompt caching to the system prompt by converting the `system`
 * string to the array format with `cache_control: { type: 'ephemeral' }`.
 *
 * @param {object} payload            - Anthropic-format request object
 * @param {string} [payload.system]   - System prompt (string)
 * @param {Array}  [payload.messages] - Conversation messages
 * @param {number} [payload.max_tokens]
 * @param {number} [payload.temperature]
 * @returns {Promise<object>} Anthropic-shaped response
 */
function callHaiku(payload) {
  return new Promise((resolve, reject) => {
    const apiKey = getAnthropicKey();

    // Build the request body, converting system string → cached array format
    const body = Object.assign({}, payload, { model: HAIKU_MODEL });

    if (typeof body.system === 'string') {
      body.system = [
        {
          type:          'text',
          text:          payload.system,
          cache_control: { type: 'ephemeral' },
        },
      ];
    }

    const bodyStr = JSON.stringify(body);

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers:  {
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(bodyStr),
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'prompt-caching-2024-07-31',
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let result;
        try {
          result = JSON.parse(raw);
        } catch (err) {
          return reject(new Error(`Haiku JSON parse error: ${err.message} — body: ${raw}`));
        }

        if (result.type === 'error') {
          return reject(new Error(
            `Haiku API error [${result.error && result.error.type}]: ` +
            (result.error && result.error.message ? result.error.message : raw)
          ));
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Haiku HTTP ${res.statusCode}: ${raw}`));
        }

        resolve(result);
      });
    });

    // 5-minute timeout
    req.setTimeout(5 * 60 * 1000, () => {
      req.destroy(new Error('Haiku request timed out after 5 minutes'));
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Cost logging
// ---------------------------------------------------------------------------

/**
 * Appends a cost record to logs/api-costs.jsonl (JSONL format).
 * Creates the logs directory if it does not exist.
 *
 * @param {object} opts
 * @param {string} opts.model
 * @param {string} opts.feature
 * @param {string} opts.plan
 * @param {number} opts.inputTokens
 * @param {number} opts.outputTokens
 * @param {number} opts.costUsd
 * @param {string} [opts.userId]
 * @param {string} [opts.jobId]
 */
function logCost({ model, feature, plan, inputTokens, outputTokens, costUsd, userId, jobId }) {
  try {
    const logsDir = path.dirname(COSTS_LOG_PATH);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const record = {
      ts:           new Date().toISOString(),
      model,
      feature,
      plan,
      inputTokens,
      outputTokens,
      costUsd,
      userId:  userId  || null,
      jobId:   jobId   || null,
    };

    fs.appendFileSync(COSTS_LOG_PATH, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    // Cost logging is best-effort — never throw from here
    console.warn('[ai-router] logCost failed:', err.message);
  }
}

/**
 * Computes the USD cost for a given model and token counts.
 *
 * @param {string} engine       - 'ollama' | 'haiku'
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} cost in USD
 */
function _computeCost(engine, inputTokens, outputTokens) {
  const pricing = engine === 'ollama' ? OLLAMA_PRICE : HAIKU_PRICE;
  return (
    (inputTokens  / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

// ---------------------------------------------------------------------------
// Delay calculation for Plus plan
// ---------------------------------------------------------------------------

/**
 * Returns the artificial delay in milliseconds for a Plus-plan async request,
 * or 0 if the feature is synchronous (feedback) or not recognized.
 *
 * @param {string} feature
 * @returns {number} delay in ms
 */
function _plusDelayMs(feature) {
  // feedback is always synchronous for Plus — no delay
  if (feature === 'feedback') return 0;

  const freeMs = FREE_ESTIMATES_MS[feature];
  if (!freeMs) return 0;

  return Math.round(freeMs * PLUS_DELAY_FACTOR);
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

/**
 * Routes an AI call to the correct engine based on the user's plan,
 * logs cost, and returns the result alongside an optional deliverAt timestamp
 * (for Plus async delivery).
 *
 * @param {object} opts
 * @param {string} opts.plan     - 'free' | 'plus' | 'pro'
 * @param {string} opts.feature  - 'module' | 'quiz' | 'revision' | 'flashcards' | 'feedback'
 * @param {object} opts.payload  - Anthropic-format request (system, messages, max_tokens, …)
 * @param {string} [opts.userId]
 * @param {string} [opts.jobId]
 * @returns {Promise<{ result: object, deliverAt: number|null }>}
 */
async function callAI({ plan, feature, payload, userId, jobId }) {
  const engine = PLAN_ENGINE[plan] || 'ollama';

  let result;

  if (engine === 'ollama') {
    // Free plan: route to local Ollama
    const health = await isOllamaHealthy();
    if (!health.healthy) {
      throw new Error(
        `Ollama is not available (${health.reason}). ` +
        'Upgrade to MedMind Plus or Pro for uninterrupted AI-powered study features.'
      );
    }
    result = await callOllama(payload);
  } else {
    // Plus / Pro: route to Haiku
    result = await callHaiku(payload);
  }

  // Log cost
  const usage        = (result && result.usage) || {};
  const inputTokens  = usage.input_tokens  || 0;
  const outputTokens = usage.output_tokens || 0;
  const costUsd      = _computeCost(engine, inputTokens, outputTokens);
  const model        = engine === 'ollama' ? (result.model || 'ollama') : HAIKU_MODEL;

  logCost({ model, feature, plan, inputTokens, outputTokens, costUsd, userId, jobId });

  // Compute deliverAt for Plus async features
  let deliverAt = null;
  if (plan === 'plus') {
    const delayMs = _plusDelayMs(feature);
    if (delayMs > 0) {
      deliverAt = Date.now() + delayMs;
    }
  }

  return { result, deliverAt };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  callAI,
  callHaiku,
  getAnthropicKey,
  HAIKU_MODEL,
  logCost,
};
