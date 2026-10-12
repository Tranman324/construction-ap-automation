'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const { checkPermission } = require('../../middleware/permissions');

const INTERNAL_SECRET = 'test-internal-secret';
const JWT_SECRET = 'test-jwt-secret';

function createRes() {
  return {
    locals: {},
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

function loadAuthWithDb(db) {
  const authPath = require.resolve('../../middleware/auth');
  const dbPath = require.resolve('../../lib/db');
  const previousAuth = require.cache[authPath];
  const previousDb = require.cache[dbPath];
  const previousInternalSecret = process.env.INTERNAL_API_SECRET;
  const previousJwtSecret = process.env.NEXTAUTH_SECRET;

  process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
  process.env.NEXTAUTH_SECRET = JWT_SECRET;
  delete require.cache[authPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: db,
  };

  const auth = require(authPath);

  return {
    auth,
    cleanup() {
      delete require.cache[authPath];
      if (previousAuth) require.cache[authPath] = previousAuth;
      if (previousDb) require.cache[dbPath] = previousDb;
      else delete require.cache[dbPath];
      if (previousInternalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
      else process.env.INTERNAL_API_SECRET = previousInternalSecret;
      if (previousJwtSecret === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = previousJwtSecret;
    },
  };
}

function createSupabaseMock(responses, calls = []) {
  return {
    from(table) {
      calls.push(table);
      const response = responses[table] || { data: [], error: null };
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        maybeSingle() { return Promise.resolve(response); },
        then(onFulfilled, onRejected) { return Promise.resolve(response).then(onFulfilled, onRejected); },
      };
      return query;
    },
  };
}

function loadDbWithSupabase(supabase) {
  const dbPath = require.resolve('../../lib/db');
  const supabasePath = require.resolve('@supabase/supabase-js');
  const previousDb = require.cache[dbPath];
  const previousSupabase = require.cache[supabasePath];

  delete require.cache[dbPath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: { createClient: () => supabase },
  };

  const db = require(dbPath);

  return {
    db,
    cleanup() {
      delete require.cache[dbPath];
      if (previousDb) require.cache[dbPath] = previousDb;
      if (previousSupabase) require.cache[supabasePath] = previousSupabase;
      else delete require.cache[supabasePath];
    },
  };
}

async function runRequireAuth(auth, headers) {
  const req = {
    headers,
    log: {
      error() {},
    },
  };
  const res = createRes();
  let nextCalled = false;

  await auth.requireAuth(req, res, () => {
    nextCalled = true;
  });

  return { req, res, nextCalled };
}

async function runOptionalAuth(auth, headers) {
  const req = {
    headers,
    log: {
      error() {},
    },
  };
  const res = createRes();
  let nextCalled = false;

  await auth.optionalAuth(req, res, () => {
    nextCalled = true;
  });

  return { req, res, nextCalled };
}

test('JWT authority ignores spoofed role, user ID, and permission headers', async () => {
  const calls = [];
  const { auth, cleanup } = loadAuthWithDb({
    async getUserByEmailForAuth(email) {
      calls.push({ method: 'getUserByEmailForAuth', email });
      return {
        id: 'db-user-id',
        email: 'employee@example.com',
        role_id: 'employee-role-id',
        role: { name: 'employee' },
      };
    },
    async getUserPermissionsForAuth(userId, roleId) {
      calls.push({ method: 'getUserPermissionsForAuth', userId, roleId });
      return ['accounting.invoices.view'];
    },
  });

  try {
    const token = jwt.sign({ email: 'employee@example.com' }, JWT_SECRET, { algorithm: 'HS256' });
    const result = await runRequireAuth(auth, {
      authorization: `Bearer ${token}`,
      'x-user-role': 'admin',
      'x-user-id': 'spoofed-user-id',
      'x-user-permissions': 'platform.manage_users, accounting.invoices.approve',
    });

    assert.equal(result.nextCalled, true);
    assert.deepEqual(result.req.user, {
      email: 'employee@example.com',
      source: 'jwt',
      role: 'employee',
      userId: 'db-user-id',
      permissions: ['accounting.invoices.view'],
    });
    assert.equal(result.res.locals.userEmail, 'employee@example.com');
    assert.deepEqual(calls, [
      { method: 'getUserByEmailForAuth', email: 'employee@example.com' },
      { method: 'getUserPermissionsForAuth', userId: 'db-user-id', roleId: 'employee-role-id' },
    ]);
    assert.equal(checkPermission(result.req, 'platform.manage_users'), false);
    assert.equal(checkPermission(result.req, 'accounting.invoices.view'), true);
  } finally {
    cleanup();
  }
});

test('internal proxy headers retain their req.user authority values', async () => {
  const calls = [];
  const { auth, cleanup } = loadAuthWithDb({
    async getUserByEmailForAuth(email) {
      calls.push(email);
      return { id: 'proxy-user-id', email, is_active: true };
    },
    async getUserPermissionsForAuth() { throw new Error('internal path must not query the database'); },
  });

  try {
    const result = await runRequireAuth(auth, {
      'x-internal-secret': INTERNAL_SECRET,
      'x-user-email': 'proxy-user@example.com',
      'x-user-role': 'admin',
      'x-user-id': 'proxy-user-id',
      'x-user-permissions': ' platform.manage_users, , accounting.invoices.view ',
    });

    assert.equal(result.nextCalled, true);
    assert.deepEqual(result.req.user, {
      email: 'proxy-user@example.com',
      source: 'internal',
      role: 'admin',
      userId: 'proxy-user-id',
      permissions: ['platform.manage_users', 'accounting.invoices.view'],
    });
    assert.deepEqual(calls, ['proxy-user@example.com']);
    assert.equal(checkPermission(result.req, 'anything.at.all'), true);
  } finally {
    cleanup();
  }
});

test('deactivated internal proxy users are rejected', async () => {
  let calls = 0;
  const { auth, cleanup } = loadAuthWithDb({
    async getUserByEmailForAuth() {
      calls++;
      return { id: 'inactive-user-id', is_active: false };
    },
  });

  try {
    const result = await runRequireAuth(auth, {
      'x-internal-secret': INTERNAL_SECRET,
      'x-user-email': 'inactive@example.com',
    });
    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 401);
    assert.deepEqual(result.res.body, { error: 'Unauthorized' });
    const cached = await runRequireAuth(auth, {
      'x-internal-secret': INTERNAL_SECRET,
      'x-user-email': 'inactive@example.com',
    });
    assert.equal(cached.nextCalled, false);
    assert.equal(cached.res.statusCode, 401);
    assert.equal(calls, 1);
  } finally {
    cleanup();
  }
});

test('active and unknown internal proxy users remain allowed', async () => {
  const calls = [];
  const { auth, cleanup } = loadAuthWithDb({
    async getUserByEmailForAuth(email) {
      calls.push(email);
      return email === 'active@example.com' ? { id: 'active-user-id', is_active: true } : null;
    },
  });

  try {
    const active = await runRequireAuth(auth, {
      'x-internal-secret': INTERNAL_SECRET,
      'x-user-email': 'active@example.com',
    });
    const unknown = await runRequireAuth(auth, {
      'x-internal-secret': INTERNAL_SECRET,
      'x-user-email': 'unknown@example.com',
    });
    assert.equal(active.nextCalled, true);
    assert.equal(unknown.nextCalled, true);
    assert.deepEqual(calls, ['active@example.com', 'unknown@example.com']);
  } finally {
    cleanup();
  }
});

test('internal active-status verdicts are cached for the TTL', async () => {
  let calls = 0;
  const { auth, cleanup } = loadAuthWithDb({
    async getUserByEmailForAuth() {
      calls++;
      return { id: 'active-user-id', is_active: true };
    },
  });

  try {
    auth.clearActiveStatusCache();
    const headers = {
      'x-internal-secret': INTERNAL_SECRET,
      'x-user-email': 'cached@example.com',
    };
    assert.equal((await runRequireAuth(auth, headers)).nextCalled, true);
    assert.equal((await runRequireAuth(auth, headers)).nextCalled, true);
    assert.equal(calls, 1);
  } finally {
    cleanup();
  }
});

test('internal active-status DB errors fail open and are logged', async () => {
  let logged = 0;
  const { auth, cleanup } = loadAuthWithDb({
    async getUserByEmailForAuth() { throw new Error('database unavailable'); },
  });

  try {
    const req = {
      headers: {
        'x-internal-secret': INTERNAL_SECRET,
        'x-user-email': 'error@example.com',
      },
      log: { error() { logged++; } },
    };
    const res = createRes();
    let nextCalled = false;
    await auth.requireAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
    assert.equal(logged, 1);
  } finally {
    cleanup();
  }
});

test('headerless internal-secret callers retain the system identity', async () => {
  const { auth, cleanup } = loadAuthWithDb({
    async getUserByEmailForAuth() { throw new Error('system path must not query the database'); },
    async getUserPermissionsForAuth() { throw new Error('system path must not query the database'); },
  });

  try {
    const result = await runRequireAuth(auth, { 'x-internal-secret': INTERNAL_SECRET });

    assert.equal(result.nextCalled, true);
    assert.deepEqual(result.req.user, {
      email: 'system',
      source: 'internal',
      role: null,
      userId: null,
      permissions: [],
    });
    assert.equal(result.res.locals.userEmail, 'system');
  } finally {
    cleanup();
  }
});

test('real auth DB helper lookup failures return a generic 500 instead of 401', async () => {
  const calls = [];
  const { db, cleanup: cleanupDb } = loadDbWithSupabase(createSupabaseMock({
    toolbox_users: { data: null, error: new Error('database connection refused') },
  }, calls));
  const { auth, cleanup } = loadAuthWithDb(db);

  try {
    const token = jwt.sign({ email: 'employee@example.com' }, JWT_SECRET, { algorithm: 'HS256' });
    const result = await runRequireAuth(auth, { authorization: `Bearer ${token}` });

    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 500);
    assert.deepEqual(result.res.body, { error: 'Internal server error' });
    assert.equal(JSON.stringify(result.res.body).includes('database connection refused'), false);
    assert.deepEqual(calls, ['toolbox_users']);
  } finally {
    cleanup();
    cleanupDb();
  }
});

test('optional JWT identity lookup failures return a generic 500 instead of continuing anonymous', async () => {
  const { auth, cleanup } = loadAuthWithDb({
    async getUserByEmailForAuth() {
      throw new Error('database connection refused');
    },
    async getUserPermissionsForAuth() {
      throw new Error('permission lookup must not run');
    },
  });

  try {
    const token = jwt.sign({ email: 'employee@example.com' }, JWT_SECRET, { algorithm: 'HS256' });
    const result = await runOptionalAuth(auth, { authorization: `Bearer ${token}` });

    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 500);
    assert.deepEqual(result.res.body, { error: 'Internal server error' });
    assert.equal(JSON.stringify(result.res.body).includes('database connection refused'), false);
  } finally {
    cleanup();
  }
});

