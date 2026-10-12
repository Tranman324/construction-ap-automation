'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const servicePath = path.join(root, 'modules/invoices/services/spectrumCoiUploadService.js');

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function errorResponse() {
  return { fail(res, status, message, details = {}) { const { code, ...rest } = details; return res.status(status).json({ error: message, ...(code ? { code } : {}), ...(Object.keys(rest).length ? { details: rest } : {}) }); } };
}

function fixture({ document = {}, overrides = [], config = {}, updatedAt = '2026-08-01T00:00:00.000Z' } = {}) {
  const actions = { claim: 0, state: 0, audit: 0, spectrum: 0 };
  const row = {
    id: 'coi-1', classification: 'coi', file_path: '/tmp/coi.pdf', file_name: 'coi.pdf', vendor_code: 'SERVER-VENDOR',
    coi_data: { holder: { name: 'Wrong Holder' }, endorsements: { additionalInsured: true, waiverOfSubrogation: true, primaryNoncontributory: true }, cancellationNoticeDays: 30, coverageLines: [{ policyNumber: 'P-1', expirationDate: '2099-01-01' }] },
    spectrum_upload_status: null, spectrum_upload_attempts: 0,
    ...document,
  };
  const effectiveConfig = { certificateHolder: { nameAliases: ['NCG'] }, cancellationNoticeMinimumDays: 30, coverageRequirements: [], ...config };
  const pool = { async query(sql, params = []) {
    if (sql.startsWith('SELECT id, classification')) return { rows: [row] };
    if (sql.startsWith('SELECT * FROM coi_overrides')) return { rows: overrides };
    if (sql.startsWith('SELECT id, config FROM coi_config_versions')) return { rows: [{ id: 'v1', config: effectiveConfig }] };
    if (sql.startsWith("UPDATE documents\n     SET spectrum_upload_status = 'queued'")) {
      actions.claim += 1; row.spectrum_upload_status = 'queued'; row.spectrum_upload_vendor_code = params[1]; row.spectrum_upload_attempts += 1; return { rows: [{ ...row }] };
    }
    if (sql.startsWith('UPDATE documents SET spectrum_upload_status')) { actions.state += 1; return { rows: [] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  return { row, pool, actions, effectiveConfig };
}

function loadService(fake) {
  const original = Module._load;
  Module._load = function mocked(request, parent, isMain) {
    if (parent?.filename === servicePath && request === '../../../lib/db') return fake.pool;
    if (parent?.filename === servicePath && request === '../../../lib/logger') return { info() {}, warn() {}, error() {} };
    if (parent?.filename === servicePath && request === '../../../lib/auditEvents') return { emitInvoiceAuditEvent: async () => { fake.actions.audit += 1; } };
    if (parent?.filename === servicePath && request === '../../../middleware/errorResponse') return errorResponse();
    if (request.endsWith('/lib/coi-upload')) return { getQueueDepth: () => { fake.actions.spectrum += 1; return 1; }, uploadCoi: async () => new Promise(() => {}) };
    return original.call(this, request, parent, isMain);
  };
  delete require.cache[servicePath];
  return { service: require(servicePath), cleanup() { Module._load = original; delete require.cache[servicePath]; } };
}

test('direct Spectrum preflight blocks live effective blockers before every action and rejects caller values as authority', async () => {
  const fake = fixture({ document: { vendor_code: null, coi_data: { holder: { name: 'Wrong Holder' }, coverageLines: [] } } });
  const loaded = loadService(fake); const res = response();
  try { await loaded.service.uploadToSpectrum({ params: { id: 'coi-1' }, body: { vendorCode: 'CALLER-BYPASS', expirationDate: '2099-01-01' } }, res); } finally { loaded.cleanup(); }
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'COI_COMPLIANCE_BLOCKED');
  assert.ok(res.body.details.blockers.some((blocker) => blocker.code === 'MISSING_VENDOR_CODE'));
  assert.deepEqual(fake.actions, { claim: 0, state: 0, audit: 0, spectrum: 0 });
  assert.equal(fake.row.spectrum_upload_status, null);
});

test('an active current-version override permits preflight success using server-resolved values only', async () => {
  const fake = fixture({ overrides: [{ check_id: 'certificate-holder', original_status: 'fail', config_version_id: 'v1' }] });
  const loaded = loadService(fake); const res = response();
  try { await loaded.service.uploadToSpectrum({ params: { id: 'coi-1' }, body: { vendorCode: 'CALLER-VENDOR', expirationDate: '1900-01-01' } }, res); } finally { loaded.cleanup(); }
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.vendorCode, 'SERVER-VENDOR');
  assert.equal(res.body.expirationDate, '2099-01-01');
  assert.equal(fake.row.spectrum_upload_vendor_code, 'SERVER-VENDOR');
  assert.equal(fake.actions.claim, 1);
  assert.equal(fake.actions.audit, 1);
  assert.equal(fake.actions.spectrum, 1);
});

test('a legacy singleton override is stale under the physical effective version', async () => {
  const updatedAt = new Date('2026-08-01T00:00:00.000Z');
  const fake = fixture({ updatedAt, overrides: [{ check_id: 'certificate-holder', original_status: 'fail', config_version_id: 'legacy-singleton:2026-08-01T00:00:00.000Z' }] });
  const loaded = loadService(fake); const res = response();
  try { await loaded.service.uploadToSpectrum({ params: { id: 'coi-1' }, body: {} }, res); } finally { loaded.cleanup(); }
  assert.equal(res.statusCode, 422);
  assert.equal(fake.actions.claim, 0);
});

test('Spectrum preflight consumes manual resolved vendor and expiration values', async () => {
  const fake = fixture({ document: { coi_manual_values: { vendorCode: { value: 'MANUAL-VENDOR' }, expirationDate: { value: '2099-12-31' } } }, overrides: [{ check_id: 'certificate-holder', original_status: 'fail', config_version_id: 'v1' }] });
  const loaded = loadService(fake); const res = response();
  try { await loaded.service.uploadToSpectrum({ params: { id: 'coi-1' }, body: {} }, res); } finally { loaded.cleanup(); }
  assert.equal(res.statusCode, 202); assert.equal(res.body.vendorCode, 'MANUAL-VENDOR'); assert.equal(res.body.expirationDate, '2099-12-31'); assert.equal(fake.row.spectrum_upload_vendor_code, 'MANUAL-VENDOR');
});
