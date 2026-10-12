'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  checkPermission,
  requireAnyPermission,
  requirePermission,
} = require('../../middleware/permissions');

function createRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function runMiddleware(middleware, user = null) {
  const req = { user };
  const res = createRes();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  return { nextCalled, res };
}

test('requirePermission allows a granted permission from req.user', () => {
  const result = runMiddleware(requirePermission('accounting.invoices.approve'), {
    permissions: ['accounting.invoices.view', 'accounting.invoices.approve'],
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, null);
  assert.equal(checkPermission({
    user: { permissions: [' accounting.invoices.approve '] },
  }, 'accounting.invoices.approve'), true);
});

test('requirePermission denies an ungranted permission from req.user', () => {
  const result = runMiddleware(requirePermission('accounting.invoices.approve'), {
    permissions: ['accounting.invoices.view'],
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 403);
  assert.deepEqual(result.res.body, { error: 'Forbidden' });
});

test('COI override and settings permissions require their canonical keys', () => {
  for (const permission of [
    'accounting.invoices.coi_override',
    'accounting.invoices.manage_settings',
  ]) {
    const result = runMiddleware(requirePermission(permission), {
      role: 'Leadership',
      permissions: ['accounting.invoices.view'],
    });

    assert.equal(result.nextCalled, false, permission);
    assert.equal(result.res.statusCode, 403, permission);
    assert.deepEqual(result.res.body, { error: 'Forbidden' }, permission);
  }

  for (const permission of ['coi_override', 'manage_settings']) {
    const result = runMiddleware(requirePermission(`accounting.invoices.${permission}`), {
      role: 'Leadership',
      permissions: [`invoices.${permission}`],
    });

    assert.equal(result.nextCalled, false, permission);
    assert.equal(result.res.statusCode, 403, permission);
    assert.deepEqual(result.res.body, { error: 'Forbidden' }, permission);
  }
});

test('documented pre-namespace invoice registry suffixes retain bidirectional legacy compatibility', () => {
  const migratedLegacySuffixes = [
    'approve', 'delete', 'export', 'manage_retention', 'manage_rules',
    'manage_splits', 'permanent_delete', 'reject',
    'submit_spectrum', 'view', 'view_details',
  ];

  for (const suffix of migratedLegacySuffixes) {
    assert.equal(checkPermission({ user: { permissions: [`invoices.${suffix}`] } }, `accounting.invoices.${suffix}`), true, suffix);
    assert.equal(checkPermission({ user: { permissions: [`accounting.invoices.${suffix}`] } }, `invoices.${suffix}`), true, suffix);
  }

  const anyResult = runMiddleware(requireAnyPermission([
    'accounting.invoices.reject',
    'accounting.invoices.view',
  ]), { permissions: ['invoices.view'] });
  assert.equal(anyResult.nextCalled, true);

  for (const suffix of ['file', 'manage', 'review']) {
    assert.equal(checkPermission({ user: { permissions: [`invoices.${suffix}`] } }, `accounting.invoices.${suffix}`), false, suffix);
    assert.equal(checkPermission({ user: { permissions: [`accounting.invoices.${suffix}`] } }, `invoices.${suffix}`), false, suffix);
  }
});

test('admin role on req.user bypasses permission checks', () => {
  const result = runMiddleware(requirePermission('platform.manage_users'), {
    role: 'admin',
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, null);
  assert.equal(checkPermission({
    user: { role: 'admin' },
  }, 'anything.at.all'), true);
});

test('missing or empty req.user permissions are denied', () => {
  for (const user of [
    null,
    { permissions: '' },
    { permissions: [] },
  ]) {
    const result = runMiddleware(requirePermission('accounting.invoices.view'), user);
    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 403);
    assert.deepEqual(result.res.body, { error: 'Forbidden' });
  }
});

test('non-invoice namespaces are not aliased', () => {
  const denied = runMiddleware(requirePermission('feature_requests.manage'), {
    permissions: ['accounting.invoices.manage'],
  });

  assert.equal(denied.nextCalled, false);
  assert.equal(denied.res.statusCode, 403);
  assert.deepEqual(denied.res.body, { error: 'Forbidden' });
  assert.equal(checkPermission({
    user: { permissions: ['invoices.manage'] },
  }, 'feature_requests.manage'), false);

  const allowed = runMiddleware(requirePermission('feature_requests.manage'), {
    permissions: ['feature_requests.manage'],
  });

  assert.equal(allowed.nextCalled, true);
  assert.equal(allowed.res.statusCode, null);
});

test('requireAnyPermission allows when any candidate is present', () => {
  const result = runMiddleware(requireAnyPermission([
    'accounting.invoices.approve',
    'accounting.invoices.reject',
  ]), {
    permissions: ['accounting.invoices.view', 'accounting.invoices.reject'],
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, null);
});

test('requireAnyPermission denies when no candidate is present', () => {
  const result = runMiddleware(requireAnyPermission([
    'accounting.invoices.approve',
    'accounting.invoices.reject',
  ]), {
    permissions: ['accounting.invoices.view'],
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 403);
  assert.deepEqual(result.res.body, { error: 'Forbidden' });
});
