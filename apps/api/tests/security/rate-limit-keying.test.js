'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { getRateLimitKey } = require('../../middleware/rateLimiter');

test('rate-limit keys prefer authenticated userId', () => {
  assert.equal(
    getRateLimitKey({ user: { userId: 'user-1', email: 'user@example.com' }, ip: '203.0.113.1' }),
    'user-1'
  );
});

test('rate-limit keys fall back to authenticated email', () => {
  assert.equal(
    getRateLimitKey({ user: { email: 'user@example.com' }, ip: '203.0.113.1' }),
    'user@example.com'
  );
});

test('rate-limit keys fall back to the Express IP', () => {
  assert.equal(getRateLimitKey({ ip: '203.0.113.1' }), '203.0.113.1');
});
