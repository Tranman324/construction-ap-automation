const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PERMISSIONS = process.env.ADMIN_PERMISSIONS || '*';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || '';

const state = {
  pendingRestore: null,
  environmentCheck: null,
};

function authHeaders(options = {}) {
  const hasPermissions = Object.prototype.hasOwnProperty.call(options, 'permissions');
  const permissions = Array.isArray(options.permissions)
    ? options.permissions.join(',')
    : hasPermissions
      ? options.permissions
      : ADMIN_PERMISSIONS;

  const headers = {
    'x-internal-secret': INTERNAL_SECRET,
    'x-user-email': options.email || ADMIN_EMAIL,
    'x-user-permissions': permissions,
    'x-user-role': options.role || 'admin',
  };

  if (options.userId) {
    headers['x-user-id'] = options.userId;
  }

  return headers;
}

async function request(method, path, options = {}) {
  const headers = { ...authHeaders(options.auth), ...(options.headers || {}) };
  const init = { method, headers };

  if (Object.prototype.hasOwnProperty.call(options, 'body')) {
    headers['content-type'] = headers['content-type'] || 'application/json';
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const response = await fetch(new URL(path, BACKEND_URL), init);
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, body, text };
}

function responseSummary(result) {
  return result.text || (result.body === null ? '<empty>' : JSON.stringify(result.body));
}

function assertStatus(result, expected, label) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert.ok(
    allowed.includes(result.status),
    `${label} expected HTTP ${allowed.join(' or ')}, received ${result.status}: ${responseSummary(result)}`,
  );
}

function extractRoleId(user) {
  if (!user || typeof user !== 'object') {
    return null;
  }

  if (typeof user.role_id === 'string') {
    return user.role_id;
  }

  if (typeof user.roleId === 'string') {
    return user.roleId;
  }

  return user.role && typeof user.role === 'object' && typeof user.role.id === 'string' ? user.role.id : null;
}