test('real auth permission helper failures return 500 without a duplicate user lookup', async () => {
  const calls = [];
  const { db, cleanup: cleanupDb } = loadDbWithSupabase(createSupabaseMock({
    toolbox_users: {
      data: {
        id: 'db-user-id',
        email: 'employee@example.com',
        is_active: true,
        role_id: 'employee-role-id',
        role: { name: 'employee' },
      },
      error: null,
    },
    role_permissions: { data: null, error: new Error('permission query unavailable') },
  }, calls));
  const { auth, cleanup } = loadAuthWithDb(db);

  try {
    const token = jwt.sign({ email: 'employee@example.com' }, JWT_SECRET, { algorithm: 'HS256' });
    const result = await runRequireAuth(auth, { authorization: `Bearer ${token}` });

    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 500);
    assert.deepEqual(result.res.body, { error: 'Internal server error' });
    assert.equal(JSON.stringify(result.res.body).includes('permission query unavailable'), false);
    assert.deepEqual(calls, ['toolbox_users', 'role_permissions']);
  } finally {
    cleanup();
    cleanupDb();
  }
});

test('optional JWT permission lookup failures return a generic 500 instead of continuing anonymous', async () => {
  const { auth, cleanup } = loadAuthWithDb({
    async getUserByEmailForAuth() {
      return { id: 'db-user-id', email: 'employee@example.com', is_active: true, role: { name: 'employee' } };
    },
    async getUserPermissionsForAuth() {
      throw new Error('optional permission query unavailable');
    },
  });

  try {
    const token = jwt.sign({ email: 'employee@example.com' }, JWT_SECRET, { algorithm: 'HS256' });
    const result = await runOptionalAuth(auth, { authorization: `Bearer ${token}` });

    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 500);
    assert.deepEqual(result.res.body, { error: 'Internal server error' });
    assert.equal(JSON.stringify(result.res.body).includes('optional permission query unavailable'), false);
  } finally {
    cleanup();
  }
});

