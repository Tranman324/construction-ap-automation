'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const apiRoot = path.resolve(__dirname, '../..');

function requestFor(app, forwardedFor) {
  const req = Object.create(app.request);
  req.app = app;
  req.socket = { remoteAddress: '10.0.0.2' };
  req.headers = { 'x-forwarded-for': forwardedFor };
  return req;
}

test('one trusted proxy hop ignores a client-injected leftmost XFF value', () => {
  const app = express();
  app.set('trust proxy', 1);

  const req = requestFor(app, '203.0.113.250, 198.51.100.17');

  assert.equal(req.ip, '198.51.100.17');
  assert.notEqual(req.ip, '203.0.113.250');
});

test('API transport code delegates client IP resolution to Express', () => {
  const serverSource = fs.readFileSync(path.join(apiRoot, 'server.js'), 'utf8');
  const rateLimiterSource = fs.readFileSync(path.join(apiRoot, 'middleware/rateLimiter.js'), 'utf8');
  const requestLoggerSource = fs.readFileSync(path.join(apiRoot, 'middleware/requestLogger.js'), 'utf8');

  assert.match(serverSource, /app\.set\('trust proxy', 1\)/);
  assert.doesNotMatch(rateLimiterSource, /getClientIp|x-forwarded-for/i);
  assert.doesNotMatch(requestLoggerSource, /getClientIp|x-forwarded-for/i);
  assert.match(requestLoggerSource, /const ip = req\.ip;/);
  // The per-user keyGenerator may exist, but its IP fallback must still delegate to Express (req.ip).
  assert.match(rateLimiterSource, /keyGenerator: getRateLimitKey/);
  assert.match(rateLimiterSource, /ipKeyGenerator\(req\.ip\)/);
  assert.doesNotMatch(rateLimiterSource, /req\.headers|req\.socket|remoteAddress/);
});

test('managed TLS exceptions are explicitly documented as compensating controls', () => {
  for (const relativePath of ['lib/db.js', 'lib/migrations.js']) {
    const source = fs.readFileSync(path.join(apiRoot, relativePath), 'utf8');
    assert.match(source, /\/\/ SECURITY: intentional — Supabase managed TLS/);
    assert.match(source, /ssl: \{ rejectUnauthorized: false \}/);
    assert.match(source, /not certificate-validation closure/);
  }
});
