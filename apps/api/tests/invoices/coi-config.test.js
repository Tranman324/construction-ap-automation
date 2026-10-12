'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const { assertCanonicalErrorBody } = require('../helpers/assertCanonicalErrorResponse');

const root = path.resolve(__dirname, '..', '..');
// The frontend test fixture was deleted with the server-authoritative detail
// cutover. Keep this synthetic parity fixture local to the backend test: it
// has no production import path and does not restore frontend config authority.
const coiSource = path.resolve(
  __dirname, '../fixtures/coi-config.fixture.js',
);

// Derive expected values from the frontend fixture (read, not retyped).
function extractBalanced(src, name, open, close) {
  const eq = src.indexOf('=', src.indexOf(name));
  const start = src.indexOf(open, eq);
  let depth = 0;
  let i = start;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === open) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) break; }
  }
  // eslint-disable-next-line no-eval
  return eval(`(${src.slice(start, i + 1)})`);
}

function expectedConfigFromFixture() {
  const src = fs.readFileSync(coiSource, 'utf8');
  return extractBalanced(src, 'SEEDED_COI_CONFIG', '{', '}');
}

function seededConfigFromMigration() {
  const sql = fs.readFileSync(path.join(root, 'migrations', '2026-07-18_coi_compliance_config.sql'), 'utf8');
  const m = sql.match(/VALUES\s*\(\s*1\s*,\s*'([\s\S]*?)'::jsonb\)/);
  assert.ok(m, 'could not extract seeded JSON from migration');
  return JSON.parse(m[1].replace(/''/g, "'")); // undo SQL single-quote escaping
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

const auditEventsStub = {
  getRequestAuditActor: (req) => ({ name: req?.user?.email || 'system', userId: req?.user?.email || 'system', role: null }),
  emitPlatformAuditEvent: async () => ({ id: 'evt' }),
};

// Seed parity is the load-bearing proof for the P1 catalog kill.
test('seeded COI compliance config is value-identical to the frontend constant', () => {
  const expected = expectedConfigFromFixture();
  const seed = seededConfigFromMigration();
  assert.deepEqual(seed, expected);
});

test('GET /api/coi-config serves the seeded config with the full shape', async () => {
  const expected = expectedConfigFromFixture();
  const seed = seededConfigFromMigration();
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool: { async query() { return { rows: [{ config: seed }] }; } } },
    '../../../lib/auditEvents': auditEventsStub,
  }, async () => {
    const { getCoiConfig } = freshRequire('modules/invoices/services/coiConfigService.js');
    await getCoiConfig({}, res);
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ...expected, warnWindowDays: 30 });
  assert.equal(typeof res.body.certificateHolder.name, 'string');
  assert.equal(typeof res.body.cancellationNoticeMinimumDays, 'number');
  assert.ok(Array.isArray(res.body.coverageRequirements));
  assert.equal(typeof res.body.coverageTypeAliases, 'object');
});

test('GET returns 404 with the canonical shape when the config row is absent', async () => {
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool: { async query() { return { rows: [] }; } } },
    '../../../lib/auditEvents': auditEventsStub,
  }, async () => {
    const { getCoiConfig } = freshRequire('modules/invoices/services/coiConfigService.js');
    await getCoiConfig({}, res);
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'COI_CONFIG_NOT_CONFIGURED');
});

// Malformed PUT rejected 422 with the row unchanged (the load-bearing guard).
function malformedConfig() {
  const bad = expectedConfigFromFixture();
  // Corrupt a coverage limit's minimum to a string, and add an unknown key.
  bad.coverageRequirements[0].limits[0].minimum = 'not-a-number';
  bad.unexpectedKey = true;
  return bad;
}