function extractRoleVersion(user) {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const value = user.role_version ?? user.roleVersion;
  return typeof value === 'number' ? value : null;
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

async function ensureLiveEnvironment(t) {
  if (typeof fetch !== 'function') {
    t.skip('This suite requires Node 18+ global fetch support.');
    return false;
  }

  const missing = [
    ['ADMIN_EMAIL', ADMIN_EMAIL],
    ['INTERNAL_SECRET', INTERNAL_SECRET],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    t.skip(`Missing required live environment variables: ${missing.join(', ')}`);
    return false;
  }

  if (state.environmentCheck) {
    if (state.environmentCheck.skipReason) {
      t.skip(state.environmentCheck.skipReason);
      return false;
    }

    return true;
  }

  try {
    const response = await fetch(new URL('/api/health', BACKEND_URL));
    state.environmentCheck = { skipReason: null, status: response.status };
    return true;
  } catch (error) {
    const message = `Backend is not reachable at ${BACKEND_URL}: ${error.message}`;
    state.environmentCheck = { skipReason: message, status: null };
    t.skip(message);
    return false;
  }
}

function assertUserShape(user, label) {
  assert.ok(user && typeof user === 'object', `${label} should be an object`);
  assert.equal(typeof user.id, 'string', `${label}.id should be a string`);
  assert.equal(hasOwn(user, 'email'), true, `${label}.email should be present`);
  assert.equal(hasOwn(user, 'name'), true, `${label}.name should be present`);
  assert.equal(hasOwn(user, 'role_id'), true, `${label}.role_id should be present`);
  assert.equal(hasOwn(user, 'is_active'), true, `${label}.is_active should be present`);
  assert.equal(hasOwn(user, 'phone'), true, `${label}.phone should be present`);
  assert.equal(hasOwn(user, 'role'), true, `${label}.role should be present`);
  assert.ok(!Array.isArray(user.role), `${label}.role should be normalized to an object or null`);

  if (user.role !== null) {
    assert.equal(typeof user.role, 'object', `${label}.role should be an object when present`);
    assert.equal(typeof user.role.id, 'string', `${label}.role.id should be a string`);
    assert.equal(typeof user.role.name, 'string', `${label}.role.name should be a string`);
  }
}

async function loadAdminUsers() {
  const result = await request('GET', '/api/admin/users');
  assertStatus(result, 200, 'GET /api/admin/users');
  assert.ok(Array.isArray(result.body), `GET /api/admin/users should return an array: ${responseSummary(result)}`);
  return result.body;
}

async function loadRoles() {
  const result = await request('GET', '/api/roles');
  assertStatus(result, 200, 'GET /api/roles');
  assert.ok(Array.isArray(result.body), `GET /api/roles should return an array: ${responseSummary(result)}`);
  return result.body;
}

function findAdminUser(users) {
  const expectedEmail = ADMIN_EMAIL.trim().toLowerCase();
  return users.find((user) => typeof user?.email === 'string' && user.email.trim().toLowerCase() === expectedEmail) || null;
}

function isNonSelfUser(user, adminUser) {
  if (!user || !adminUser) {
    return false;
  }

  if (user.id === adminUser.id) {
    return false;
  }

  if (typeof user.email === 'string' && typeof adminUser.email === 'string') {
    return user.email.trim().toLowerCase() !== adminUser.email.trim().toLowerCase();
  }

  return true;
}

function findAlternateRoleId(roles, currentRoleId) {
  const candidate = roles.find((role) => role && typeof role.id === 'string' && role.id !== currentRoleId);
  return candidate ? candidate.id : null;
}

function buildMutationPlan(users, roles, adminUser) {
  for (const user of users) {
    if (!isNonSelfUser(user, adminUser)) {
      continue;
    }

    const currentRoleId = extractRoleId(user);
    if (typeof currentRoleId !== 'string') {
      continue;
    }

    const alternateRoleId = findAlternateRoleId(roles, currentRoleId);
    if (!alternateRoleId) {
      continue;
    }

    return { user, alternateRoleId };
  }

  return null;
}

async function restorePendingUser() {
  if (!state.pendingRestore) {
    return;
  }

  const pendingRestore = state.pendingRestore;
  const result = await request('PATCH', `/api/admin/users/${encodeURIComponent(pendingRestore.id)}`, {
    body: {
      role_id: pendingRestore.roleId,
      is_active: pendingRestore.isActive,
    },
  });

  assertStatus(result, 200, `restore original fields for ${pendingRestore.label}`);
  assert.equal(extractRoleId(result.body), pendingRestore.roleId, 'restore should reinstate the original role_id');
  assert.equal(result.body.is_active, pendingRestore.isActive, 'restore should reinstate the original is_active value');
  state.pendingRestore = null;
}

after(async () => {
  const warnings = [];

  if (state.pendingRestore) {
    try {
      await restorePendingUser();
    } catch (error) {
      warnings.push(`restore original admin-user fields failed: ${error.message}`);
    }
  }

  if (warnings.length > 0) {
    console.warn(`[admin-users.integration.test.js] Cleanup warnings:\n- ${warnings.join('\n- ')}`);
  }
});

test('GET /api/admin/users returns normalized users with phone and role fields', async (t) => {
  if (!await ensureLiveEnvironment(t)) {
    return;
  }

  const users = await loadAdminUsers();
  assert.ok(users.length > 0, 'GET /api/admin/users should return at least one user');

  for (const [index, user] of users.entries()) {
    assertUserShape(user, `users[${index}]`);
  }

  const adminUser = findAdminUser(users);
  assert.ok(adminUser, `Expected GET /api/admin/users to include the configured admin email ${ADMIN_EMAIL}`);
});

test('PATCH /api/admin/users/:id rejects invalid bodies', async (t) => {
  if (!await ensureLiveEnvironment(t)) {
    return;
  }

  const users = await loadAdminUsers();
  const adminUser = findAdminUser(users);
  assert.ok(adminUser, `Expected GET /api/admin/users to include the configured admin email ${ADMIN_EMAIL}`);

  const targetUser = users.find((user) => isNonSelfUser(user, adminUser));
  if (!targetUser) {
    t.skip('No non-self user is available for invalid-body checks.');
  }

  const emptyBody = await request('PATCH', `/api/admin/users/${encodeURIComponent(targetUser.id)}`, {
    body: {},
  });
  assertStatus(emptyBody, 400, 'PATCH /api/admin/users/:id with empty body');
  assert.equal(emptyBody.body && emptyBody.body.error, 'Validation failed');
  assert.ok(
    Array.isArray(emptyBody.body && emptyBody.body.details && emptyBody.body.details._errors)
      && emptyBody.body.details._errors.includes('At least one field is required'),
    `Expected empty PATCH body to report the at-least-one-field validation error: ${responseSummary(emptyBody)}`,
  );

  const unknownField = await request('PATCH', `/api/admin/users/${encodeURIComponent(targetUser.id)}`, {
    body: { unexpected: true },
  });
  assertStatus(unknownField, 400, 'PATCH /api/admin/users/:id with unknown field');
  assert.equal(unknownField.body && unknownField.body.error, 'Validation failed');
  assert.ok(
    Array.isArray(unknownField.body && unknownField.body.details && unknownField.body.details._errors)
      && unknownField.body.details._errors.some((msg) => /unrecognized key/i.test(msg)),
    `Expected unknown PATCH field to surface a top-level unrecognized-key validation error: ${responseSummary(unknownField)}`,
  );
});

test('PATCH /api/admin/users/:id updates a real non-self user role and restores it', async (t) => {
  if (!await ensureLiveEnvironment(t)) {
    return;
  }

  const users = await loadAdminUsers();
  const roles = await loadRoles();
  const adminUser = findAdminUser(users);
  assert.ok(adminUser, `Expected GET /api/admin/users to include the configured admin email ${ADMIN_EMAIL}`);

  const mutationPlan = buildMutationPlan(users, roles, adminUser);
  if (!mutationPlan) {
    t.skip('No non-self user with a restorable role and alternate role is available in this environment.');
  }

  let testError = null;
  let restoreError = null;

  try {
    const beforeRoleVersion = extractRoleVersion(mutationPlan.user);
    state.pendingRestore = {
      id: mutationPlan.user.id,
      label: mutationPlan.user.email || mutationPlan.user.id,
      roleId: extractRoleId(mutationPlan.user),
      isActive: mutationPlan.user.is_active,
    };

    const patchResult = await request('PATCH', `/api/admin/users/${encodeURIComponent(mutationPlan.user.id)}`, {
      body: { role_id: mutationPlan.alternateRoleId },
    });

    assertStatus(patchResult, 200, 'PATCH /api/admin/users/:id role change');
    assertUserShape(patchResult.body, 'patched user');
    assert.equal(patchResult.body.id, mutationPlan.user.id, 'PATCH should return the mutated user');
    assert.equal(extractRoleId(patchResult.body), mutationPlan.alternateRoleId, 'PATCH should apply the alternate role_id');
    assert.equal(patchResult.body.is_active, mutationPlan.user.is_active, 'PATCH should preserve is_active when not changed');

    const afterRoleVersion = extractRoleVersion(patchResult.body);
    if (typeof beforeRoleVersion === 'number' && typeof afterRoleVersion === 'number') {
      assert.equal(afterRoleVersion, beforeRoleVersion + 1, 'Role changes should bump role_version by 1');
    } else {
      t.diagnostic('role_version was not numeric before and after the role change; exact bump assertion skipped.');
    }
  } catch (error) {
    testError = error;
  } finally {
    if (state.pendingRestore) {
      try {
        await restorePendingUser();
      } catch (error) {
        restoreError = error;
      }
    }
  }

  if (testError && restoreError) {
    throw new AggregateError([testError, restoreError], 'Admin user mutation test failed and cleanup restore failed');
  }

  if (restoreError) {
    throw restoreError;
  }

  if (testError) {
    throw testError;
  }
});

test('PATCH /api/admin/users/:id rejects unknown users and unknown roles', async (t) => {
  if (!await ensureLiveEnvironment(t)) {
    return;
  }

  const users = await loadAdminUsers();
  const adminUser = findAdminUser(users);
  assert.ok(adminUser, `Expected GET /api/admin/users to include the configured admin email ${ADMIN_EMAIL}`);

  const targetUser = users.find((user) => isNonSelfUser(user, adminUser));
  if (!targetUser) {
    t.skip('No non-self user is available for not-found and unknown-role checks.');
  }

  const unknownUser = await request('PATCH', `/api/admin/users/${encodeURIComponent(randomUUID())}`, {
    body: { is_active: true },
  });
  assertStatus(unknownUser, 404, 'PATCH /api/admin/users/:id for an unknown user');
  assert.equal(unknownUser.body && unknownUser.body.error, 'Not found');

  const unknownRole = await request('PATCH', `/api/admin/users/${encodeURIComponent(targetUser.id)}`, {
    body: { role_id: randomUUID() },
  });
  assertStatus(unknownRole, 400, 'PATCH /api/admin/users/:id with unknown role_id');
  assert.equal(unknownRole.body && unknownRole.body.error, 'Invalid request');
  assert.match(String(unknownRole.body && unknownRole.body.details), /role_id does not exist/i);
});

test('PATCH /api/admin/users/:id rejects self-role-change and self-deactivation', async (t) => {
  if (!await ensureLiveEnvironment(t)) {
    return;
  }

  const users = await loadAdminUsers();
  const adminUser = findAdminUser(users);
  assert.ok(adminUser, `Expected GET /api/admin/users to include the configured admin email ${ADMIN_EMAIL}`);

  const selfRoleChange = await request('PATCH', `/api/admin/users/${encodeURIComponent(adminUser.id)}`, {
    body: { role_id: extractRoleId(adminUser) || randomUUID() },
  });
  assertStatus(selfRoleChange, 403, 'PATCH /api/admin/users/:id self role change');
  assert.equal(selfRoleChange.body && selfRoleChange.body.error, 'Forbidden');
  assert.match(String(selfRoleChange.body && selfRoleChange.body.details), /own role/i);

  const selfDeactivate = await request('PATCH', `/api/admin/users/${encodeURIComponent(adminUser.id)}`, {
    body: { is_active: false },
  });
  assertStatus(selfDeactivate, 403, 'PATCH /api/admin/users/:id self deactivation');
  assert.equal(selfDeactivate.body && selfDeactivate.body.error, 'Forbidden');
  assert.match(String(selfDeactivate.body && selfDeactivate.body.details), /deactivate your own account/i);
});