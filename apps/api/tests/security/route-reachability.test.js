'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const root = path.resolve(__dirname, '..', '..');
const MOUNTS = [
  ['/api/invoices', 'modules/invoices/routes/invoices.js'], ['/api/vendors', 'modules/invoices/routes/vendors.js'],
  ['/api/jobs', 'modules/invoices/routes/jobs.js'], ['/api/subcontracts', 'modules/invoices/routes/subcontracts.js'],
  ['/api/rules', 'modules/invoices/routes/rules.js'], ['/api/pipeline', 'modules/invoices/routes/pipeline.js'],
  ['/api/ignore-rules', 'modules/invoices/routes/ignore-rules.js'], ['/api/feedback', 'modules/invoices/routes/feedback.js'],
  ['/api/lien-waivers', 'modules/invoices/routes/lien-waivers.js'], ['/api/users', 'modules/invoices/routes/users.js'],
  ['/api/splits', 'modules/invoices/routes/splits.js'], ['/api/document-destinations', 'modules/invoices/routes/document-destinations.js'],
  ['/api/coi-config', 'modules/invoices/routes/coi-config.js'], ['/api/documents', 'modules/invoices/routes/documents.js'],
  ['/api', 'modules/invoices/routes/settings.js'], ['/api/feature-requests', 'modules/feature-requests/routes.js'],
  ['/api/roles', 'routes/roles.js'], ['/api', 'routes/permissions.js'], ['/api/title-rules', 'routes/title-rules.js'],
  ['/api/admin/users', 'routes/admin-users.js'], ['/api/audit', 'routes/audit-events.js'], ['/api/health', 'modules/invoices/routes/health.js'],
];
const AUTH_ONLY = new Set([
  'post /api/audit/events', 'get /api/feature-requests/', 'post /api/feature-requests/',
  'post /api/feature-requests/:id/vote', 'delete /api/feature-requests/:id/vote', 'get /api/health/',
]);

function inertDatabase() {
  const blocked = async () => { throw new Error('database boundary reached before a permission gate'); };
  const chain = new Proxy(function inertQueryBuilder() {}, { apply: () => chain, get: (_target, key) => key === 'then' ? undefined : chain });
  return { audit: blocked, connect: blocked, pool: { connect: blocked, on() {}, query: blocked }, query: blocked, supabase: chain };
}

function entriesFor(router, prefix, source) {
  const entries = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const routePath of (Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path])) {
      for (const method of Object.keys(layer.route.methods)) {
        entries.push({ layer, method, path: `${prefix.replace(/\/$/, '')}${routePath === '/' ? '/' : routePath}`, source });
      }
    }
  }
  return entries;
}

function listeners() { return new Map(process.eventNames().map((event) => [event, process.listenerCount(event)])); }
function assertSameListeners(before, after, label) { assert.deepEqual([...after].sort(), [...before].sort(), `${label} changed process listener registration`); }
async function settle() { await new Promise((resolve) => setImmediate(resolve)); await Promise.resolve(); }

function rejectingMsalModule() {
  return {
    ConfidentialClientApplication: class {
      async acquireTokenByClientCredential() {
        throw new Error('route harness blocks MSAL token acquisition');
      }
    },
  };
}

async function constructMountedRouters({ msalModule = rejectingMsalModule() } = {}) {
  const dbPath = path.join(root, 'lib', 'db.js');
  const usersPath = path.join(root, 'modules', 'invoices', 'routes', 'users.js');
  const logger = require(path.join(root, 'lib', 'logger.js'));
  const originalLoad = Module._load;
  const originalWarn = logger.warn;
  const warnings = [];
  logger.warn = function captureWarmWarning(...args) { warnings.push(args); return originalWarn.apply(this, args); };
  Module._load = function routeHarnessLoad(request, parent, isMain) {
    if (request === '/etc/toolbox/paths.js') return { BOX_SCRIPT: '/__route_reachability__/box.js', WEBHOOKS_JSON: '/__route_reachability__/webhooks.json' };
    if (request === '@azure/msal-node' && msalModule) return msalModule;
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch {}
    if (resolved === dbPath) return inertDatabase();
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(usersPath)];
    const app = express();
    const routers = [];
    for (const [prefix, file] of MOUNTS) {
      const resolved = path.join(root, file);
      delete require.cache[require.resolve(resolved)];
      const router = require(resolved);
      routers.push([prefix, file, router]);
      app.use(prefix, router);
    }
    const adminUsers = routers.find(([, file]) => file === 'routes/admin-users.js')[2];
    app.use('/api/users', adminUsers.bumpVersionRouter);
    await settle();
    // The real users-router import is intentionally allowed to finish its
    // fail-soft cache warm before this harness establishes its baseline.
    const settledListeners = listeners();
    assert.ok(warnings.some((args) => args.includes('User cache warm failed; will retry on first request')), 'real users router must emit its expected fail-soft cache-warm warning');
    return { app, entries: [...routers.flatMap(([prefix, file, router]) => entriesFor(router, prefix, file)), ...entriesFor(adminUsers.bumpVersionRouter, '/api/users', 'routes/admin-users.js:bumpVersionRouter')], settledListeners, warnings };
  } finally {
    Module._load = originalLoad;
    logger.warn = originalWarn;
  }
}

function installTerminalSpy(entry) {
  const terminal = entry.layer.route.stack.filter((candidate) => candidate.method === entry.method).at(-1);
  assert.ok(terminal, `missing terminal for ${entry.method.toUpperCase()} ${entry.path}`);
  const original = terminal.handle;
  let calls = 0;
  terminal.handle = (_req, res) => { calls += 1; return res.status(598).json({ error: 'terminal reached' }); };
  return { calls: () => calls, restore: () => { terminal.handle = original; } };
}