async function runPut(body) {
  const calls = [];
  const res = makeRes();
  const oldConfig = { marker: 'old' };
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/WHERE effective_from <=/.test(sql)) return { rows: [{ id: 'v1', config: oldConfig, effective_from: new Date('2026-01-01T00:00:00Z'), author: 'seed', created_at: new Date('2026-01-01T00:00:00Z') }] };
      if (/COALESCE\(MAX\(version\)/.test(sql)) return { rows: [{ version: 2 }] };
      if (/INSERT INTO coi_config_versions/.test(sql)) return { rows: [{ id: 'v2', config: JSON.parse(params[3]), effective_from: params[2], author: params[5], created_at: params[4] }] };
      return { rows: [] };
    },
  };
  const captured = [];
  await withMockedModules({
    './supabase': { pool },
    '../../../lib/auditEvents': {
      getRequestAuditActor: (req) => ({ name: req?.user?.email || 'system', userId: req?.user?.email || 'system', role: null }),
      emitPlatformAuditEvent: async (req, r, options) => { captured.push(options); return { id: 'evt-1' }; },
    },
    '../../../middleware/errorResponse': require('../../middleware/errorResponse'),
  }, async () => {
    const { updateCoiConfig } = freshRequire('modules/invoices/services/coiConfigService.js');
    await updateCoiConfig({ body, user: { email: 'admin@northwindcg.example' } }, res);
  });
  return { res, calls, captured };
}

test('a malformed PUT is rejected 422 with the canonical shape and the row unchanged', async () => {
  const { res, calls } = await runPut(malformedConfig());
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'INVALID_COI_CONFIG');
  // History unchanged: no append ran.
  assert.equal(calls.filter((c) => /INSERT INTO coi_config_versions/.test(c.sql)).length, 0);
});

test('unknown top-level keys are rejected 422', async () => {
  const bad = expectedConfigFromFixture();
  bad.somethingElse = 'nope';
  const { res } = await runPut(bad);
  assert.equal(res.statusCode, 422);
});

