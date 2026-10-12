'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const routePath = path.join(root, 'modules/invoices/routes/invoices.js');
const collectionPath = path.join(root, 'modules/invoices/services/invoiceCollectionService.js');
const supabasePath = path.join(root, 'modules/invoices/services/supabase.js');

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function loadDetailRoute(pool) {
  const registrations = [];
  const router = {};
  for (const method of ['get', 'post', 'delete', 'patch', 'put', 'head']) router[method] = (route, ...handlers) => registrations.push({ method, route, handlers });
  const previousSupabase = require.cache[supabasePath];
  const previousCollection = require.cache[collectionPath];
  const previousRoute = require.cache[routePath];
  delete require.cache[collectionPath]; delete require.cache[routePath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: {
      pool,
      rowToDoc: (row) => ({ ...row }),
      getVendorBypassCounts: async () => ({}),
      getWaiverActionSerializationOptions: () => ({ includeWaiverActions: true, canRequestWaiver: true, canApproveWaiver: true }),
    },
  };
  const originalLoad = Module._load;
  Module._load = function mocked(request, parent, isMain) {
    if (parent?.filename === routePath && request === 'express') return { Router: () => router };
    if (parent?.filename === routePath && request === '../../../middleware/permissions') return { checkPermission: () => true, requirePermission: () => (_req, _res, next) => next() };
    if (parent?.filename === routePath && request === '../../../middleware/validate') return { validate: () => (_req, _res, next) => next() };
    if (parent?.filename === routePath && request.startsWith('../services/') && request !== '../services/invoiceCollectionService') return new Proxy({}, { get: (_target, key) => key === 'ACTION_PERMISSIONS' ? {} : async () => undefined });
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    require(routePath);
    return { detail: registrations.find((entry) => entry.method === 'get' && entry.route === '/:id'), cleanup() {
      delete require.cache[routePath]; delete require.cache[collectionPath];
      if (previousSupabase) require.cache[supabasePath] = previousSupabase; else delete require.cache[supabasePath];
      if (previousCollection) require.cache[collectionPath] = previousCollection;
      if (previousRoute) require.cache[routePath] = previousRoute;
    } };
  } finally {
    Module._load = originalLoad;
  }
}

async function invoke(handlers, req, res) {
  let index = 0;
  const next = () => {
    const handler = handlers[index++];
    return handler ? handler(req, res, next) : undefined;
  };
  await next();
}

test('GET /api/invoices/:id returns the complete COI result and leaves a config-stale override ineffective', async () => {
  const row = { id: 'coi-1', classification: 'coi', vendor_code: 'V1', coi_data: { holder: { name: 'Wrong Holder', address: 'Elsewhere' }, coverageLines: [] } };
  const override = { id: 'override-1', document_id: 'coi-1', check_id: 'certificate-holder', original_status: 'fail', config_version_id: 'legacy-singleton:old', approved_by: 'reviewer', approved_at: '2026-01-01T00:00:00.000Z' };
  const pool = { async query(sql) {
    if (sql.startsWith('SELECT * FROM documents')) return { rows: [row] };
    if (sql.startsWith('SELECT * FROM coi_overrides')) return { rows: [override] };
    if (sql.startsWith('SELECT id, config FROM coi_config_versions')) return { rows: [{ id: 'v1', config: { certificateHolder: { nameAliases: ['NCG'], address: '1 Main St' }, coverageRequirements: [] } }] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const loaded = loadDetailRoute(pool); const res = response();
  try {
    assert.ok(loaded.detail, 'the registered invoice detail route must exist');
    await invoke(loaded.detail.handlers, { params: { id: 'coi-1' }, query: {} }, res);
  } finally { loaded.cleanup(); }
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body.compliance).sort(), ['blockers', 'checks', 'configVersion', 'configVersionId', 'coverageExceptions', 'coverageFailures', 'evaluatedAt', 'expiration', 'uploadReady', 'vendorCode', 'verdict']);
  assert.match(res.body.compliance.evaluatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(res.body.compliance.configVersion, 'v1');
  for (const value of [res.body.compliance.vendorCode, res.body.compliance.expiration]) assert.deepEqual(Object.keys(value).sort(), ['blockers', 'permittedActions', 'provenance', 'value']);
  assert.deepEqual(Object.keys(res.body.compliance.expiration.value).sort(), ['daysRemaining', 'expirationDate', 'state']);
  for (const check of res.body.compliance.checks) {
    for (const key of ['id', 'label', 'rawStatus', 'effectiveStatus', 'provenance', 'detail', 'required']) assert.ok(key in check, `missing ${key}`);
  }
  const holder = res.body.compliance.checks.find((check) => check.id === 'certificate-holder');
  assert.equal(holder.rawStatus, 'fail');
  assert.equal(holder.effectiveStatus, 'fail');
  assert.equal(holder.provenance, 'computed');
  assert.equal(holder.code, 'OVERRIDE_STALE');
  assert.equal(res.body.coiOverrides[0].configVersionId, 'legacy-singleton:old');
});
