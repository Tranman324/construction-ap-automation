'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const { assertCanonicalErrorBody } = require('../helpers/assertCanonicalErrorResponse');

const root = path.resolve(__dirname, '..', '..');
const webSrc = path.resolve(root, '..', 'web', 'src', 'modules', 'accounting', 'modules', 'invoices');

// ── The original frontend constants (documentDestinations.ts + the per-type
// destination constants) were DELETED in the P1 rewire — the values now live
// only in the backend seed and the frontend's test-only fixture. Parity is
// pinned against that fixture so both apps' tests provably run on the same
// values. ──
function extractObjectLiteral(src, name) {
  const eq = src.indexOf('=', src.indexOf(name));
  const open = src.indexOf('{', eq);
  let depth = 0;
  let i = open;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) break; }
  }
  // eslint-disable-next-line no-eval
  return eval(`(${src.slice(open, i + 1)})`);
}

function expectedCatalogFromFrontend() {
  const src = fs.readFileSync(path.join(webSrc, 'lib', 'destinationsFixture.ts'), 'utf8');
  return extractObjectLiteral(src, 'SEEDED_DESTINATIONS');
}

function seededConfigFromMigration() {
  const sql = fs.readFileSync(path.join(root, 'migrations', '2026-07-18_document_destinations.sql'), 'utf8');
  const m = sql.match(/VALUES\s*\(\s*1\s*,\s*'([\s\S]*?)'::jsonb\)/);
  assert.ok(m, 'could not extract seeded JSON from migration');
  return JSON.parse(m[1]);
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) {
      if (this.statusCode >= 400) assertCanonicalErrorBody(body);
      this.body = body;
      return this;
    },
  };
}

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function freshRequire(relativePath) {
  const resolvedPath = require.resolve(path.join(root, relativePath));
  delete require.cache[resolvedPath];
  return require(resolvedPath);
}

// Prevents the real lib/auditEvents -> lib/db (createClient) load at import time.
const auditEventsStub = {
  getRequestAuditActor: (req) => ({ name: req?.user?.email || 'system', userId: req?.user?.email || 'system', role: null }),
  emitPlatformAuditEvent: async () => ({ id: 'evt' }),
};

// Seed parity is the load-bearing proof: the migration seed must equal the
// frontend constants exactly (a later frontend task deletes them on this basis).
test('seeded document destinations are value-identical to the frontend constants', () => {
  const expected = expectedCatalogFromFrontend();
  const seed = seededConfigFromMigration();
  assert.deepEqual(seed, expected);
});

test('GET /api/document-destinations serves the seeded catalog with the full shape', async () => {
  const expected = expectedCatalogFromFrontend();
  const seed = seededConfigFromMigration();
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool: { async query() { return { rows: [{ config: seed }] }; } } },
    '../../../lib/auditEvents': auditEventsStub,
  }, async () => {
    const { getDocumentDestinations } = freshRequire('modules/invoices/services/documentDestinationsService.js');
    await getDocumentDestinations({}, res);
  });

  assert.equal(res.statusCode, 200);
  // Serves the exact frontend-derived catalog (seed round-trip).
  assert.deepEqual(res.body, expected);
  // Full shape pinned.
  assert.equal(typeof res.body.rootLabel, 'string');
  assert.ok(Array.isArray(res.body.tree));
  assert.deepEqual(Object.keys(res.body.defaults).sort(), ['lien-waiver', 'other', 'subcontract', 'warranty']);
  for (const node of res.body.tree) {
    assert.ok(typeof node.id === 'string' && typeof node.name === 'string' && Array.isArray(node.children));
  }
});

test('GET returns 404 with the canonical shape when the catalog row is absent', async () => {
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool: { async query() { return { rows: [] }; } } },
    '../../../lib/auditEvents': auditEventsStub,
  }, async () => {
    const { getDocumentDestinations } = freshRequire('modules/invoices/services/documentDestinationsService.js');
    await getDocumentDestinations({}, res);
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'DESTINATIONS_NOT_CONFIGURED');
});

