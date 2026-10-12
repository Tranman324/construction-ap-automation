'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function response() {
  return {
    statusCode: 200,
    body: null,
    locals: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

function request(body = {}, params = {}) {
  return {
    body,
    params,
    user: { userId: 'actor-1', email: 'admin@example.com', role: 'admin' },
    log: { error() {} },
  };
}

function builder(result) {
  return {
    select() { return this; },
    insert() { return this; },
    update() { return this; },
    delete() { return this; },
    eq() { return this; },
    in() { return this; },
    order() { return this; },
    maybeSingle: async () => result,
    single: async () => result,
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
}

function makeSupabase(results) {
  const positions = new Map();
  return {
    from(table) {
      const position = positions.get(table) || 0;
      positions.set(table, position + 1);
      const queue = results[table] || [];
      return builder(queue[position] || { data: null, error: null });
    },
    async rpc() { return { error: null }; },
  };
}

async function withRoute(routeName, db, audit, fn) {
  const routePath = path.join(root, 'routes', routeName);
  const resolved = require.resolve(routePath);
  const priorRoute = require.cache[resolved];
  const auditEventsPath = path.join(root, 'lib', 'auditEvents.js');
  const resolvedAuditEvents = require.resolve(auditEventsPath);
  const priorAuditEvents = require.cache[resolvedAuditEvents];
  const originalLoad = Module._load;
  const routeErrors = [];
  const servicePath = path.join(root, 'services', ({
    'roles.js': 'roleService.js',
    'permissions.js': 'permissionService.js',
    'title-rules.js': 'titleRuleService.js',
    'admin-users.js': 'adminUserService.js',
  })[routeName]);
  const resolvedService = require.resolve(servicePath);
  const priorService = require.cache[resolvedService];

  delete require.cache[resolved];
  delete require.cache[resolvedService];
  if (audit === undefined) delete require.cache[resolvedAuditEvents];
  Module._load = function load(requestName, parent, isMain) {
    if (requestName === '../lib/db' || (requestName === './db' && parent?.filename === auditEventsPath)) return db;
    if (requestName === '../lib/auditEvents' && audit !== undefined) return { emitPlatformAuditEvent: audit };
    if (requestName === '../lib/requestLog') return { logRequestError: (...args) => routeErrors.push(args) };
    if (requestName === '../middleware/permissions' || requestName === '../middleware/validate') {
      return { [requestName.endsWith('permissions') ? 'requirePermission' : 'validate']: () => (req, res, next) => next() };
    }
    if (requestName === '../lib/schemas') return {};
    return originalLoad.call(this, requestName, parent, isMain);
  };

  try {
    return await fn(require(resolved), routeErrors);
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolved];
    if (priorRoute) require.cache[resolved] = priorRoute;
    delete require.cache[resolvedService];
    if (priorService) require.cache[resolvedService] = priorService;
    if (audit === undefined) {
      delete require.cache[resolvedAuditEvents];
      if (priorAuditEvents) require.cache[resolvedAuditEvents] = priorAuditEvents;
    }
  }
}

function auditRow(values) {
  return {
    id: values[0],
    type: values[1],
    timestamp: new Date().toISOString(),
    actor_user_id: values[3],
    actor_name: values[4],
    actor_role: values[5],
    target_type: values[6],
    target_id: values[7],
    target_label: values[8],
    changes: values[9] === null ? null : JSON.parse(values[9]),
    before_state: values[10] === null ? null : JSON.parse(values[10]),
    after_state: values[11] === null ? null : JSON.parse(values[11]),
    undoable: values[12],
    summary: values[13],
    module: values[14],
    severity: values[15],
  };
}

function handler(router, method, routePath) {
  const layer = router.stack.find((candidate) => candidate.route?.path === routePath && candidate.route.methods[method]);
  assert.ok(layer, `expected ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack.at(-1).handle;
}

test('role CRUD emits actor-attributed platform audit events with snapshots', async () => {
  const audits = [];
  const db = {
    supabase: makeSupabase({
      roles: [
        { data: { id: 'role-1', name: 'Reviewer', description: null, is_system: false }, error: null },
        { data: { id: 'role-1', name: 'Reviewer', description: null, is_system: false }, error: null },
        { data: { id: 'role-1', name: 'Senior Reviewer', description: 'Updated', is_system: false }, error: null },
        { data: { id: 'role-1', name: 'Senior Reviewer', description: 'Updated', is_system: false }, error: null },
        { data: null, error: null },
      ],
      toolbox_users: [{ count: 0, error: null }],
    }),
  };

  await withRoute('roles.js', db, async (req, res, event) => audits.push({ actor: req.user, event }), async (router) => {
    let res = response();
    await handler(router, 'post', '/')(request({ name: 'Reviewer' }), res);
    assert.equal(res.statusCode, 201);
    res = response();
    await handler(router, 'patch', '/:id')(request({ name: 'Senior Reviewer', description: 'Updated' }, { id: 'role-1' }), res);
    assert.equal(res.statusCode, 200);
    res = response();
    await handler(router, 'delete', '/:id')(request({}, { id: 'role-1' }), res);
    assert.equal(res.statusCode, 204);
  });

  assert.deepEqual(audits.map(({ actor, event }) => [event.type, actor.email, event.beforeState, event.afterState]), [
    ['platform.role_created', 'admin@example.com', undefined, { id: 'role-1', name: 'Reviewer', description: null, is_system: false }],
    ['platform.role_updated', 'admin@example.com', { id: 'role-1', name: 'Reviewer', description: null, is_system: false }, { id: 'role-1', name: 'Senior Reviewer', description: 'Updated', is_system: false }],
    ['platform.role_deleted', 'admin@example.com', { id: 'role-1', name: 'Senior Reviewer', description: 'Updated', is_system: false }, null],
  ]);
});

test('role CRUD succeeds and logs when platform audit emission fails', async () => {
  const attemptedEvents = [];
  const db = {
    supabase: makeSupabase({
      roles: [
        { data: { id: 'role-1', name: 'Reviewer', description: null, is_system: false }, error: null },
        { data: { id: 'role-1', name: 'Reviewer', description: null, is_system: false }, error: null },
        { data: { id: 'role-1', name: 'Senior Reviewer', description: 'Updated', is_system: false }, error: null },
        { data: { id: 'role-1', name: 'Senior Reviewer', description: 'Updated', is_system: false }, error: null },
        { data: null, error: null },
      ],
      toolbox_users: [{ count: 0, error: null }],
    }),
  };

  await withRoute('roles.js', db, async (req, res, event) => {
    attemptedEvents.push(event);
    throw new Error('role audit storage unavailable');
  }, async (router, routeErrors) => {
    let res = response();
    await handler(router, 'post', '/')(request({ name: 'Reviewer' }), res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { id: 'role-1', name: 'Reviewer', description: null, is_system: false });
    res = response();
    await handler(router, 'patch', '/:id')(request({ name: 'Senior Reviewer', description: 'Updated' }, { id: 'role-1' }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { id: 'role-1', name: 'Senior Reviewer', description: 'Updated', is_system: false });
    res = response();
    await handler(router, 'delete', '/:id')(request({}, { id: 'role-1' }), res);
    assert.equal(res.statusCode, 204);
    assert.equal(routeErrors.length, 3);
    assert.deepEqual(routeErrors.map(([, operation,, context]) => [operation, context]), [
      ['emitRoleAuditEvent', { roleId: 'role-1', eventType: 'platform.role_created' }],
      ['emitRoleAuditEvent', { roleId: 'role-1', eventType: 'platform.role_updated' }],
      ['emitRoleAuditEvent', { roleId: 'role-1', eventType: 'platform.role_deleted' }],
    ]);
  });

  assert.deepEqual(attemptedEvents.map((event) => event.type), [
    'platform.role_created',
    'platform.role_updated',
    'platform.role_deleted',
  ]);
});

test('role permissions and user overrides record before/after state and grants or revokes', async () => {
  const audits = [];
  const db = {
    supabase: makeSupabase({
      permissions: [
        { data: [{ key: 'one' }, { key: 'two' }], error: null },
        { data: [{ key: 'one' }, { key: 'two' }], error: null },
      ],
      roles: [{ data: { id: 'role-1' }, error: null }],
      role_permissions: [{ data: [{ permission_key: 'one' }], error: null }],
      toolbox_users: [{ data: { id: 'user-1' }, error: null }],
      user_permission_overrides: [{ data: [{ permission_key: 'one', granted: true }], error: null }],
    }),
  };

  await withRoute('permissions.js', db, async (req, res, event) => audits.push({ actor: req.user, event }), async (router) => {
    let res = response();
    await handler(router, 'put', '/roles/:id/permissions')(request({ permissions: ['two'] }, { id: 'role-1' }), res);
    assert.equal(res.statusCode, 200);
    res = response();
    await handler(router, 'put', '/users/:id/overrides')(request({ overrides: [{ key: 'two', granted: false }] }, { id: 'user-1' }), res);
    assert.equal(res.statusCode, 200);
  });

  assert.deepEqual(audits.map(({ actor, event }) => [event.type, actor.userId, event.beforeState, event.afterState]), [
    ['platform.role_permissions_updated', 'actor-1', { permissions: ['one'] }, { permissions: ['two'] }],
    ['platform.user_permission_overrides_updated', 'actor-1', { overrides: [{ key: 'one', granted: true }] }, { overrides: [{ key: 'two', granted: false }] }],
  ]);
  assert.deepEqual(audits[0].event.changes, { granted: ['two'], revoked: ['one'] });
});

test('permission snapshot failures use null before-state while real audit insertion preserves successful mutations', async () => {
  const insertions = [];
  const db = {
    supabase: makeSupabase({
      permissions: [
        { data: [{ key: 'one' }], error: null },
        { data: [{ key: 'one' }], error: null },
      ],
      roles: [{ data: { id: 'role-1' }, error: null }],
      role_permissions: [{ data: null, error: new Error('role snapshot unavailable') }],
      toolbox_users: [{ data: { id: 'user-1' }, error: null }],
      user_permission_overrides: [{ data: null, error: new Error('override snapshot unavailable') }],
    }),
    async query(sql, values) {
      insertions.push({ sql, values });
      return { rows: [auditRow(values)] };
    },
  };

  await withRoute('permissions.js', db, undefined, async (router, routeErrors) => {
    let res = response();
    await handler(router, 'put', '/roles/:id/permissions')(request({ permissions: ['one'] }, { id: 'role-1' }), res);
    assert.equal(res.statusCode, 200);
    res = response();
    await handler(router, 'put', '/users/:id/overrides')(request({ overrides: [{ key: 'one', granted: true }] }, { id: 'user-1' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(routeErrors.length, 2);
  });

  assert.equal(insertions.length, 2);
  assert.equal(insertions[0].values[1], 'platform.role_permissions_updated');
  assert.equal(insertions[0].values[10], 'null');
  assert.equal(insertions[1].values[1], 'platform.user_permission_overrides_updated');
  assert.equal(insertions[1].values[10], 'null');
});

test('real platform audit insertion failures do not fail completed permission mutations', async () => {
  const db = {
    supabase: makeSupabase({
      permissions: [{ data: [{ key: 'one' }], error: null }],
      roles: [{ data: { id: 'role-1' }, error: null }],
      role_permissions: [{ data: [], error: null }],
    }),
    async query() {
      throw new Error('audit insert unavailable');
    },
  };

  await withRoute('permissions.js', db, undefined, async (router, routeErrors) => {
    let res = response();
    await handler(router, 'put', '/roles/:id/permissions')(request({ permissions: ['one'] }, { id: 'role-1' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(routeErrors.length, 1);
    assert.equal(routeErrors[0][1], 'emitPermissionAuditEvent');
  });
});

test('admin user role and activation changes emit a best-effort audit event', async () => {
  const audits = [];
  const db = {
    supabase: makeSupabase({
      toolbox_users: [
        { data: { id: 'user-1', email: 'employee@example.com', role_id: 'role-1', is_active: true }, error: null },
        { data: { id: 'user-1', email: 'employee@example.com', role_id: 'role-2', is_active: false, role_version: 3, role: null }, error: null },
      ],
      roles: [
        { data: { id: 'role-2', name: 'employee' }, error: null },
        { data: { id: 'role-1', name: 'employee' }, error: null },
      ],
    }),
    async bumpRoleVersion() { return { role_version: 4 }; },
  };

  await withRoute('admin-users.js', db, async (req, res, event) => {
    audits.push({ actor: req.user, event });
    throw new Error('audit storage unavailable');
  }, async (router, routeErrors) => {
    const res = response();
    await handler(router, 'patch', '/:id')(request({ role_id: 'role-2', is_active: false }, { id: 'user-1' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(routeErrors.length, 1);
  });

  assert.deepEqual(audits[0], {
    actor: { userId: 'actor-1', email: 'admin@example.com', role: 'admin' },
    event: {
      type: 'platform.user_updated',
      targetType: 'user',
      targetId: 'user-1',
      targetLabel: 'employee@example.com',
      changes: { role_id: ['role-1', 'role-2'], is_active: [true, false] },
      beforeState: { role_id: 'role-1', is_active: true },
      afterState: { role_id: 'role-2', is_active: false },
      summary: 'Updated user employee@example.com',
    },
  });
});

test('title rule CRUD emits actor-attributed platform audit events with snapshots', async () => {
  const audits = [];
  const oldRule = { id: 'rule-1', pattern: 'Estimator', match_type: 'contains', role_id: 'role-1', priority: 1, is_active: true, created_at: '2026-07-15T00:00:00Z', role: { name: 'Reviewer' } };
  const newRule = { ...oldRule, pattern: 'Senior Estimator', priority: 2 };
  const db = {
    supabase: makeSupabase({
      roles: [
        { data: { id: 'role-1', name: 'Reviewer' }, error: null },
        { data: { id: 'role-1', name: 'Reviewer' }, error: null },
      ],
      title_role_rules: [
        { data: oldRule, error: null },
        { data: oldRule, error: null },
        { data: newRule, error: null },
        { data: newRule, error: null },
        { data: { id: 'rule-1' }, error: null },
      ],
    }),
    matchTitleRule: async () => null,
  };

  await withRoute('title-rules.js', db, async (req, res, event) => audits.push({ actor: req.user, event }), async (router) => {
    let res = response();
    await handler(router, 'post', '/')(request({ pattern: 'Estimator', match_type: 'contains', role_id: 'role-1', priority: 1 }), res);
    assert.equal(res.statusCode, 201);
    res = response();
    await handler(router, 'patch', '/:id')(request({ pattern: 'Senior Estimator' }, { id: 'rule-1' }), res);
    assert.equal(res.statusCode, 200);
    res = response();
    await handler(router, 'delete', '/:id')(request({}, { id: 'rule-1' }), res);
    assert.equal(res.statusCode, 204);
  });

  assert.deepEqual(audits.map(({ actor, event }) => [event.type, actor.role, event.beforeState?.pattern || null, event.afterState?.pattern || null]), [
    ['platform.title_rule_created', 'admin', null, 'Estimator'],
    ['platform.title_rule_updated', 'admin', 'Estimator', 'Senior Estimator'],
    ['platform.title_rule_deleted', 'admin', 'Senior Estimator', null],
  ]);
});

test('title rule CRUD succeeds and logs when platform audit emission fails', async () => {
  const attemptedEvents = [];
  const createdRule = {
    id: 'rule-1',
    pattern: 'Estimator',
    match_type: 'contains',
    role_id: 'role-1',
    priority: 1,
    is_active: true,
    created_at: '2026-07-15T00:00:00Z',
    role: { name: 'Reviewer' },
  };
  const updatedRule = { ...createdRule, pattern: 'Senior Estimator', priority: 2 };
  const db = {
    supabase: makeSupabase({
      roles: [{ data: { id: 'role-1', name: 'Reviewer' }, error: null }],
      title_role_rules: [
        { data: createdRule, error: null },
        { data: createdRule, error: null },
        { data: updatedRule, error: null },
        { data: updatedRule, error: null },
        { data: { id: 'rule-1' }, error: null },
      ],
    }),
    matchTitleRule: async () => null,
  };

  await withRoute('title-rules.js', db, async (req, res, event) => {
    attemptedEvents.push(event);
    throw new Error('title rule audit storage unavailable');
  }, async (router, routeErrors) => {
    let res = response();
    await handler(router, 'post', '/')(request({ pattern: 'Estimator', match_type: 'contains', role_id: 'role-1', priority: 1 }), res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, {
      id: 'rule-1',
      pattern: 'Estimator',
      match_type: 'contains',
      role_id: 'role-1',
      priority: 1,
      is_active: true,
      created_at: '2026-07-15T00:00:00Z',
      role_name: 'Reviewer',
    });
    res = response();
    await handler(router, 'patch', '/:id')(request({ pattern: 'Senior Estimator' }, { id: 'rule-1' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.pattern, 'Senior Estimator');
    res = response();
    await handler(router, 'delete', '/:id')(request({}, { id: 'rule-1' }), res);
    assert.equal(res.statusCode, 204);
    assert.equal(routeErrors.length, 3);
    assert.deepEqual(routeErrors.map(([, operation,, context]) => [operation, context]), [
      ['emitTitleRuleAuditEvent', { ruleId: 'rule-1', eventType: 'platform.title_rule_created' }],
      ['emitTitleRuleAuditEvent', { ruleId: 'rule-1', eventType: 'platform.title_rule_updated' }],
      ['emitTitleRuleAuditEvent', { ruleId: 'rule-1', eventType: 'platform.title_rule_deleted' }],
    ]);
  });

  assert.deepEqual(attemptedEvents.map((event) => event.type), [
    'platform.title_rule_created',
    'platform.title_rule_updated',
    'platform.title_rule_deleted',
  ]);
});
