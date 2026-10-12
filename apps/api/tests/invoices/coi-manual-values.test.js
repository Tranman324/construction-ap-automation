'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const servicePath = path.resolve(__dirname, '../../modules/invoices/services/coiManualValueService.js');

function response() { return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

function vendorFile(t, value) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coi-manual-vendors-'));
  const file = path.join(directory, 'vendors.json');
  fs.writeFileSync(file, JSON.stringify(value));
  const previous = process.env.VENDORS_PATH;
  process.env.VENDORS_PATH = file;
  t.after(() => { if (previous === undefined) delete process.env.VENDORS_PATH; else process.env.VENDORS_PATH = previous; fs.rmSync(directory, { recursive: true, force: true }); });
}

function fixture({ document = {}, auditFails = false, updateFails = false } = {}) {
  const actions = { begin: 0, select: 0, update: 0, audit: 0, rollback: 0 };
  const row = { id: 'coi-1', classification: 'coi', vendor_code: null, coi_data: { coverageLines: [{ expirationDate: '2020-01-01' }] }, coi_manual_values: {}, ...document };
  let snapshot;
  const client = { async query(sql, params = []) {
    if (sql === 'BEGIN') { actions.begin += 1; snapshot = structuredClone(row.coi_manual_values); return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql === 'ROLLBACK') { actions.rollback += 1; row.coi_manual_values = snapshot; return { rows: [] }; }
    if (sql.startsWith('SELECT * FROM documents')) { actions.select += 1; return { rows: row.id ? [row] : [] }; }
    if (sql.startsWith('UPDATE documents SET coi_manual_values')) { actions.update += 1; if (updateFails) throw new Error('update failed'); row.coi_manual_values = params[1]; return { rows: [{ ...row }] }; }
    if (sql.startsWith('SELECT config')) return { rows: [{ config: {}, updated_at: '2026-08-01T00:00:00.000Z' }] };
    if (sql.startsWith('SELECT * FROM coi_overrides')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  }, release() {} };
  return { row, actions, pool: { async connect() { return client; } }, audit: async () => { actions.audit += 1; if (auditFails) throw new Error('audit failed'); } };
}

function loadService(fake) {
  const original = Module._load;
  Module._load = function mocked(request, parent, isMain) {
    if (parent?.filename === servicePath && request === './supabase') return { pool: fake.pool };
    if (parent?.filename === servicePath && request === './coiConfigService') return { getEffectiveCoiConfig: async () => ({ id: 'v1', config: { certificateHolder: { nameAliases: ['NCG'] }, cancellationNoticeMinimumDays: 30, coverageRequirements: [] } }) };
    if (parent?.filename === servicePath && request === '../../../lib/auditEvents') return { emitInvoiceAuditEvent: fake.audit, getRequestAuditActor: () => ({ name: 'tester' }) };
    if (parent?.filename === servicePath && request === '../../../middleware/errorResponse') return { safeError: (res) => res.status(500).json({ error: 'Internal server error' }) };
    return original.call(this, request, parent, isMain);
  };
  delete require.cache[servicePath];
  try { return require(servicePath); } finally { Module._load = original; delete require.cache[servicePath]; }
}

async function update(service, body, extra = {}) { const res = response(); await service.updateCoiManualValues({ params: { id: 'coi-1' }, body, user: { email: 'tester' }, ...extra }, res); return res; }

function loadManualRoute(serviceCalls) {
  const routePath = path.resolve(__dirname, '../../modules/invoices/routes/invoices.js'); const registrations = [];
  const router = { patch(route, ...handlers) { registrations.push({ route, handlers }); }, get() {}, post() {}, delete() {}, put() {}, head() {} };
  const original = Module._load; const prior = require.cache[require.resolve(routePath)]; delete require.cache[require.resolve(routePath)];
  Module._load = function mocked(request, parent, isMain) {
    if (parent?.filename === routePath) {
      if (request === 'express') return { Router: () => router };
      if (request === 'multer') return Object.assign(() => ({ single: () => (_req, _res, next) => next() }), { memoryStorage: () => ({}) });
      if (request === '../../../lib/schemas') return new Proxy({}, { get: () => ({}) });
      if (request === '../../../middleware/validate') return { validate: () => (_req, _res, next) => next() };
      if (request === '../../../middleware/permissions') return { requirePermission: (key) => (req, res, next) => req.user?.permissions?.includes(key) ? next() : res.status(403).json({ error: 'Forbidden' }) };
      if (request === '../../../middleware/errorResponse') return { fail: () => undefined, safeError: () => undefined };
      if (request.startsWith('../services/')) return new Proxy({}, { get: (_target, key) => key === 'updateCoiManualValues' ? async () => { serviceCalls.count += 1; } : key === 'ACTION_PERMISSIONS' ? {} : async () => undefined });
    }
    return original.call(this, request, parent, isMain);
  };
  try { require(routePath); return registrations; } finally { Module._load = original; delete require.cache[require.resolve(routePath)]; if (prior) require.cache[require.resolve(routePath)] = prior; }
}

test('manual values validate a temp vendor fixture, attribute set/replace/clear, and restore extracted values', async (t) => {
  vendorFile(t, { Vendors: [{ Vendor_Code: '  V-100  ' }] });
  const fake = fixture({ document: { vendor_code: null, coi_data: { coverageLines: [{ expirationDate: '2020-01-01' }] } } }); const service = loadService(fake);
  const set = await update(service, { vendorCode: 'V-100', expirationDate: '2099-01-01' });
  assert.equal(set.statusCode, 200); assert.deepEqual(Object.keys(set.body.manualValues).sort(), ['expirationDate', 'vendorCode']);
  assert.equal(set.body.manualValues.vendorCode.value, 'V-100'); assert.equal(set.body.manualValues.vendorCode.setBy, 'tester'); assert.ok(set.body.manualValues.vendorCode.setAt);
  assert.equal(set.body.compliance.vendorCode.provenance, 'manual'); assert.equal(set.body.compliance.expiration.value.expirationDate, '2099-01-01');
  assert.ok(!set.body.compliance.blockers.some((blocker) => blocker.code === 'MISSING_VENDOR_CODE'));
  const replaced = await update(service, { vendorCode: 'V-100' });
  assert.equal(replaced.statusCode, 200); assert.equal(replaced.body.manualValues.vendorCode.value, 'V-100'); assert.equal(replaced.body.manualValues.expirationDate.value, '2099-01-01');
  const cleared = await update(service, { vendorCode: null, expirationDate: null });
  assert.equal(cleared.statusCode, 200); assert.deepEqual(cleared.body.manualValues, {}); assert.equal(cleared.body.compliance.vendorCode.provenance, 'unknown');
  assert.equal(cleared.body.compliance.expiration.value.expirationDate, '2020-01-01'); assert.ok(cleared.body.compliance.blockers.some((blocker) => blocker.code === 'MISSING_VENDOR_CODE'));
  assert.equal(fake.actions.update, 3); assert.equal(fake.actions.audit, 3);
});

test('expiration-only updates do not validate an absent vendor and vendor lookup injection wins over the file', async (t) => {
  vendorFile(t, [{ Vendor_Code: 'FILE-VENDOR' }]);
  const fake = fixture(); const service = loadService(fake);
  const expirationOnly = await update(service, { expirationDate: '2099-01-01' });
  assert.equal(expirationOnly.statusCode, 200); assert.equal(expirationOnly.body.manualValues.expirationDate.value, '2099-01-01');
  const injected = await update(service, { vendorCode: 'INJECTED-VENDOR' }, { vendorMasterLookup: async (code) => code === 'INJECTED-VENDOR' });
  assert.equal(injected.statusCode, 200); assert.equal(injected.body.manualValues.vendorCode.value, 'INJECTED-VENDOR');
});

test('vendor, date, missing, and non-COI taxonomy makes zero writes and no audit', async (t) => {
  vendorFile(t, [{ Vendor_Code: 'KNOWN' }]);
  const cases = [
    [{ vendorCode: 'UNKNOWN' }, {}, 422, 'UNKNOWN_VENDOR_CODE'],
    [{ expirationDate: 'not-a-date' }, {}, 422, 'INVALID_EXPIRATION_DATE'],
    [{ vendorCode: 'KNOWN' }, { document: { id: null } }, 404, 'INVOICE_NOT_FOUND'],
    [{ vendorCode: 'KNOWN' }, { document: { classification: 'invoice' } }, 409, 'CLASSIFICATION_MISMATCH'],
  ];
  for (const [body, options, status, code] of cases) {
    const fake = fixture(options); const res = await update(loadService(fake), body);
    assert.equal(res.statusCode, status); assert.equal(res.body.code, code); assert.equal(fake.actions.update, 0); assert.equal(fake.actions.audit, 0);
  }
  const unavailable = fixture(); const unavailableRes = await update(loadService(unavailable), { vendorCode: 'KNOWN' }, { vendorMasterLookup: async () => { throw new Error('offline'); } });
  assert.equal(unavailableRes.statusCode, 503); assert.equal(unavailableRes.body.code, 'VENDOR_MASTER_UNAVAILABLE'); assert.equal(unavailable.actions.begin, 1); assert.equal(unavailable.actions.update, 0); assert.equal(unavailable.actions.audit, 0);
});

test('calendar-invalid expiration dates fail before a transaction, write, or audit', async (t) => {
  vendorFile(t, [{ Vendor_Code: 'KNOWN' }]);
  const fake = fixture(); const res = await update(loadService(fake), { expirationDate: '2026-02-30' });
  assert.equal(res.statusCode, 422); assert.equal(res.body.code, 'INVALID_EXPIRATION_DATE');
  assert.equal(fake.actions.begin, 0); assert.equal(fake.actions.update, 0); assert.equal(fake.actions.audit, 0);
});

test('missing and non-COI documents win over vendor lookup failures', async () => {
  for (const [document, status, code] of [[{ id: null }, 404, 'INVOICE_NOT_FOUND'], [{ classification: 'invoice' }, 409, 'CLASSIFICATION_MISMATCH']]) {
    const fake = fixture({ document }); let lookups = 0;
    const res = await update(loadService(fake), { vendorCode: 'UNKNOWN' }, { vendorMasterLookup: async () => { lookups += 1; throw new Error('unavailable'); } });
    assert.equal(res.statusCode, status); assert.equal(res.body.code, code); assert.equal(lookups, 0); assert.equal(fake.actions.update, 0); assert.equal(fake.actions.audit, 0);
  }
});

test('non-string vendor values are rejected before lookup, transaction, write, or audit', async () => {
  for (const vendorCode of [123, { code: 'KNOWN' }]) {
    const fake = fixture(); let lookups = 0;
    const res = await update(loadService(fake), { vendorCode }, { vendorMasterLookup: async () => { lookups += 1; return true; } });
    assert.equal(res.statusCode, 422); assert.equal(res.body.code, 'INVALID_MANUAL_VALUES'); assert.equal(lookups, 0);
    assert.equal(fake.actions.begin, 0); assert.equal(fake.actions.update, 0); assert.equal(fake.actions.audit, 0);
  }
});

test('audit and domain failures roll manual-value mutation back in the same transaction', async (t) => {
  vendorFile(t, [{ Vendor_Code: 'KNOWN' }]);
  for (const options of [{ auditFails: true }, { updateFails: true }]) {
    const fake = fixture(options); const res = await update(loadService(fake), { vendorCode: 'KNOWN' });
    assert.equal(res.statusCode, 500); assert.deepEqual(fake.row.coi_manual_values, {}); assert.equal(fake.actions.rollback, 1);
    if (options.auditFails) assert.equal(fake.actions.audit, 1); else assert.equal(fake.actions.audit, 0);
  }
});

test('manual-value route denies a non-admin without the exact key before the service can look up, transact, or audit', async () => {
  const serviceCalls = { count: 0 }; const route = loadManualRoute(serviceCalls).find((item) => item.route === '/:id/coi-manual-values');
  assert.ok(route); const res = response(); let index = 0; const next = () => route.handlers[index++]?.({ user: { role: 'Leadership', permissions: ['invoices.coi_override'] } }, res, next);
  await next(); assert.equal(res.statusCode, 403); assert.equal(serviceCalls.count, 0);
});
