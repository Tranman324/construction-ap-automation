'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const INTERNAL_SECRET = 'audit-actor-test-secret';
const JWT_SECRET = 'audit-actor-test-jwt-secret';

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

function createRequest(headers, body) {
  return {
    body,
    headers,
    log: {
      error() {},
      warn() {},
    },
  };
}

function loadAuth(db = {
  async getUserByEmailForAuth() { return null; },
  async getUserPermissionsForAuth() { return []; },
}) {
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

function loadAuditRoute(insertAuditEvent) {
  const routePath = require.resolve('../../routes/audit-events');
  const auditEventsPath = require.resolve('../../lib/auditEvents');
  const previousRoute = require.cache[routePath];
  const previousAuditEvents = require.cache[auditEventsPath];

  delete require.cache[routePath];
  require.cache[auditEventsPath] = {
    id: auditEventsPath,
    filename: auditEventsPath,
    loaded: true,
    exports: {
      insertAuditEvent,
      listAuditEvents: async () => ({ events: [], pagination: {} }),
    },
  };
  const router = require(routePath);
  const postRoute = router.stack.find((layer) => layer.route?.path === '/events' && layer.route.methods.post);

  return {
    validate: postRoute.route.stack[0].handle,
    create: postRoute.route.stack[1].handle,
    cleanup() {
      delete require.cache[routePath];
      if (previousRoute) require.cache[routePath] = previousRoute;
      if (previousAuditEvents) require.cache[auditEventsPath] = previousAuditEvents;
      else delete require.cache[auditEventsPath];
    },
  };
}

async function validateAndCreate(route, req, res) {
  await new Promise((resolve) => route.validate(req, res, resolve));
  if (res.statusCode === null) await route.create(req, res);
}

function validEvent(actor) {
  return {
    id: 'audit-event-1',
    type: 'invoice.approved',
    timestamp: '2026-07-15T12:00:00.000Z',
    actor,
    target: { type: 'invoice', id: 'invoice-1', label: 'INV-001' },
    changes: { approvalStatus: 'A' },
    summary: 'Invoice approved',
    module: 'invoices',
    severity: 'info',
  };
}

test('audit event POST rejects unauthenticated requests', async () => {
  const { auth, cleanup } = loadAuth();
  try {
    const req = createRequest({}, validEvent({ userId: 'forged', name: 'Forged User', role: 'admin' }));
    const res = createRes();
    let nextCalled = false;

    await auth.requireAuth(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Unauthorized' });
  } finally {
    cleanup();
  }
});

test('audit event POST overwrites every forged actor field with the authenticated user', async () => {
  const inserted = [];
  const route = loadAuditRoute(async (event) => {
    inserted.push(event);
    return event;
  });
  const { auth, cleanup } = loadAuth();

  try {
    const req = createRequest({
      'x-internal-secret': INTERNAL_SECRET,
      'x-user-email': 'employee@example.com',
      'x-user-id': 'employee-id',
      'x-user-role': 'employee',
    }, validEvent({ userId: 'forged-id', name: 'Forged Admin', role: 'admin' }));
    const res = createRes();

    await auth.requireAuth(req, res, () => {});
    await validateAndCreate(route, req, res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(inserted[0].actor, {
      userId: 'employee-id',
      name: 'employee@example.com',
      role: 'employee',
    });
    assert.deepEqual(res.body.actor, inserted[0].actor);
  } finally {
    cleanup();
    route.cleanup();
  }
});

test('audit actor ignores a spoofed role header for a JWT user without a role', async () => {
  const { auth, cleanup } = loadAuth({
    async getUserByEmailForAuth() {
      return {
        id: 'jwt-user-id',
        email: 'jwt-user@example.com',
        role_id: null,
        role: null,
      };
    },
    async getUserPermissionsForAuth() { return []; },
  });

  try {
    const req = createRequest({
      authorization: `Bearer ${jwt.sign({ email: 'jwt-user@example.com' }, JWT_SECRET, { algorithm: 'HS256' })}`,
      'x-user-role': 'admin',
    }, {});
    const res = createRes();
    let nextCalled = false;

    await auth.requireAuth(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.deepEqual(require('../../lib/auditEvents').getRequestAuditActor(req, res), {
      userId: 'jwt-user-id',
      name: 'jwt-user@example.com',
      role: null,
    });
  } finally {
    cleanup();
  }
});

test('a non-admin authenticated user can emit an invoice audit event', async () => {
  const route = loadAuditRoute(async (event) => event);
  const { auth, cleanup } = loadAuth();

  try {
    const req = createRequest({
      'x-internal-secret': INTERNAL_SECRET,
      'x-user-email': 'employee@example.com',
      'x-user-id': 'employee-id',
      'x-user-role': 'employee',
    }, validEvent({ userId: 'employee-id', name: 'employee@example.com', role: 'employee' }));
    const res = createRes();

    await auth.requireAuth(req, res, () => {});
    await validateAndCreate(route, req, res);

    assert.equal(req.user.role, 'employee');
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.type, 'invoice.approved');
    assert.equal(res.body.target.type, 'invoice');
  } finally {
    cleanup();
    route.cleanup();
  }
});
