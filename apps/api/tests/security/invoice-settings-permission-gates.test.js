'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const SETTINGS_PERMISSION = 'accounting.invoices.manage_settings';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request({ body = {}, params = {}, user } = {}) {
  return { body, params, user };
}

function routeStack(router, method, routePath) {
  const layer = router.stack.find((candidate) => candidate.route?.path === routePath && candidate.route.methods[method]);
  assert.ok(layer, `expected ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack;
}

async function runRoute(stack, req, res) {
  let index = 0;
  const next = async (err) => {
    assert.equal(err, undefined, 'route middleware should not fail');
    const layer = stack[index++];
    if (layer) await layer.handle(req, res, next);
  };
  await next();
}

async function withRouter(relativePath, mocks, fn) {
  const resolved = path.join(root, relativePath);
  const prior = require.cache[require.resolve(resolved)];
  const originalLoad = Module._load;

  delete require.cache[require.resolve(resolved)];
  Module._load = function load(requestName, parent, isMain) {
    if (Object.hasOwn(mocks, requestName)) return mocks[requestName];
    return originalLoad.call(this, requestName, parent, isMain);
  };

  try {
    return await fn(require(resolved));
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(resolved)];
    if (prior) require.cache[require.resolve(resolved)] = prior;
  }
}

const passValidation = () => (req, res, next) => next();
const safeError = (res, err) => res.status(500).json({ error: err.message });
const admin = { role: 'admin', permissions: [] };
const nonAdmin = { role: 'viewer', permissions: [] };
const authorizedNonAdmin = { role: 'viewer', permissions: [SETTINGS_PERMISSION] };

test('retention CRUD denies ungranted non-admins and permits admins or explicitly authorized non-admins', async () => {
  const calls = [];
  const pool = {
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('UPDATE')) return { rows: [{ id: 'r-1', classification: 'invoice', status: 'submitted', retention_days: 60, delete_pdf: true, delete_box: true }] };
      if (sql.startsWith('INSERT')) return { rows: [{ id: 'r-2', classification: 'invoice', status: 'submitted', retention_days: 45, delete_pdf: true, delete_box: true }] };
      if (sql.startsWith('SELECT')) return { rows: [{ id: 'r-3', classification: 'invoice' }] };
      return { rows: [] };
    },
  };

  await withRouter('modules/invoices/routes/settings.js', {
    '../services/settingsService': {
      updateRetentionSetting: async (id) => (await pool.query('UPDATE retention_settings', [id])).rows[0],
      createRetentionSetting: async () => (await pool.query('INSERT INTO retention_settings')).rows[0],
      deleteRetentionSetting: async () => { await pool.query('SELECT * FROM retention_settings'); await pool.query('DELETE FROM retention_settings'); return { kind: 'deleted' }; },
    },
    '../services/spectrum': { getGlAccounts: async () => [] },
    '../services/utils': { readJSON: () => [] },
    '../../../config': {},
    '../services/approvalValidator': { getApprovalSchema: () => ({}), validateApproval: async () => ({}) },
    '../services/matching': { getSubcontractsMap: async () => new Map() },
    '../../../lib/auditEvents': { emitPlatformAuditEvent: async () => null },
    '../../../middleware/validate': { validate: passValidation },
    '../../../lib/schemas': {},
    '../../../middleware/errorResponse': { safeError },
  }, async (router) => {
    const routes = [
      ['put', '/retention/:id', { body: { retention_days: 60 }, params: { id: 'r-1' } }],
      ['post', '/retention', { body: { classification: 'invoice', status: 'submitted' } }],
      ['delete', '/retention/:id', { params: { id: 'r-3' } }],
    ];

    for (const [method, routePath, options] of routes) {
      const res = response();
      await runRoute(routeStack(router, method, routePath), request({ ...options, user: nonAdmin }), res);
      assert.equal(res.statusCode, 403);
      assert.deepEqual(res.body, { error: 'Forbidden' });
    }
    assert.equal(calls.length, 0, 'denied retention mutations must not query the database');

    for (const [actorLabel, user] of [['admin', admin], ['authorized non-admin', authorizedNonAdmin]]) {
      for (const [method, routePath, options] of routes) {
        const res = response();
        await runRoute(routeStack(router, method, routePath), request({ ...options, user }), res);
        assert.ok(res.statusCode < 400, `${actorLabel} ${method.toUpperCase()} ${routePath} should succeed`);
      }
    }
  });

  assert.equal(calls.length, 8, 'authorized retention CRUD should perform its expected writes/checks');
});

test('Spectrum refresh denies ungranted non-admins and permits authorized callers without a real child process', async () => {
  const spawnCalls = [];
  const spectrumState = { running: false, startedAt: null };
  const child = new EventEmitter();
  child.unref = () => {};

  await withRouter('modules/invoices/routes/vendors.js', {
    child_process: { spawn: (...args) => { spawnCalls.push(args); return child; } },
    '../services/utils': { readJSON: () => ({}), writeJSON: () => {} },
    '../services/spectrum': { spectrumState },
    '../../../config': { VENDORS_PATH: '', SPECTRUM_REFRESH_PATH: '' },
    '../../../middleware/errorResponse': { safeError },
  }, async (router) => {
    const stack = routeStack(router, 'post', '/refresh');
    let res = response();
    await runRoute(stack, request({ user: nonAdmin }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(spawnCalls.length, 0, 'denied refresh must not start a child process');

    for (const [actorLabel, user] of [['admin', admin], ['authorized non-admin', authorizedNonAdmin]]) {
      spectrumState.running = false;
      res = response();
      await runRoute(stack, request({ user }), res);
      assert.equal(res.statusCode, 200, `${actorLabel} should start the refresh`);
      assert.equal(res.body.status, 'started');
    }
    assert.equal(spawnCalls.length, 2);
  });
});

test('pipeline error retry denies ungranted non-admins and permits authorized callers', async () => {
  const calls = [];
  const pool = { async query(sql, values) { calls.push([sql, values]); return { rows: [] }; } };

  await withRouter('modules/invoices/routes/pipeline.js', {
    child_process: { spawn: () => { throw new Error('not used by retry'); } },
    '../services/pipelineErrorService': { listPipelineErrors: async () => [], resolvePipelineError: async () => {}, retryPipelineError: async (id) => pool.query('UPDATE pipeline_errors SET retry_count = 0, resolved = false WHERE id = $1', [id]) },
    '../services/utils': { readJSON: () => ({}) },
    '../../../config': { PIPELINE_STATUS_PATH: '' },
    '../../../middleware/errorResponse': { safeError },
    '../../../middleware/validate': { validate: passValidation },
    '../../../lib/schemas': {},
  }, async (router) => {
    const stack = routeStack(router, 'post', '/errors/:id/retry');
    let res = response();
    await runRoute(stack, request({ params: { id: 'error-1' }, user: nonAdmin }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(calls.length, 0, 'denied retry must not update the database');

    for (const [actorLabel, user] of [['admin', admin], ['authorized non-admin', authorizedNonAdmin]]) {
      res = response();
      await runRoute(stack, request({ params: { id: 'error-1' }, user }), res);
      assert.equal(res.statusCode, 200, `${actorLabel} should reset the retry`);
      assert.deepEqual(res.body, { reset: true });
    }
  });

  assert.deepEqual(calls, Array.from({ length: 2 }, () => [
    'UPDATE pipeline_errors SET retry_count = 0, resolved = false WHERE id = $1',
    ['error-1'],
  ]));
});

test('settings mutation permission is available to a granted non-admin role', () => {
  const { checkPermission } = require('../../middleware/permissions');
  assert.equal(checkPermission({ user: authorizedNonAdmin }, SETTINGS_PERMISSION), true);
});
