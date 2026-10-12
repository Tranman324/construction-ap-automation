'use strict';
/**
 * Direct Anthropic API client for invoice vision tasks.
 * Decoupled from LLM gateway — uses ANTHROPIC_API_KEY directly.
 *
 * Features:
 * - HTTPS keep-alive for connection reuse across calls (saves ~500ms/call)
 * - 45-second timeout via AbortController (prevents hangs)
 * - Retry with exponential backoff on 5xx / 429 / timeout / network errors
 * - Lenient JSON parser helper for Haiku responses
 */

const path = require('path');
const https = require('https');
const logger = require('../../../lib/logger');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env'), override: true });
} catch {}

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Keep-alive agent reused across all calls → saves TLS handshake (~500ms) per call
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 10,
});

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldRetry(error, status) {
  // Retry on 5xx (server errors), 429 (rate limit), network/timeout errors
  if (status >= 500) return true;
  if (status === 429) return true;
  if (!status && error) {
    const msg = String(error.message || error).toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('aborted') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('socket hang up') ||
      msg.includes('network')
    );
  }
  return false;
}

async function haikuFetchOnce(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
      // @ts-expect-error Node fetch supports dispatcher/agent via undici; fall through if unsupported
      agent: httpsAgent,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const err = new Error(
        `Anthropic API ${resp.status}: ${errText.slice(0, 300)}`
      );
      err.status = resp.status;
      throw err;
    }

    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function callHaiku(imageInputs, prompt, maxTokens = 2000) {
  if (!ANTHROPIC_KEY) throw new Error('No ANTHROPIC_API_KEY found in .env');

  const content = [
    ...imageInputs.map(({ data, mediaType }) => ({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data },
    })),
    { type: 'text', text: prompt },
  ];

  const body = JSON.stringify({
    model: HAIKU_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }],
  });

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await haikuFetchOnce(body);
      return {
        text: result.content?.[0]?.text || '',
        usage: {
          input_tokens: result.usage?.input_tokens || 0,
          output_tokens: result.usage?.output_tokens || 0,
        },
      };
    } catch (err) {
      lastError = err;
      const status = err.status || 0;
      if (attempt >= MAX_RETRIES || !shouldRetry(err, status)) break;
      // Exponential backoff: 500ms, 1500ms, 4500ms
      const delay = 500 * Math.pow(3, attempt);
      logger.warn({ err, attempt: attempt + 1, maxAttempts: MAX_RETRIES + 1, delay }, 'Haiku call failed; retrying');
      await sleep(delay);
    }
  }

  throw lastError || new Error('Haiku call failed with no error');
}

/**
 * Lenient JSON parser for Haiku responses.
 * Tries strict first; falls back to extracting the first JSON object
 * from markdown code fences, trailing text, or surrounding noise.
 *
 * @param {string} text - Raw text from Haiku
 * @returns {object|null} - Parsed object, or null if all attempts fail
 */
function parseHaikuJson(text) {
  if (!text || typeof text !== 'string') return null;

  // Strategy 1: Strict parse
  try {
    return JSON.parse(text);
  } catch {}

  // Strategy 2: Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }

  // Strategy 3: Extract the outermost balanced JSON object
  const objMatch = extractBalancedJson(text, '{', '}');
  if (objMatch) {
    try {
      return JSON.parse(objMatch);
    } catch {}
  }

  // Strategy 4: Extract the outermost balanced JSON array
  const arrMatch = extractBalancedJson(text, '[', ']');
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch);
    } catch {}
  }

  return null;
}

/**
 * Find the first balanced JSON block in a string.
 * Handles nested braces and string literals with escapes.
 */
function extractBalancedJson(text, openChar, closeChar) {
  const start = text.indexOf(openChar);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

module.exports = { callHaiku, parseHaikuJson };
