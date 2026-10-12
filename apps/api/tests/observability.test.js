'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { z } = require('zod');

delete process.env.SENTRY_DSN;

const requestLogger = require('../middleware/requestLogger');
const { safeError } = require('../middleware/errorResponse');
const { validate } = require('../middleware/validate');
const { captureException, initSentry } = require('../lib/sentry');

function createResponse(req) {
  return {
    req,
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('requestLogger attaches a request id, child logger, and response header', () => {
  const req = {
    headers: {},
    ip: '127.0.0.1',
    method: 'GET',
    originalUrl: '/api/health',
  };
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (name, value) => {
    res.headers[name] = value;
  };

  let nextCalled = false;
  requestLogger(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.match(req.requestId, /^[0-9a-f-]{8}$/);
  assert.equal(res.headers['X-Request-Id'], req.requestId);
  assert.equal(typeof req.log.info, 'function');
});

test('safeError logs through req.log and keeps 500 responses generic', () => {
  let logged = null;
  const req = {
    requestId: 'abc12345',
    method: 'GET',
    originalUrl: '/api/test',
    log: {
      error(payload, message) {
        logged = { payload, message };
      },
    },
  };
  const res = createResponse(req);

  safeError(res, new Error('database exploded'), 'GET /api/test');

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Internal server error' });
  assert.equal(logged.message, 'Request failed');
  assert.equal(logged.payload.operation, 'request.error');
  assert.equal(logged.payload.context.route, 'GET /api/test');
  assert.equal(logged.payload.context.path, '/api/test');
  assert.equal(logged.payload.error, 'database exploded');
});

test('validate logs validation failures through req.log without external services', () => {
  let logged = null;
  let nextCalled = false;
  const middleware = validate(z.object({ name: z.string().min(1) }));
  const req = {
    body: {},
    originalUrl: '/api/example',
    log: {
      warn(payload, message) {
        logged = { payload, message };
      },
    },
  };
  const res = createResponse(req);

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Validation failed');
  assert.equal(logged.message, 'Validation failed');
  assert.equal(logged.payload.operation, 'request.validation_failed');
  assert.equal(logged.payload.context.path, '/api/example');
});

test('Sentry helper is a no-op when SENTRY_DSN is absent', () => {
  assert.equal(initSentry(), null);
  assert.equal(captureException(new Error('offline test'), { operation: 'test' }), false);
});
