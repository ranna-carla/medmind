'use strict';

/**
 * ollama-client.js
 *
 * Translates Anthropic-format API payloads to Ollama's local HTTP API and
 * returns Anthropic-shaped responses so the rest of the codebase does not
 * need to change.
 *
 * Exports: callOllama, isOllamaHealthy, getQueuePosition, DEFAULT_MODEL
 */

const http = require('http');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const OLLAMA_HOST  = process.env.OLLAMA_HOST  || '127.0.0.1';
const OLLAMA_PORT  = parseInt(process.env.OLLAMA_PORT  || '11434', 10);
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const DEFAULT_TIMEOUT_MS = 900_000; // 15 minutes

// ---------------------------------------------------------------------------
// Promise-based semaphore — max 1 concurrent Ollama request (Mac Mini M2)
// ---------------------------------------------------------------------------
let _activeRequest = false;
const _queue = []; // array of { resolve, reject, fn }

/**
 * Returns how many requests are waiting in the queue (not counting the one
 * currently running, if any).
 */
function getQueuePosition() {
  return _queue.length;
}

/**
 * Enqueues a job function that returns a Promise.  Guarantees only one job
 * runs at a time.
 *
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
function _enqueue(fn) {
  return new Promise((resolve, reject) => {
    _queue.push({ resolve, reject, fn });
    _drain();
  });
}

function _drain() {
  if (_activeRequest || _queue.length === 0) return;
  _activeRequest = true;
  const { resolve, reject, fn } = _queue.shift();
  fn()
    .then(resolve, reject)
    .finally(() => {
      _activeRequest = false;
      _drain();
    });
}

// ---------------------------------------------------------------------------
// Low-level HTTP helper
// ---------------------------------------------------------------------------

/**
 * Makes a POST request to the local Ollama HTTP API.
 *
 * @param {string} path        - e.g. '/api/chat'
 * @param {object} body        - JSON payload
 * @param {number} timeoutMs
 * @returns {Promise<object>}  - parsed JSON response
 */
function _post(path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);

    const options = {
      hostname: OLLAMA_HOST,
      port:     OLLAMA_PORT,
      path,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Ollama HTTP ${res.statusCode}: ${raw}`));
        }
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error(`Ollama JSON parse error: ${err.message} — body: ${raw}`));
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Ollama request timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Makes a GET request to the local Ollama HTTP API.
 *
 * @param {string} path
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<object>}
 */
function _get(path, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: OLLAMA_HOST,
      port:     OLLAMA_PORT,
      path,
      method:   'GET',
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Ollama HTTP ${res.statusCode}: ${raw}`));
        }
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error(`Ollama JSON parse error: ${err.message}`));
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Ollama health-check timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Format translation — Anthropic → Ollama
// ---------------------------------------------------------------------------

/**
 * Converts an Anthropic content array (with {type:"text"} and
 * {type:"document"} items) into a plain string, keeping only text parts.
 *
 * If the content is already a plain string it is returned as-is.
 *
 * @param {string|Array} content
 * @returns {string}
 */
function _contentToString(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content);

  return content
    .filter((part) => part && part.type === 'text')
    .map((part) => part.text || '')
    .join('');
}

/**
 * Translates an Anthropic-format request object into an Ollama /api/chat
 * payload.
 *
 * Anthropic request shape (relevant fields):
 *   {
 *     model?,
 *     system?,           // string
 *     messages,          // [{role, content}]
 *     max_tokens?,
 *     temperature?,
 *   }
 *
 * @param {object} anthropicRequest
 * @returns {object} Ollama payload
 */
function _translateRequest(anthropicRequest) {
  const {
    model       = DEFAULT_MODEL,
    system,
    messages    = [],
    max_tokens,
    temperature,
  } = anthropicRequest;

  // Build messages array for Ollama
  const ollamaMessages = [];

  // Prepend system prompt if present
  if (system && typeof system === 'string' && system.trim()) {
    ollamaMessages.push({ role: 'system', content: system });
  }

  // Translate each user/assistant message
  for (const msg of messages) {
    ollamaMessages.push({
      role:    msg.role,
      content: _contentToString(msg.content),
    });
  }

  // Build options
  const ollamaOptions = {};
  if (max_tokens  !== undefined) ollamaOptions.num_predict  = max_tokens;
  if (temperature !== undefined) ollamaOptions.temperature  = temperature;

  // Determine whether to request JSON output
  const wantsJson =
    system && /json/i.test(system);

  const payload = {
    model:    model || DEFAULT_MODEL,
    messages: ollamaMessages,
    options:  ollamaOptions,
    stream:   false,
  };

  if (wantsJson) payload.format = 'json';

  return payload;
}

/**
 * Translates an Ollama /api/chat response into Anthropic-shaped output.
 *
 * Ollama response shape (stream:false):
 *   {
 *     model,
 *     message: { role, content },
 *     done_reason,
 *     prompt_eval_count,
 *     eval_count,
 *     ...
 *   }
 *
 * @param {object} ollamaResponse
 * @returns {object} Anthropic-shaped response
 */
function _translateResponse(ollamaResponse) {
  const text = (ollamaResponse.message && ollamaResponse.message.content) || '';

  // Map Ollama done_reason → Anthropic stop_reason
  const doneReason  = ollamaResponse.done_reason || 'stop';
  const stopReasonMap = { stop: 'end_turn', length: 'max_tokens' };
  const stop_reason = stopReasonMap[doneReason] || 'end_turn';

  return {
    content: [{ type: 'text', text }],
    usage: {
      input_tokens:  ollamaResponse.prompt_eval_count || 0,
      output_tokens: ollamaResponse.eval_count        || 0,
    },
    stop_reason,
    model: ollamaResponse.model || DEFAULT_MODEL,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks that Ollama is running and that the target model is available.
 *
 * @param {string} [model] - defaults to DEFAULT_MODEL
 * @returns {Promise<{ healthy: boolean, reason?: string }>}
 */
async function isOllamaHealthy(model) {
  const targetModel = model || DEFAULT_MODEL;

  try {
    const data = await _get('/api/tags');
    const models = (data.models || []).map((m) => m.name);

    // Ollama model names sometimes include the tag (e.g. "qwen2.5:7b")
    const loaded = models.some(
      (name) => name === targetModel || name.startsWith(targetModel + ':')
    );

    if (!loaded) {
      return {
        healthy: false,
        reason:  `Model "${targetModel}" not found. Available: ${models.join(', ') || '(none)'}`,
      };
    }

    return { healthy: true };
  } catch (err) {
    return { healthy: false, reason: `Ollama unreachable: ${err.message}` };
  }
}

/**
 * Sends an Anthropic-format request to Ollama (queued — max 1 concurrent).
 *
 * @param {object} anthropicRequest
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] - default 900000 (15 min)
 * @returns {Promise<object>} Anthropic-shaped response
 */
function callOllama(anthropicRequest, opts = {}) {
  const timeoutMs = opts.timeoutMs !== undefined ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  return _enqueue(async () => {
    const ollamaPayload  = _translateRequest(anthropicRequest);
    const ollamaResponse = await _post('/api/chat', ollamaPayload, timeoutMs);
    return _translateResponse(ollamaResponse);
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  callOllama,
  isOllamaHealthy,
  getQueuePosition,
  DEFAULT_MODEL,
};
