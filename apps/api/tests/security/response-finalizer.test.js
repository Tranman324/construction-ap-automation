'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const responseFinalizer = require('../../middleware/responseFinalizer');
const { assertCanonicalErrorBody } = require('../helpers/assertCanonicalErrorResponse');

function createApp(registerRoutes, handleError) {
  const logs = [];
  const errors = [];
  const app = express();
  app.use((req, _res, next) => {
    req.requestId = 'a7c-test-request';
    req.log = {
      warn(entry, message) {
        logs.push({ entry, message });
      },
    };
    next();
  });
  app.use(responseFinalizer);
  registerRoutes(app);
  app.use((error, req, res, next) => {
    errors.push(error);
    if (handleError) return handleError(error, req, res, next);
    if (res.headersSent) return next(error);
    return res.status(500).json({ error: 'Test error handler' });
  });
  return { app, errors, logs };
}

async function request(app, path, method = 'GET') {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();
    return await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path, method }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
          statusCode: res.statusCode,
        }));
      });
      req.once('error', reject);
      req.end();
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function parseJson(response) {
  const body = JSON.parse(response.body);
  assertCanonicalErrorBody(body);
  return body;
}

function withProductionFinalization(work) {
  const previous = process.env.API_STRICT_ERROR_FINALIZER;
  process.env.API_STRICT_ERROR_FINALIZER = 'false';
  return Promise.resolve()
    .then(work)
    .finally(() => {
      if (previous === undefined) delete process.env.API_STRICT_ERROR_FINALIZER;
      else process.env.API_STRICT_ERROR_FINALIZER = previous;
    });
}

test('finalizer canonicalizes dynamic response methods through Express', async () => {
  await withProductionFinalization(async () => {
    const { app, logs } = createApp((router) => {
      router.get('/dynamic', (_req, res) => {
        const method = 'json';
        return res.status(409)[method]({
          error: 'State changed',
          code: 'STATE_CHANGED',
          staleFields: ['status'],
        });
      });
    });

    const response = await request(app, '/dynamic');
    assert.equal(response.statusCode, 409);
    assert.deepEqual(parseJson(response), {
      error: 'State changed',
      code: 'STATE_CHANGED',
      details: { staleFields: ['status'] },
    });
    assert.deepEqual(logs[0], {
      entry: {
        operation: 'response.error.canonicalized',
        context: {
          route: '/dynamic',
          status: 409,
          requestId: 'a7c-test-request',
          reason: 'legacy-or-invalid-canonical-shape',
        },
      },
      message: 'Canonicalized nonconforming error response',
    });
  });
});

test('finalizer canonicalizes detached response methods through Express', async () => {
  await withProductionFinalization(async () => {
    const { app } = createApp((router) => {
      router.get('/detached', (_req, res) => {
        const emit = res.status(422).send;
        return emit({ error: 'Invalid document', field: 'vendorCode' });
      });
    });

    const response = await request(app, '/detached');
    assert.equal(response.statusCode, 422);
    assert.deepEqual(parseJson(response), {
      error: 'Invalid document',
      details: { field: 'vendorCode' },
    });
  });
});

test('finalizer canonicalizes helper-returned bodies through Express', async () => {
  await withProductionFinalization(async () => {
    const { app } = createApp((router) => {
      router.get('/helper', (_req, res) => {
        const outcome = () => ({ error: 'Undo unavailable', code: 'UNDO_UNAVAILABLE', actionId: 'act-1' });
        return res.status(410).json(outcome());
      });
    });

    const response = await request(app, '/helper');
    assert.equal(response.statusCode, 410);
    assert.deepEqual(parseJson(response), {
      error: 'Undo unavailable',
      code: 'UNDO_UNAVAILABLE',
      details: { actionId: 'act-1' },
    });
  });
});

test('finalizer canonicalizes external emitters through Express', async () => {
  await withProductionFinalization(async () => {
    const { app } = createApp((router) => {
      const externalEmitter = (res) => res.status(503).send({ error: 'External dependency failed', retryable: true });
      router.get('/external', (_req, res) => externalEmitter(res));
    });

    const response = await request(app, '/external');
    assert.equal(response.statusCode, 503);
    assert.deepEqual(parseJson(response), {
      error: 'External dependency failed',
      details: { retryable: true },
    });
  });
});

test('finalizer wraps a missing error string through Express without losing the original body', async () => {
  await withProductionFinalization(async () => {
    const { app } = createApp((router) => {
      router.get('/missing-error', (_req, res) => res.status(400).json({
        message: 'Invalid payload',
        code: 'INVALID_PAYLOAD',
      }));
    });

    const response = await request(app, '/missing-error');
    assert.equal(response.statusCode, 400);
    assert.deepEqual(parseJson(response), {
      error: 'Request failed',
      details: { message: 'Invalid payload', code: 'INVALID_PAYLOAD' },
    });
  });
});

