'use strict';

const assert = require('node:assert/strict');

const CANONICAL_ERROR_KEYS = new Set(['error', 'code', 'details']);

function assertCanonicalErrorBody(body) {
  assert.ok(body && typeof body === 'object' && !Array.isArray(body), 'error response must be an object');
  assert.equal(typeof body.error, 'string', 'error response must contain a string error message');
  for (const key of Object.keys(body)) {
    assert.ok(CANONICAL_ERROR_KEYS.has(key), `unexpected top-level error key: ${key}`);
  }
  if (Object.hasOwn(body, 'code')) assert.equal(typeof body.code, 'string', 'error code must be a string');
}

function assertCanonicalErrorResponse(response) {
  assert.ok(response.statusCode >= 400, 'expected a non-success response');
  assertCanonicalErrorBody(response.body);
}

module.exports = { assertCanonicalErrorBody, assertCanonicalErrorResponse };