// Route gate: PUT requires manage_settings; GET requires the view-level read.
function findRouteHandlers(router, method, routePath) {
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route.methods[method]);
  assert.ok(layer, `expected ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack.map((s) => s.handle);
}

test('PUT /api/document-destinations is refused (403) without manage_settings and allowed with it', async () => {
  await withMockedModules({
    './supabase': { pool: { async query() { return { rows: [] }; } } },
    '../../../lib/auditEvents': auditEventsStub,
  }, async () => {
    const router = freshRequire('modules/invoices/routes/document-destinations.js');
    const gate = findRouteHandlers(router, 'put', '/')[0];

    const deniedRes = makeRes();
    let deniedNext = false;
    gate({ user: { role: 'viewer', permissions: [] } }, deniedRes, () => { deniedNext = true; });
    assert.equal(deniedNext, false);
    assert.equal(deniedRes.statusCode, 403);

    let allowedNext = false;
    gate({ user: { role: 'viewer', permissions: ['accounting.invoices.manage_settings'] } }, makeRes(), () => { allowedNext = true; });
    assert.equal(allowedNext, true);
  });
});

test('current destination GET uses view_details and history reads use manage_settings', async () => {
  await withMockedModules({
    './supabase': { pool: { async query() { return { rows: [] }; } } },
    '../../../lib/auditEvents': auditEventsStub,
  }, async () => {
    const router = freshRequire('modules/invoices/routes/document-destinations.js');

    const currentGate = findRouteHandlers(router, 'get', '/')[0];
    const currentDeniedRes = makeRes();
    let currentNext = false;
    currentGate({ user: { role: 'viewer', permissions: [] } }, currentDeniedRes, () => { currentNext = true; });
    assert.equal(currentNext, false);
    assert.equal(currentDeniedRes.statusCode, 403);

    for (const routePath of ['/versions', '/versions/:id']) {
      const gate = findRouteHandlers(router, 'get', routePath)[0];
      const deniedRes = makeRes();
      let deniedNext = false;
      gate({ user: { role: 'viewer', permissions: ['accounting.invoices.view_details'] } }, deniedRes, () => { deniedNext = true; });
      assert.equal(deniedNext, false, `${routePath} must require manage_settings`);
      assert.equal(deniedRes.statusCode, 403);

      let allowedNext = false;
      gate({ user: { role: 'viewer', permissions: ['accounting.invoices.manage_settings'] } }, makeRes(), () => { allowedNext = true; });
      assert.equal(allowedNext, true, `${routePath} should allow manage_settings`);
    }
  });
});

test('a valid PUT persists the config and emits an audit event with before/after state', async () => {
  const oldConfig = { rootLabel: '(Job root)', tree: [], defaults: { subcontract: 'x', warranty: 'y', 'lien-waiver': 'z', other: '(Job root)' } };
  const newConfig = expectedCatalogFromFrontend();
  const captured = [];
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT config FROM document_destinations WHERE id = 1 FOR UPDATE/.test(sql)) return { rows: [{ config: oldConfig }] };
      if (/FROM document_destination_versions WHERE effective_from <=/.test(sql)) return { rows: [{ id: 'v1', config: oldConfig, effective_from: new Date('2026-07-01T00:00:00.000Z'), created_at: new Date('2026-07-01T00:00:00.000Z'), author: 'seed' }] };
      if (/COALESCE\(MAX\(version\)/.test(sql)) return { rows: [{ version: 1 }] };
      if (/INSERT INTO document_destination_versions/.test(sql)) return { rows: [{ id: 'v2', config: JSON.parse(params[3]), effective_from: params[2], created_at: params[4], author: params[5] }] };
      return { rows: [] };
    },
  };
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool },
    '../../../lib/auditEvents': {
      getRequestAuditActor: (req) => ({ name: req?.user?.email || 'system', userId: req?.user?.email || 'system', role: null }),
      emitPlatformAuditEvent: async (req, r, options) => { captured.push(options); return { id: 'evt-1' }; },
    },
    '../../../middleware/errorResponse': require('../../middleware/errorResponse'),
  }, async () => {
    const { updateDocumentDestinations } = freshRequire('modules/invoices/services/documentDestinationsService.js');
    await updateDocumentDestinations({ body: newConfig, user: { email: 'admin@northwindcg.example' } }, res);
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, newConfig);
  assert.ok(calls.find((c) => /INSERT INTO document_destination_versions/.test(c.sql)));
  assert.equal(captured.length, 1);
  assert.equal(captured[0].type, 'settings.document_destinations.updated');
  assert.deepEqual(captured[0].beforeState.config, oldConfig);
  assert.deepEqual(captured[0].afterState.config, newConfig);
});

// Rider (coverage-symmetry with the COI 422 tests): a malformed body driven
// through the FULL PUT middleware chain (gate -> validate -> handler) is rejected
// 400 by the validate middleware, and the handler (the DB write) is never reached.
test('rider: a malformed PUT /api/document-destinations is refused 400 through the real middleware chain, no write', async () => {
  const writes = [];
  await withMockedModules({
    './supabase': { pool: { async query(sql) { writes.push(sql); return { rows: [] }; } } },
    '../../../lib/auditEvents': auditEventsStub,
  }, async () => {
    const router = freshRequire('modules/invoices/routes/document-destinations.js');
    const layer = router.stack.find((l) => l.route?.path === '/' && l.route.methods.put);
    const stack = layer.route.stack.map((s) => s.handle); // [requirePermission, validate, handler]
    assert.equal(stack.length, 3);

    const req = {
      method: 'PUT',
      user: { role: 'viewer', permissions: ['accounting.invoices.manage_settings'] },
      // Otherwise-valid config plus an unknown key -> strict schema rejects it.
      body: {
        rootLabel: '(Job root)',
        tree: [],
        defaults: { subcontract: 'a', warranty: 'b', 'lien-waiver': 'c', other: 'd' },
        unexpectedKey: true,
      },
    };
    const res = makeRes();

    let handlerReached = false;
    const chain = [stack[0], stack[1], async () => { handlerReached = true; }];
    let i = 0;
    const next = async () => { const h = chain[i]; i += 1; if (h) await h(req, res, next); };
    await next();

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Validation failed');
    assert.equal(handlerReached, false); // validate short-circuited; no write reached
    assert.equal(writes.length, 0);
  });
});
