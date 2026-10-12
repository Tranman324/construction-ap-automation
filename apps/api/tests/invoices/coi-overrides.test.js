'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const servicePath = path.resolve(__dirname, '../../modules/invoices/services/coiOverrideService.js');

function loadService(pool = {}) {
  const original = Module._load;
  Module._load = function mocked(request, parent, isMain) {
    if (parent?.filename === servicePath && request === './supabase') return { pool };
    if (parent?.filename === servicePath && request === './coiConfigService') return { getEffectiveCoiConfig: async () => ({ id: 'v1', config: { certificateHolder: { nameAliases: ['Correct'] }, cancellationNoticeMinimumDays: 30, coverageRequirements: [] } }) };
    if (parent?.filename === servicePath && request === '../../../lib/auditEvents') return { emitInvoiceAuditEvent: async (_req, _res, options) => { await options.client.query('INSERT INTO audit_events'); }, getRequestAuditActor: () => ({ name: 'tester' }) };
    return original.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[servicePath];
    return require(servicePath);
  } finally {
    Module._load = original;
    delete require.cache[servicePath];
  }
}

test('override service has no duplicate raw evaluator', () => {
  const source = require('node:fs').readFileSync(servicePath, 'utf8');
  assert.doesNotMatch(source, /function rawChecks/);
  assert.match(source, /evaluateCoiCompliance\(document/);
});

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function fixturePool({ auditFails = false, mutationFails = false, uniqueFails = false, classification = 'coi', missing = false } = {}) {
  const history = [];
  const active = new Map();
  const ledger = [];
  const events = [];
  let snapshot = null;
  const document = { id: 'coi-1', classification, vendor_code: 'V1', coi_data: { endorsements: { additionalInsured: false, waiverOfSubrogation: true }, holder: { name: 'Wrong' }, coverageLines: [] } };
  const client = {
    async query(sql, params = []) {
      history.push(sql);
      if (sql === 'BEGIN') { snapshot = { active: new Map(active), ledger: [...ledger] }; return { rows: [] }; }
      if (sql === 'COMMIT') { snapshot = null; return { rows: [] }; }
      if (sql === 'ROLLBACK') { active.clear(); for (const [key, value] of snapshot.active) active.set(key, value); ledger.length = 0; ledger.push(...snapshot.ledger); return { rows: [] }; }
      if (sql.startsWith('SELECT * FROM documents')) return { rows: missing ? [] : [document] };
      if (sql.startsWith('SELECT config')) { assert.match(sql, /coi_compliance_config/); assert.match(sql, /FOR SHARE/); return { rows: [{ config: { certificateHolder: { nameAliases: ['Correct'] }, cancellationNoticeMinimumDays: 30, coverageRequirements: [] }, updated_at: '2026-01-01T00:00:00Z' }] }; }
      if (sql.startsWith('SELECT id FROM coi_overrides')) return { rows: active.has(params[1]) ? [{ id: active.get(params[1]).id }] : [] };
      if (sql.startsWith('INSERT INTO coi_overrides')) { if (uniqueFails) { const error = new Error('duplicate'); error.code = '23505'; throw error; } if (mutationFails) throw new Error('write failed'); const row = { id: params[0], document_id: params[1], check_id: params[2], original_status: params[3], reason: params[4], config_version_id: params[5], approved_by: params[6], approved_at: '2026-01-02T00:00:00Z' }; active.set(row.check_id, row); ledger.push(row); return { rows: [row] }; }
      if (sql.startsWith('UPDATE coi_overrides')) { const row = active.get(params[1]); if (!row) return { rows: [] }; active.delete(params[1]); const revoked = { ...row, revoked_by: params[2], revoked_at: '2026-01-03T00:00:00Z' }; ledger[ledger.findIndex((entry) => entry.id === row.id)] = revoked; return { rows: [revoked] }; }
      if (sql.startsWith('SELECT * FROM coi_overrides')) return { rows: [...active.values()] };
      if (sql.startsWith('INSERT INTO audit_events')) { if (auditFails) throw new Error('audit failed'); events.push(sql); return { rows: [] }; }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  return { pool: { async connect() { return client; } }, history, active, ledger, events };
}

test('approve reload, revoke, and reapprove preserve append-only history with audit in one transaction', async () => {
  const fake = fixturePool();
  const { applyCoiOverride, revokeCoiOverride } = loadService(fake.pool);
  const req = { params: { id: 'coi-1' }, body: { checkId: 'additional-insured', reason: 'Reviewed policy' }, user: { email: 'tester' } };
  const approved = response(); await applyCoiOverride(req, approved);
  assert.equal(approved.statusCode, 200); assert.equal(approved.body.override.checkId, 'additional-insured'); assert.equal(approved.body.activeOverrides.length, 1); assert.equal(approved.body.compliance.checks.find((check) => check.id === 'additional-insured').effectiveStatus, 'pass');
  const duplicate = response(); await applyCoiOverride(req, duplicate); assert.equal(duplicate.statusCode, 409); assert.equal(duplicate.body.code, 'ACTIVE_OVERRIDE_EXISTS');
  const revoked = response(); await revokeCoiOverride({ params: { id: 'coi-1', checkId: 'additional-insured' }, user: { email: 'tester' } }, revoked);
  assert.equal(revoked.statusCode, 200); assert.equal(revoked.body.activeOverrides.length, 0);
  const reapproved = response(); await applyCoiOverride(req, reapproved); assert.equal(reapproved.statusCode, 200); assert.equal(reapproved.body.activeOverrides.length, 1);
  assert.equal(fake.ledger.length, 2); assert.ok(fake.ledger[0].revoked_at); assert.equal(fake.active.size, 1);
  assert.ok(fake.history.filter((sql) => sql === 'BEGIN').length >= 4); assert.ok(fake.history.includes('COMMIT')); assert.ok(fake.events.length >= 3);
});

test('override taxonomy rejects unknown, pass, and missing fail reason before mutation', async () => {
  const fake = fixturePool(); const { applyCoiOverride } = loadService(fake.pool);
  for (const [checkId, reason, code] of [['unknown', 'x', 'UNKNOWN_COI_CHECK'], ['named-insured', 'x', 'OVERRIDE_NOT_REQUIRED'], ['additional-insured', '', 'OVERRIDE_REASON_REQUIRED']]) {
    const res = response(); await applyCoiOverride({ params: { id: 'coi-1' }, body: { checkId, reason }, user: { email: 'tester' } }, res); assert.equal(res.statusCode, 422); assert.equal(res.body.code, code);
  }
  assert.equal(fake.active.size, 0);
});

test('audit failure rolls back the override mutation', async () => {
  const fake = fixturePool({ auditFails: true }); const { applyCoiOverride } = loadService(fake.pool);
  const res = response(); await applyCoiOverride({ params: { id: 'coi-1' }, body: { checkId: 'additional-insured', reason: 'x' }, user: { email: 'tester' } }, res);
  assert.equal(res.statusCode, 500); assert.ok(fake.history.includes('ROLLBACK')); assert.equal(fake.active.size, 0); assert.equal(fake.ledger.length, 0);
});

test('revoke audit failure and absent active override leave durable history unchanged', async () => {
  const fake = fixturePool(); const { applyCoiOverride } = loadService(fake.pool); const req = { params: { id: 'coi-1' }, body: { checkId: 'additional-insured', reason: 'x' }, user: { email: 'tester' } };
  await applyCoiOverride(req, response());
  const failing = fixturePool({ auditFails: true }); failing.active.set('additional-insured', fake.active.get('additional-insured')); failing.ledger.push(...fake.ledger);
  const { revokeCoiOverride } = loadService(failing.pool); const res = response(); await revokeCoiOverride({ params: { id: 'coi-1', checkId: 'additional-insured' }, user: { email: 'tester' } }, res);
  assert.equal(res.statusCode, 500); assert.equal(failing.active.size, 1); assert.equal(failing.ledger[0].revoked_at, undefined);
  const absent = response(); await revokeCoiOverride({ params: { id: 'coi-1', checkId: 'missing' }, user: { email: 'tester' } }, absent); assert.equal(absent.statusCode, 404); assert.equal(absent.body.code, 'ACTIVE_OVERRIDE_NOT_FOUND');
});

test('unique violation after empty pre-check maps to duplicate 409 and rolls back without audit', async () => {
  const fake = fixturePool({ uniqueFails: true }); const { applyCoiOverride } = loadService(fake.pool); const res = response();
  await applyCoiOverride({ params: { id: 'coi-1' }, body: { checkId: 'additional-insured', reason: 'x' }, user: { email: 'tester' } }, res);
  assert.equal(res.statusCode, 409); assert.equal(res.body.code, 'ACTIVE_OVERRIDE_EXISTS'); assert.ok(fake.history.includes('ROLLBACK')); assert.equal(fake.events.length, 0); assert.equal(fake.active.size, 0); assert.equal(fake.ledger.length, 0);
});

test('document/classification taxonomy and mutation failure roll back before audit', async () => {
  for (const [options, status, code] of [[{ missing: true }, 404, 'INVOICE_NOT_FOUND'], [{ classification: 'invoice' }, 409, 'CLASSIFICATION_MISMATCH']]) {
    const fake = fixturePool(options); const { applyCoiOverride } = loadService(fake.pool); const res = response();
    await applyCoiOverride({ params: { id: 'coi-1' }, body: { checkId: 'additional-insured', reason: 'x' }, user: { email: 'tester' } }, res);
    assert.equal(res.statusCode, status); assert.equal(res.body.code, code); assert.equal(fake.events.length, 0);
  }
  const fake = fixturePool({ mutationFails: true }); const { applyCoiOverride } = loadService(fake.pool); const res = response();
  await applyCoiOverride({ params: { id: 'coi-1' }, body: { checkId: 'additional-insured', reason: 'x' }, user: { email: 'tester' } }, res);
  assert.equal(res.statusCode, 500); assert.ok(fake.history.includes('ROLLBACK')); assert.equal(fake.events.length, 0);
});

test('COI override routes have the exact handler permission and validated approval body', () => {
  const source = require('node:fs').readFileSync(path.resolve(__dirname, '../../modules/invoices/routes/invoices.js'), 'utf8');
  assert.match(source, /router\.post\('\/:id\/coi-overrides', requirePermission\('accounting\.invoices\.coi_override'\), validate\(coiOverrideCreateSchema\)/);
  assert.match(source, /router\.delete\('\/:id\/coi-overrides\/:checkId', requirePermission\('accounting\.invoices\.coi_override'\)/);
});

function permissionResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function invokeHandlers(handlers, req, res) {
  let index = 0;
  const next = () => {
    const handler = handlers[index++];
    return handler ? handler(req, res, next) : undefined;
  };
  return next();
}

function loadCoiOverrideRouteHandlers(serviceCalls) {
  const routePath = path.resolve(__dirname, '../../modules/invoices/routes/invoices.js');
  const registrations = [];
  const router = {
    post(route, ...handlers) { registrations.push({ method: 'post', route, handlers }); },
    delete(route, ...handlers) { registrations.push({ method: 'delete', route, handlers }); },
    get() {},
    patch() {},
    put() {},
    head() {},
  };
  const serviceProxy = new Proxy({}, {
    get(_target, key) {
      if (key === 'applyCoiOverride') return async () => { serviceCalls.apply += 1; };
      if (key === 'revokeCoiOverride') return async () => { serviceCalls.revoke += 1; };
      if (key === 'ACTION_PERMISSIONS') return {};
      return async () => undefined;
    },
  });
  const originalLoad = Module._load;
  const prior = require.cache[require.resolve(routePath)];
  delete require.cache[require.resolve(routePath)];
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === routePath) {
      if (request === 'express') return { Router: () => router };
      if (request === 'multer') return Object.assign(() => ({ single: () => (_req, _res, next) => next() }), { memoryStorage: () => ({}) });
      if (request === '../../../lib/schemas') return new Proxy({}, { get: () => ({}) });
      if (request === '../../../middleware/validate') return { validate: () => (_req, _res, next) => next() };
      if (request === '../../../middleware/errorResponse') return { fail: (res, status, error) => res.status(status).json({ error }), safeError: () => undefined };
      if (request.startsWith('../services/')) return serviceProxy;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    require(routePath);
    return registrations;
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(routePath)];
    if (prior) require.cache[require.resolve(routePath)] = prior;
  }
}

test('COI handler gates stop a non-admin without the exact key before either service boundary', async () => {
  const serviceCalls = { apply: 0, revoke: 0 };
  const routes = loadCoiOverrideRouteHandlers(serviceCalls);
  const deniedUser = { role: 'Leadership', permissions: ['accounting.invoices.view', 'accounting.invoices.view_details', 'invoices.coi_override'] };
  for (const [method, route] of [['post', '/:id/coi-overrides'], ['delete', '/:id/coi-overrides/:checkId']]) {
    const registered = routes.find((candidate) => candidate.method === method && candidate.route === route);
    assert.ok(registered, `${method.toUpperCase()} ${route} must be registered`);
    const res = permissionResponse();
    await invokeHandlers(registered.handlers, { user: deniedUser, params: { id: 'coi-1', checkId: 'additional-insured' }, body: { checkId: 'additional-insured', reason: 'reviewed' } }, res);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Forbidden' });
  }
  assert.deepEqual(serviceCalls, { apply: 0, revoke: 0 });
});

test('COI handler gates allow non-admin Leadership only with the exact key', async () => {
  const serviceCalls = { apply: 0, revoke: 0 };
  const routes = loadCoiOverrideRouteHandlers(serviceCalls);
  const grantedUser = { role: 'Leadership', permissions: ['accounting.invoices.coi_override', 'accounting.invoices.view'] };
  for (const [method, route] of [['post', '/:id/coi-overrides'], ['delete', '/:id/coi-overrides/:checkId']]) {
    const registered = routes.find((candidate) => candidate.method === method && candidate.route === route);
    assert.ok(registered, `${method.toUpperCase()} ${route} must be registered`);
    await invokeHandlers(registered.handlers, { user: grantedUser, params: { id: 'coi-1', checkId: 'additional-insured' }, body: { checkId: 'additional-insured', reason: 'reviewed' } }, permissionResponse());
  }
  assert.deepEqual(serviceCalls, { apply: 1, revoke: 1 });

  const post = routes.find((candidate) => candidate.method === 'post' && candidate.route === '/:id/coi-overrides');
  assert.ok(post);
  await invokeHandlers(post.handlers, { user: { role: 'admin', permissions: [] }, params: { id: 'coi-1' }, body: { checkId: 'additional-insured', reason: 'reviewed' } }, permissionResponse());
  assert.equal(serviceCalls.apply, 2, 'admin bypass is supplemental to the non-admin exact-key path');
});