function dispatch(app, entry) {
  return new Promise((resolve, reject) => {
    const url = entry.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_whole, name) => `${name}-fixture`);
    const key = `${entry.method} ${entry.path}`;
    const body = key === 'post /api/invoices/bulk'
      ? { action: 'approve', ids: ['fixture-id'] }
      : key === 'patch /api/feature-requests/:id'
        ? { status: 'open' }
        : {};
    const req = { body, headers: {}, method: entry.method.toUpperCase(), originalUrl: url, url, user: { role: 'viewer', permissions: [] }, log: { debug() {}, error() {}, fatal() {}, info() {}, warn() {} }, on() {}, resume() {}, socket: {}, unpipe() {} };
    const res = { body: null, headersSent: false, locals: {}, statusCode: 200, end() { this.headersSent = true; resolve(this); }, getHeader() { return undefined; }, json(body) { this.body = body; this.headersSent = true; resolve(this); return this; }, removeHeader() {}, set() { return this; }, setHeader() {}, status(code) { this.statusCode = code; return this; } };
    app.handle(req, res, reject);
  });
}

function resolveInvokerTarget({ command, workdir }) {
  const [, script] = command.trim().split(/\s+/, 2);
  assert.ok(script, `expected an interpreter and script in ${command}`);
  return path.isAbsolute(script) ? script : path.resolve(workdir, script);
}

test('constructed mounted routes reject a denied user before every terminal handler', async () => {
  const harness = await constructMountedRouters();
  assert.ok(harness.entries.some((entry) => entry.path === '/api/routing-codes'));
  assert.ok(harness.entries.some((entry) => entry.path === '/api/backend/routing-codes'));
  assert.ok(harness.entries.some((entry) => entry.method === 'post'));
  assert.ok(harness.entries.some((entry) => entry.method === 'patch'));
  assert.ok(harness.entries.some((entry) => entry.method === 'delete'));
  assert.ok(harness.entries.some((entry) => entry.method === 'head'));
  const protectedEntries = harness.entries.filter((entry) => !AUTH_ONLY.has(`${entry.method} ${entry.path}`));
  assert.equal(protectedEntries.length, 173, 'the constructed protected-route inventory is deliberate');
  for (const entry of protectedEntries) {
    const spy = installTerminalSpy(entry);
    try {
      const response = await dispatch(harness.app, entry);
      assert.equal(response.statusCode, 403, `${entry.method.toUpperCase()} ${entry.path}`);
      if (entry.method !== 'head') {
        assert.deepEqual(response.body, { error: 'Forbidden' }, `${entry.method.toUpperCase()} ${entry.path}`);
      }
      assert.equal(spy.calls(), 0, `${entry.method.toUpperCase()} ${entry.path} terminal must not run`);
    } finally { spy.restore(); }
  }
  assertSameListeners(harness.settledListeners, listeners(), 'unauthorized route execution');
});

test('the execution probe catches handler-before-gate and listener-registration sabotage', async () => {
  const router = express.Router();
  const denied = (_req, res) => res.status(403).json({ error: 'Forbidden' });
  router.route('/chained').get(denied).post(denied);
  const app = express();
  app.use('/nested', router);
  const entry = entriesFor(router, '/nested', 'fixture').find((candidate) => candidate.method === 'post');
  const terminal = entry.layer.route.stack.find((candidate) => candidate.method === 'post');
  const original = terminal.handle;
  terminal.handle = (_req, res) => res.status(598).json({ error: 'handler-before-gate' });
  try { assert.equal((await dispatch(app, entry)).statusCode, 598, 'handler-before-gate sabotage must make the execution probe red'); }
  finally { terminal.handle = original; }
  const before = listeners();
  const added = () => {};
  process.on('SIGUSR2', added);
  try { assert.throws(() => assertSameListeners(before, listeners(), 'listener sabotage'), /changed process listener registration/); }
  finally { process.removeListener('SIGUSR2', added); }
});

test('external invoker inventory resolves relative commands against their declared workdir', () => {
  const invokers = [
    { name: 'invoice-scan', command: 'node modules/invoices/services/pipeline.js run', workdir: '/srv/invoice-api' },
    { name: 'invoice-rematch', command: 'node /srv/invoice-api/modules/invoices/services/rematch.js sweep', workdir: '/ignored-for-absolute-paths' },
  ];
  assert.deepEqual(
    invokers.map(resolveInvokerTarget),
    ['/srv/invoice-api/modules/invoices/services/pipeline.js', '/srv/invoice-api/modules/invoices/services/rematch.js']
  );
  assert.notEqual(
    resolveInvokerTarget(invokers[0]),
    path.resolve(process.cwd(), 'modules/invoices/services/pipeline.js'),
    'the invoice-scan control must fail if the declared workdir is ignored'
  );
});

test('injected Graph credentials still produce the offline fail-soft users warm warning', async () => {
  const names = ['MS_CLIENT_ID', 'MS_TENANT_ID', 'MS_CLIENT_SECRET'];
  const original = new Map(names.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  try {
    process.env.MS_CLIENT_ID = 'test-client';
    process.env.MS_TENANT_ID = 'test-tenant';
    process.env.MS_CLIENT_SECRET = 'test-secret';
    global.fetch = async () => { fetchCalls += 1; throw new Error('Graph must remain offline'); };
    const harness = await constructMountedRouters();
    assert.ok(harness.warnings.some((args) => args.includes('User cache warm failed; will retry on first request')));
    assert.equal(fetchCalls, 0, 'the MSAL token-rejection boundary must prevent a Graph fetch');
  } finally {
    global.fetch = originalFetch;
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