// Route gate.
function findRouteHandlers(router, method, routePath) {
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route.methods[method]);
  assert.ok(layer, `expected ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack.map((s) => s.handle);
}

test('PUT /api/coi-config is refused (403) without manage_settings and allowed with it', async () => {
  await withMockedModules({
    './supabase': { pool: { async query() { return { rows: [] }; } } },
    '../../../lib/auditEvents': auditEventsStub,
  }, async () => {
    const router = freshRequire('modules/invoices/routes/coi-config.js');
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

test('a valid PUT persists the config and emits an audit event with before/after state', async () => {
  const config = expectedConfigFromFixture();
  const { res, calls, captured } = await runPut(config);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ...config, warnWindowDays: 30 });
  assert.ok(calls.find((c) => /INSERT INTO coi_config_versions/.test(c.sql)));
  assert.equal(captured.length, 1);
  assert.equal(captured[0].type, 'settings.coi_config.updated');
  assert.equal(captured[0].beforeState.config.marker, 'old');
  assert.deepEqual(captured[0].afterState.config, { ...config, warnWindowDays: 30 });
});

test('effective config selection uses server time and stable physical-id ties', async () => {
  const rows = [
    { id: 'a', config: { marker: 'old' }, effective_from: new Date('2026-08-01T00:00:00Z'), created_at: new Date('2026-08-01T00:00:00Z'), author: 'a' },
    { id: 'b', config: { marker: 'tie-loser' }, effective_from: new Date('2026-08-02T00:00:00Z'), created_at: new Date('2026-08-02T00:00:00Z'), author: 'b' },
    { id: 'z', config: { marker: 'tie-winner' }, effective_from: new Date('2026-08-02T00:00:00Z'), created_at: new Date('2026-08-02T00:00:00Z'), author: 'z' },
    { id: 'future', config: { marker: 'future' }, effective_from: new Date('2026-08-03T00:00:00Z'), created_at: new Date('2026-08-03T00:00:00Z'), author: 'future' },
  ];
  await withMockedModules({
    './supabase': { pool: { async query(sql, [now]) { return { rows: rows.filter((row) => row.effective_from <= now).sort((a, b) => b.effective_from - a.effective_from || b.created_at - a.created_at || b.id.localeCompare(a.id)).slice(0, 1) }; } } },
    '../../../lib/auditEvents': auditEventsStub,
  }, async () => {
    const { getEffectiveCoiConfig } = freshRequire('modules/invoices/services/coiConfigService.js');
    const before = await getEffectiveCoiConfig(undefined, new Date('2026-08-02T12:00:00Z'));
    const after = await getEffectiveCoiConfig(undefined, new Date('2026-08-03T00:00:00Z'));
    assert.equal(before.id, 'z');
    assert.equal(before.config.marker, 'tie-winner');
    assert.equal(after.id, 'future');
  });
});

test('an impossible effectiveFrom date is rejected before any history append', async () => {
  const { res, calls } = await runPut({ ...expectedConfigFromFixture(), effectiveFrom: '2026-02-30T00:00:00.000Z' });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'INVALID_COI_CONFIG');
  assert.equal(calls.length, 0);
  assert.equal(calls.filter((call) => /INSERT INTO coi_config_versions/.test(call.sql)).length, 0);
});

test('history list returns forensic shape, total, pagination, and config default', async () => {
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool: { async query(sql) {
      if (/COUNT/.test(sql)) return { rows: [{ count: 3 }] };
      return { rows: [{ id: 'v3', config: { marker: 'latest' }, effective_from: new Date('2026-08-03T00:00:00Z'), author: 'admin', created_at: new Date('2026-08-03T00:00:00Z') }] };
    } } },
    '../../../lib/auditEvents': auditEventsStub,
  }, async () => {
    const { listCoiConfigVersions } = freshRequire('modules/invoices/services/coiConfigService.js');
    await listCoiConfigVersions({ query: { limit: '1', offset: '1' } }, res);
  });
  assert.deepEqual(Object.keys(res.body).sort(), ['limit', 'offset', 'total', 'versions']);
  assert.equal(res.body.total, 3); assert.equal(res.body.limit, 1); assert.equal(res.body.offset, 1);
  assert.deepEqual(Object.keys(res.body.versions[0]).sort(), ['author', 'config', 'createdAt', 'effectiveFrom', 'id']);
  assert.equal(res.body.versions[0].config.warnWindowDays, 30);
});

test('a future-effective write appends metadata while retaining the current config', async () => {
  const future = '2026-12-01T00:00:00.000Z';
  const { res, calls } = await runPut({ ...expectedConfigFromFixture(), effectiveFrom: future });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.version.id, 'v2');
  assert.equal(res.body.version.effectiveFrom, future);
  assert.equal(res.body.config.marker, 'old');
  assert.equal(calls.filter((call) => /INSERT INTO coi_config_versions/.test(call.sql)).length, 1);
});

test('version detail maps the forensic shape and missing ids return canonical 404', async () => {
  const hit = makeRes(); const miss = makeRes();
  await withMockedModules({
    './supabase': { pool: { async query(_sql, params) { return { rows: params[0] === 'v2' ? [{ id: 'v2', config: { marker: 'x' }, effective_from: new Date('2026-08-02T00:00:00Z'), author: 'admin', created_at: new Date('2026-08-01T00:00:00Z') }] : [] }; } } },
    '../../../lib/auditEvents': auditEventsStub,
  }, async () => {
    const { getCoiConfigVersion } = freshRequire('modules/invoices/services/coiConfigService.js');
    await getCoiConfigVersion({ params: { id: 'v2' } }, hit);
    await getCoiConfigVersion({ params: { id: 'missing' } }, miss);
  });
  assert.equal(hit.body.id, 'v2'); assert.equal(hit.body.config.warnWindowDays, 30);
  assert.equal(miss.statusCode, 404); assert.equal(miss.body.code, 'COI_CONFIG_VERSION_NOT_FOUND');
});

test('history routes refuse callers without the exact manage_settings permission', async () => {
  await withMockedModules({ './supabase': { pool: { async query() { return { rows: [] }; } } }, '../../../lib/auditEvents': auditEventsStub }, async () => {
    const router = freshRequire('modules/invoices/routes/coi-config.js');
    for (const routePath of ['/versions', '/versions/:id']) {
      const gate = findRouteHandlers(router, 'get', routePath)[0]; const res = makeRes(); let next = false;
      gate({ user: { role: 'Leadership', permissions: ['invoices.manage_settings'] } }, res, () => { next = true; });
      assert.equal(next, false); assert.equal(res.statusCode, 403);
    }
  });
});