test('finalizer preserves successful and HEAD/bodyless responses', async () => {
  const { app, logs } = createApp((router) => {
    router.get('/success', (_req, res) => res.status(200).json({ message: 'unchanged' }));
    router.head('/head', (_req, res) => res.status(404).json({ message: 'body must be omitted' }));
    router.get('/bodyless', (_req, res) => res.status(500).end());
  });

  const success = await request(app, '/success');
  assert.equal(success.statusCode, 200);
  assert.deepEqual(JSON.parse(success.body), { message: 'unchanged' });

  const head = await request(app, '/head', 'HEAD');
  assert.equal(head.statusCode, 404);
  assert.equal(head.body, '');

  const bodyless = await request(app, '/bodyless');
  assert.equal(bodyless.statusCode, 500);
  assert.equal(bodyless.body, '');
  assert.deepEqual(logs, []);
});

test('strict mode preserves canonical json through Express without repair', async () => {
  assert.equal(process.env.NODE_ENV, 'test');

  const expected = {
    error: 'State changed',
    code: 'STATE_CHANGED',
    details: { actionId: 'action-1' },
  };
  const { app, errors, logs } = createApp((router) => {
    router.get('/strict-canonical-json', (_req, res) => res.status(409).json(expected));
  });

  const response = await request(app, '/strict-canonical-json');
  assert.equal(response.statusCode, 409);
  assert.deepEqual(parseJson(response), expected);
  assert.deepEqual(errors, []);
  assert.deepEqual(logs, []);
});

test('canonical send preserves the exact error body without repair', async () => {
  const expected = {
    error: 'State changed',
    code: 'STATE_CHANGED',
    details: { actionId: 'action-1' },
  };
  const { app, errors, logs } = createApp((router) => {
    router.get('/canonical-send', (_req, res) => res.status(409).send(expected));
  });

  const response = await request(app, '/canonical-send');
  assert.equal(response.statusCode, 409);
  assert.deepEqual(parseJson(response), expected);
  assert.deepEqual(errors, []);
  assert.deepEqual(logs, []);
});

test('strict mode rejects noncanonical responses before bytes emit without an error loop', async () => {
  const { app, errors } = createApp(
    (router) => {
      router.get('/strict-noncanonical', (_req, res) => res.status(400).json({ message: 'planted violation' }));
    },
    (_error, _req, res) => res.status(500).end()
  );

  const response = await request(app, '/strict-noncanonical');
  assert.equal(response.statusCode, 500);
  assert.equal(response.body, '');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'NONCANONICAL_ERROR_RESPONSE');
});

test('non-bodyless end serializes a canonical error body safely', async () => {
  await withProductionFinalization(async () => {
    const expected = {
      error: 'Document missing',
      code: 'DOCUMENT_MISSING',
      details: { documentId: 'doc-1' },
    };
    const { app, errors, logs } = createApp((router) => {
      router.get('/end', (_req, res) => res.status(404).end(expected));
    });

    const response = await request(app, '/end');
    assert.equal(response.statusCode, 404);
    assert.match(response.headers['content-type'], /^application\/json/);
    assert.deepEqual(parseJson(response), expected);
    assert.deepEqual(errors, []);
    assert.deepEqual(logs, []);
  });
});

test('raw error writes are blocked before they bypass the finalizer', async () => {
  await withProductionFinalization(async () => {
    const { app, errors, logs } = createApp((router) => {
      router.get('/write', (_req, res) => {
        res.status(409);
        res.write('{"error":"bypass"}');
        return res.end();
      });
    });

    const response = await request(app, '/write');
    assert.equal(response.statusCode, 500);
    assert.deepEqual(parseJson(response), { error: 'Test error handler' });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'NONCANONICAL_ERROR_WRITE');
    assert.deepEqual(logs[0], {
      entry: {
        operation: 'response.error.canonicalized',
        context: {
          route: '/write',
          status: 409,
          requestId: 'a7c-test-request',
          reason: 'streamed-error-write',
        },
      },
      message: 'Canonicalized nonconforming error response',
    });
  });
});

test('server mounts the response finalizer after request logging and before API routes', () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.js'), 'utf8');
  const requestLoggerMount = serverSource.indexOf('app.use(requestLogger);');
  const finalizerMount = serverSource.indexOf('app.use(responseFinalizer);');
  const firstRouteMount = serverSource.indexOf("app.use('/api/health'");

  assert.ok(requestLoggerMount >= 0);
  assert.ok(finalizerMount > requestLoggerMount);
  assert.ok(firstRouteMount > finalizerMount);
});
