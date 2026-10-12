'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('feature request management uses permission gates instead of email allowlist', () => {
  const source = read('modules/feature-requests/routes.js');

  assert.doesNotMatch(source, /ADMIN_EMAILS/);
  assert.doesNotMatch(source, /isAdmin\(/);
  assert.match(source, /requirePermission\('feature_requests\.manage'\)/);
  assert.match(source, /requireManageForStatusChange/);
  assert.match(source, /router\.delete\('\/:id', requireFeatureRequestManage/);
});

test('invoice permanent delete and lien waiver routes require expected permissions', () => {
  const source = read('modules/invoices/routes/invoices.js');

  assert.doesNotMatch(source, /ADMIN_EMAILS/);
  assert.doesNotMatch(source, /isAdmin\(/);
  assert.match(source, /router\.delete\('\/:id\/permanent', requirePermission\('accounting\.invoices\.permanent_delete'\)/);
  assert.match(source, /router\.get\('\/:id\/orphan-waivers', requirePermission\('accounting\.invoices\.view_details'\)/);
  assert.match(source, /router\.post\('\/:id\/link-waiver', requirePermission\('accounting\.invoices\.approve'\)/);
  assert.match(source, /router\.delete\('\/:id\/link-waiver', requirePermission\('accounting\.invoices\.approve'\)/);
  assert.match(source, /router\.post\('\/:id\/waiver-override', requirePermission\('accounting\.invoices\.approve'\)/);
  assert.match(source, /router\.post\('\/:id\/waiver-override\/revert', requirePermission\('accounting\.invoices\.approve'\)/);
  assert.match(source, /router\.post\('\/:id\/waiver-bypass', requirePermission\('accounting\.invoices\.approve'\)/);
  assert.match(source, /router\.post\('\/:id\/waiver-bypass\/revert', requirePermission\('accounting\.invoices\.approve'\)/);
  assert.match(source, /router\.post\('\/:id\/statement-lines', requirePermission\('accounting\.invoices\.approve'\)/);
  assert.match(source, /router\.post\('\/:id\/statement-lines\/:lineId\/resolve', requirePermission\('accounting\.invoices\.approve'\)/);
  assert.match(source, /router\.post\('\/:id\/statement-lines\/:lineId\/unresolve', requirePermission\('accounting\.invoices\.approve'\)/);
  assert.match(source, /router\.post\('\/:id\/file', requirePermission\('accounting\.invoices\.approve'\)/);
});

test('document filing denies a non-admin before its handler can run', () => {
  const { requirePermission } = require('../../middleware/permissions');
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;

  requirePermission('accounting.invoices.approve')(
    { user: { role: 'accounting', permissions: ['accounting.invoices.view_details'] } },
    res,
    () => { nextCalled = true; }
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Forbidden' });
});

test('filing permission documentation matches the handler gate', () => {
  const api = read('API.md');
  const contracts = fs.readFileSync(path.join(root, '..', 'web', 'docs/specs/invoices/CONTRACTS.md'), 'utf8');
  assert.match(api, /Existing `\/file` remains gated by `accounting\.invoices\.approve`/);
  assert.match(contracts, /\| `POST` \| `\/api\/invoices\/:id\/file` \| `accounting\.invoices\.approve`/);
});

test('document flag and unflag routes reuse the view_details gate at the handler', () => {
  const source = read('modules/invoices/routes/invoices.js');

  assert.match(source, /router\.post\('\/:id\/flag', requirePermission\('accounting\.invoices\.view_details'\), validate\(invoiceFlagSchema\)/);
  assert.match(source, /router\.post\('\/:id\/unflag', requirePermission\('accounting\.invoices\.view_details'\), validate\(invoiceUnflagSchema\)/);
});

test('document-destinations and coi-config catalog routes gate read with view_details and write with manage_settings', () => {
  const dd = read('modules/invoices/routes/document-destinations.js');
  assert.match(dd, /router\.get\('\/', requirePermission\('accounting\.invoices\.view_details'\)/);
  assert.match(dd, /router\.get\('\/versions', requirePermission\('accounting\.invoices\.manage_settings'\)/);
  assert.match(dd, /router\.get\('\/versions\/:id', requirePermission\('accounting\.invoices\.manage_settings'\)/);
  assert.match(dd, /router\.put\('\/', requirePermission\('accounting\.invoices\.manage_settings'\)/);

  const coi = read('modules/invoices/routes/coi-config.js');
  assert.match(coi, /router\.get\('\/', requirePermission\('accounting\.invoices\.view_details'\)/);
  assert.match(coi, /router\.put\('\/', requirePermission\('accounting\.invoices\.manage_settings'\)/);
  assert.match(coi, /router\.get\('\/versions', requirePermission\('accounting\.invoices\.manage_settings'\)/);
  assert.match(coi, /router\.get\('\/versions\/:id', requirePermission\('accounting\.invoices\.manage_settings'\)/);
});

test('document Spectrum upload route requires the submit Spectrum permission', () => {
  const source = read('modules/invoices/routes/documents.js');

  assert.match(source, /router\.post\(\s*'\/:id\/upload-to-spectrum'/);
  assert.match(source, /requirePermission\('accounting\.invoices\.submit_spectrum'\)/);
});

test('split review routes require split management permission', () => {
  const source = read('modules/invoices/routes/splits.js');

  for (const [method, route] of [
    ['get', '/queue'],
    ['get', '/:id'],
    ['get', '/:id/pdf'],
    ['get', '/:id/page/:pageNumber/preview'],
    ['post', '/:id/analyze'],
    ['post', '/:id/confirm'],
    ['post', '/:id/cancel'],
    ['post', '/:id/reject'],
    ['get', '/child/:id/status'],
  ]) {
    assert.match(
      source,
      new RegExp(`router\\.${method}\\('${route.replace(/\//g, '\\/').replace(/\:/g, '\\:')}', requirePermission\\('accounting\\.invoices\\.manage_splits'\\)`)
    );
  }
});

test('bulk invoice route has a handler-level action permission gate', () => {
  const source = read('modules/invoices/routes/invoices.js');
  const service = read('modules/invoices/services/bulkActionService.js');

  assert.match(source, /function requireBulkActionPermission\(req, res, next\)/);
  assert.match(source, /ACTION_PERMISSIONS\[action\]/);
  assert.match(source, /checkPermission\(req, requiredPermission\)/);
  assert.match(source, /router\.post\('\/bulk', validate\(invoiceBulkActionSchema\), requireBulkActionPermission/);
  assert.match(service, /unapprove: 'accounting\.invoices\.approve'/);
  assert.match(service, /approve: 'accounting\.invoices\.approve'/);
  assert.match(service, /discard: 'accounting\.invoices\.delete'/);
  assert.match(service, /ACTION_PERMISSIONS/);
  // Bulk reject remains unsupported; bulk approve shares the single-path gate.
  assert.doesNotMatch(service, /reject: 'accounting\.invoices\.reject'/);
});

test('standalone lien waiver routes require invoice detail permission', () => {
  const source = read('modules/invoices/routes/lien-waivers.js');

  assert.match(source, /router\.get\('\/orphans', requirePermission\('accounting\.invoices\.view_details'\)/);
  assert.match(source, /router\.get\('\/:id\/orphan-invoices', requirePermission\('accounting\.invoices\.view_details'\)/);
});

test('automation rules routes require explicit rules management permission', () => {
  const source = read('modules/invoices/routes/rules.js');
  const migration = read('migrations/2026-06-23_permission_rules_gates.sql');

  assert.match(source, /router\.use\(requirePermission\('accounting\.invoices\.manage_rules'\)\)/);
  assert.match(source, /router\.post\([\s\S]*?'\/apply',[\s\S]*?requirePermission\('accounting\.invoices\.manage_rules'\)/);
  assert.match(migration, /'invoices\.manage_rules'/);
  assert.match(migration, /INSERT INTO permissions/);
  assert.match(migration, /INSERT INTO role_permissions/);
  assert.match(migration, /WHERE roles\.name = 'admin'/);
  assert.match(migration, /ON CONFLICT \(role_id, permission_key\) DO UPDATE/);
});

test('retention, Spectrum refresh, and pipeline retry mutations require settings management permission', () => {
  const settings = read('modules/invoices/routes/settings.js');
  const vendors = read('modules/invoices/routes/vendors.js');
  const pipeline = read('modules/invoices/routes/pipeline.js');

  for (const [method, route] of [
    ['put', '/retention/:id'],
    ['post', '/retention'],
    ['delete', '/retention/:id'],
  ]) {
    assert.match(
      settings,
      new RegExp(`router\\.${method}\\('${route.replace(/\//g, '\\/').replace(/\:/g, '\\:')}', requirePermission\\('accounting\\.invoices\\.manage_settings'\\)`)
    );
  }

  assert.match(vendors, /router\.post\('\/refresh', requirePermission\('accounting\.invoices\.manage_settings'\)/);
  assert.match(pipeline, /router\.post\('\/errors\/:id\/retry', requirePermission\('accounting\.invoices\.manage_settings'\)/);
});

test('CORS allows browser-forwarded auth and permission headers', () => {
  const source = read('server.js');

  for (const header of [
    'x-user-email',
    'x-user-id',
    'x-user-role',
    'x-user-permissions',
  ]) {
    assert.match(source, new RegExp(`'${header}'`));
  }
});

test('permission seed migration adds new permissions and admin grants', () => {
  const migration = read('migrations/2026-06-22_permission_lien_waiver_gates.sql');

  assert.match(migration, /'feature_requests\.manage'/);
  assert.match(migration, /'invoices\.permanent_delete'/);
  assert.match(migration, /INSERT INTO permissions/);
  assert.match(migration, /INSERT INTO role_permissions/);
  assert.match(migration, /WHERE roles\.name = 'admin'/);
  assert.match(migration, /ON CONFLICT \(role_id, permission_key\) DO UPDATE/);
});
