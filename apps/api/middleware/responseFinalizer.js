'use strict';

const { getRequestLogger } = require('../lib/requestLog');
const { canonicalizeErrorBody, errorBody } = require('../lib/response');

const RESPONSE_METHODS = ['json', 'send', 'end', 'write'];
const CANONICAL_ERROR_KEYS = new Set(['error', 'code', 'details']);
const STRICT_VIOLATION = Symbol('strictErrorResponseViolation');

function isStrictTestMode() {
  return process.env.NODE_ENV === 'test' && process.env.API_STRICT_ERROR_FINALIZER !== 'false';
}

function isCanonicalErrorBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.error !== 'string') {
    return false;
  }

  if (Object.hasOwn(body, 'code') && typeof body.code !== 'string') return false;
  return Object.keys(body).every((key) => CANONICAL_ERROR_KEYS.has(key));
}

function isBodyless(method, body) {
  if (body === undefined || typeof body === 'function') return true;
  return method === 'end' && body === null;
}

function normalizeErrorBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && typeof body.error === 'string') {
    return canonicalizeErrorBody(body);
  }

  return errorBody('Request failed', undefined, body);
}

function logCanonicalization(req, res, reason) {
  const requestLog = getRequestLogger(req || res);
  if (typeof requestLog.warn !== 'function') return;

  requestLog.warn({
    operation: 'response.error.canonicalized',
    context: {
      route: req?.originalUrl || req?.url || 'unknown',
      status: res.statusCode,
      requestId: req?.requestId,
      reason,
    },
  }, 'Canonicalized nonconforming error response');
}

function nonconformingError(statusCode, reason) {
  const error = new Error(`Nonconforming error response at status ${statusCode}: ${reason}`);
  error.code = 'NONCANONICAL_ERROR_RESPONSE';
  error.statusCode = statusCode;
  return error;
}

function blockedWriteError(statusCode) {
  const error = new Error(`Streamed error response blocked at status ${statusCode}`);
  error.code = 'NONCANONICAL_ERROR_WRITE';
  error.statusCode = statusCode;
  return error;
}

function setJsonContentType(res) {
  if (typeof res.type === 'function') {
    res.type('application/json');
  } else if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json');
  }
}

/**
 * Final response boundary for API failures. It intentionally wraps emission
 * methods instead of inspecting route source, so aliases, helpers, and
 * external emitters cannot bypass the canonical error envelope.
 */
function responseFinalizer(req, res, next) {
  let finalizing = false;

  function callOriginal(original, body, args, omitBody = false) {
    finalizing = true;
    try {
      return omitBody ? original.apply(res, args) : original.call(res, body, ...args);
    } finally {
      finalizing = false;
    }
  }

  for (const method of RESPONSE_METHODS) {
    const original = res[method];
    if (typeof original !== 'function') continue;

    res[method] = function finalizedResponse(body, ...args) {
      if (finalizing || res[STRICT_VIOLATION]) return original.call(res, body, ...args);

      const statusCode = res.statusCode;
      if (statusCode < 400) return callOriginal(original, body, args);
      if (req.method === 'HEAD' || isBodyless(method, body)) return callOriginal(original, body, args, true);

      if (method === 'write') {
        const reason = 'streamed-error-write';
        if (isStrictTestMode()) {
          res[STRICT_VIOLATION] = true;
          throw nonconformingError(statusCode, reason);
        }
        logCanonicalization(req, res, reason);
        throw blockedWriteError(statusCode);
      }

      const canonical = isCanonicalErrorBody(body);
      if (!canonical && isStrictTestMode()) {
        const reason = typeof body?.error === 'string'
          ? 'legacy-or-invalid-canonical-shape'
          : 'missing-top-level-error';
        res[STRICT_VIOLATION] = true;
        throw nonconformingError(statusCode, reason);
      }

      const normalized = canonical ? body : normalizeErrorBody(body);
      if (!canonical) {
        const reason = typeof body?.error === 'string'
          ? 'legacy-or-invalid-canonical-shape'
          : 'missing-top-level-error';
        logCanonicalization(req, res, reason);
      }

      if (method === 'end') {
        setJsonContentType(res);
        return callOriginal(original, JSON.stringify(normalized), args);
      }

      return callOriginal(original, normalized, args);
    };
  }

  next();
}

module.exports = responseFinalizer;