test('verified JWT with no matching Toolbox user remains unauthorized', async () => {
  const { auth, cleanup } = loadAuthWithDb({
    async getUserByEmailForAuth() { return null; },
    async getUserPermissionsForAuth() { throw new Error('permission lookup must not run'); },
  });

  try {
    const token = jwt.sign({ email: 'absent@example.com' }, JWT_SECRET, { algorithm: 'HS256' });
    const result = await runRequireAuth(auth, { authorization: `Bearer ${token}` });

    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 401);
    assert.deepEqual(result.res.body, { error: 'Unauthorized' });
  } finally {
    cleanup();
  }
});

test('inactive JWT users are denied before permission lookup', async () => {
  let permissionLookupCalled = false;
  const { auth, cleanup } = loadAuthWithDb({
    async getUserByEmailForAuth() {
      return { id: 'inactive-user-id', email: 'inactive@example.com', is_active: false, role: { name: 'admin' } };
    },
    async getUserPermissionsForAuth() {
      permissionLookupCalled = true;
      return ['platform.manage_users'];
    },
  });

  try {
    const token = jwt.sign({ email: 'inactive@example.com' }, JWT_SECRET, { algorithm: 'HS256' });
    const result = await runRequireAuth(auth, { authorization: `Bearer ${token}` });

    assert.equal(result.nextCalled, false);
    assert.equal(result.res.statusCode, 401);
    assert.deepEqual(result.res.body, { error: 'Unauthorized' });
    assert.equal(permissionLookupCalled, false);
  } finally {
    cleanup();
  }
});
