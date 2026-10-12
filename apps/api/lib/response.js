'use strict';

const CANONICAL_ERROR_KEYS = new Set(['error', 'code', 'details']);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Construct the API's canonical non-success body.
 *
 * `code` deliberately remains top-level: clients use it as a stable,
 * machine-readable discriminator. Route-specific context belongs in details.
 */
function errorBody(message, code, details) {
  const body = { error: typeof message === 'string' && message ? message : 'Request failed' };
  if (typeof code === 'string' && code) body.code = code;
  if (details !== undefined) body.details = details;
  return body;
}

/**
 * Preserve the value of existing service outcomes while preventing legacy
 * metadata fields from escaping the canonical error envelope.
 */
function canonicalizeErrorBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.error !== 'string') {
    return body;
  }

  const legacyDetails = {};
  for (const [key, value] of Object.entries(body)) {
    if (!CANONICAL_ERROR_KEYS.has(key)) legacyDetails[key] = value;
  }

  let details = body.details;
  if (Object.keys(legacyDetails).length > 0) {
    details = details && typeof details === 'object' && !Array.isArray(details)
      ? { ...details, ...legacyDetails }
      : details === undefined
        ? legacyDetails
        : { value: details, ...legacyDetails };
  }

  return errorBody(body.error, body.code, details);
}

function sendError(res, status, message, code, details) {
  if (res.req?.method === 'HEAD') return res.status(status).end();
  return res.status(status).json(errorBody(message, code, details));
}

module.exports = {
  canonicalizeErrorBody,
  errorBody,
  sendError,
};
