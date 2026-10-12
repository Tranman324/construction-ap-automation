'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const { classifyMigrationSql } = require('../../lib/migrations');

const root = path.resolve(__dirname, '..', '..');

function loadSafeEqual(cryptoOverride) {
  const authPath = require.resolve('../../middleware/auth');
  const dbPath = require.resolve('../../lib/db');
  const priorAuth = require.cache[authPath];
  const priorDb = require.cache[dbPath];
  const originalLoad = Module._load;

  delete require.cache[authPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      async getUserByEmailForAuth() { return null; },
      async getUserPermissionsForAuth() { return []; },
    },
  };
  if (cryptoOverride) {
    Module._load = function load(requestName, parent, isMain) {
      if (requestName === 'node:crypto') return cryptoOverride;
      return originalLoad.call(this, requestName, parent, isMain);
    };
  }

  try {
    return require(authPath).safeEqual;
  } finally {
    Module._load = originalLoad;
    delete require.cache[authPath];
    if (priorAuth) require.cache[authPath] = priorAuth;
    if (priorDb) require.cache[dbPath] = priorDb;
    else delete require.cache[dbPath];
  }
}

function response() {
  return {
    statusCode: 200,
    body: null,
    locals: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(body, id = 'target-user') {
  return {
    body,
    params: { id },
    user: { userId: 'other-admin', email: 'other-admin@example.com', role: 'admin' },
    log: { error() {} },
  };
}

function makeSupabase({ existing, roles = [], activeAdminCount, updated }) {
  const calls = [];
  const roleResults = [...roles];
  let toolboxQuery = 0;

  function query(result, table) {
    return {
      select(...args) { calls.push({ table, method: 'select', args }); return this; },
      update(payload) { calls.push({ table, method: 'update', payload }); return this; },
      eq(...args) { calls.push({ table, method: 'eq', args }); return this; },
      maybeSingle: async () => result,
      single: async () => result,
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
  }

  return {
    calls,
    from(table) {
      if (table === 'roles') {
        return query({ data: roleResults.shift() || null, error: null }, table);
      }

      if (table === 'toolbox_users') {
        toolboxQuery += 1;
        if (toolboxQuery === 1) {
          return query({ data: existing, error: null }, table);
        }
        if (toolboxQuery === 2 && activeAdminCount !== undefined) {
          return query({ data: null, error: null, count: activeAdminCount }, table);
        }
        return query({ data: updated, error: null }, table);
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

async function withAdminUserRoute(db, fn) {
  const routePath = path.join(root, 'routes', 'admin-users.js');
  const resolved = require.resolve(routePath);
  const priorRoute = require.cache[resolved];
  const originalLoad = Module._load;
  const servicePath = path.join(root, 'services', 'adminUserService.js');
  const resolvedService = require.resolve(servicePath);
  const priorService = require.cache[resolvedService];

  delete require.cache[resolved];
  delete require.cache[resolvedService];
  Module._load = function load(requestName, parent, isMain) {
    if (requestName === '../lib/db') return db;
    if (requestName === '../lib/auditEvents') return { emitPlatformAuditEvent: async () => {} };
    if (requestName === '../lib/requestLog') return { logRequestError() {} };
    if (requestName === '../middleware/permissions' || requestName === '../middleware/validate') {
      return { [requestName.endsWith('permissions') ? 'requirePermission' : 'validate']: () => (req, res, next) => next() };
    }
    if (requestName === '../lib/schemas') return { adminUserPatchSchema: {} };
    return originalLoad.call(this, requestName, parent, isMain);
  };

  try {
    const router = require(resolved);
    const layer = router.stack.find((candidate) => candidate.route?.path === '/:id' && candidate.route.methods.patch);
    assert.ok(layer, 'expected PATCH /:id handler');
    return await fn(layer.route.stack.at(-1).handle);
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolved];
    if (priorRoute) require.cache[resolved] = priorRoute;
    delete require.cache[resolvedService];
    if (priorService) require.cache[resolvedService] = priorService;
  }
}

function createAdvisoryLockPool() {
  let lockHeld = false;
  let releaseWaiter = null;
  let secondLockEntered;
  const secondLockEnteredPromise = new Promise((resolve) => { secondLockEntered = resolve; });
  let lockAttempts = 0;

  function unlock(client) {
    if (client.holdsLock) {
      client.holdsLock = false;
      lockHeld = false;
      releaseWaiter?.();
      releaseWaiter = null;
    }
  }

  return {
    get lockAttempts() { return lockAttempts; },
    secondLockEntered: secondLockEnteredPromise,
    async connect() {
      const client = {
        holdsLock: false,
        async query(sql) {
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            unlock(client);
            return { rows: [] };
          }
          if (sql.startsWith('SELECT pg_advisory_xact_lock')) {
            lockAttempts += 1;
            if (lockHeld) {
              secondLockEntered();
              await new Promise((resolve) => { releaseWaiter = resolve; });
            }
            lockHeld = true;
            client.holdsLock = true;
            return { rows: [] };
          }
          throw new Error(`Unexpected transaction SQL: ${sql}`);
        },
        release() {},
      };
      return client;
    },
  };
}

function makeConcurrentAdminDb(pool, onFirstCount) {
  const users = new Map([
    ['admin-a', { id: 'admin-a', email: 'a@example.com', role_id: 'admin-role', is_active: true }],
    ['admin-b', { id: 'admin-b', email: 'b@example.com', role_id: 'admin-role', is_active: true }],
  ]);
  const roles = new Map([['admin-role', { id: 'admin-role', name: 'admin' }]]);
  let countObserved = false;

  function builder(table) {
    const conditions = new Map();
    let updatePayload = null;
    let selectArgs = [];

    function result() {
      if (table === 'roles') {
        return { data: roles.get(conditions.get('id')) || null, error: null };
      }
      if (table !== 'toolbox_users') throw new Error(`Unexpected table ${table}`);

      const requestedId = conditions.get('id');
      if (updatePayload) {
        const updated = { ...users.get(requestedId), ...updatePayload, role: roles.get(updatePayload.role_id || users.get(requestedId).role_id) };
        users.set(requestedId, updated);
        return { data: updated, error: null };
      }
      if (selectArgs[1]?.head) {
        const count = Array.from(users.values()).filter((user) => (
          user.role_id === conditions.get('role_id') && user.is_active === conditions.get('is_active')
        )).length;
        return { data: null, error: null, count };
      }
      return { data: users.get(requestedId) || null, error: null };
    }

    return {
      select(...args) { selectArgs = args; return this; },
      update(payload) { updatePayload = payload; return this; },
      eq(key, value) { conditions.set(key, value); return this; },
      maybeSingle: async () => result(),
      single: async () => result(),
      then(resolve, reject) {
        return Promise.resolve().then(async () => {
          const value = result();
          if (selectArgs[1]?.head && !countObserved) {
            countObserved = true;
            await onFirstCount();
          }
          return value;
        }).then(resolve, reject);
      },
    };
  }

  return Object.assign(pool, {
    supabase: { from: (table) => builder(table) },
    async bumpRoleVersion() { return { role_version: 1 }; },
    activeAdminCount: () => Array.from(users.values()).filter((user) => user.role_id === 'admin-role' && user.is_active).length,
  });
}

test('last active admin cannot be deactivated or demoted', async () => {
  const existing = { id: 'target-user', email: 'target@example.com', role_id: 'admin-role', is_active: true };

  for (const scenario of [
    { body: { is_active: false }, roles: [{ id: 'admin-role', name: 'admin' }] },
    { body: { role_id: 'employee-role' }, roles: [{ id: 'employee-role', name: 'employee' }, { id: 'admin-role', name: 'admin' }] },
  ]) {
    const supabase = makeSupabase({ existing, roles: scenario.roles, activeAdminCount: 1 });
    const db = { supabase, async bumpRoleVersion() { throw new Error('must not bump role version'); } };

    await withAdminUserRoute(db, async (patch) => {
      const res = response();
      await patch(request(scenario.body), res);
      assert.equal(res.statusCode, 409);
      assert.match(res.body.details, /last active admin/i);
    });

    assert.equal(supabase.calls.some((call) => call.method === 'update'), false);
  }
});

test('a non-last active admin can be deactivated or demoted', async () => {
  const existing = { id: 'target-user', email: 'target@example.com', role_id: 'admin-role', is_active: true };

  for (const scenario of [
    { body: { is_active: false }, roles: [{ id: 'admin-role', name: 'admin' }], updated: { ...existing, is_active: false, role: null } },
    { body: { role_id: 'employee-role' }, roles: [{ id: 'employee-role', name: 'employee' }, { id: 'admin-role', name: 'admin' }], updated: { ...existing, role_id: 'employee-role', role_version: 1, role: null } },
  ]) {
    const supabase = makeSupabase({ existing, roles: scenario.roles, activeAdminCount: 2, updated: scenario.updated });
    const db = { supabase, async bumpRoleVersion() { return { role_version: 2 }; } };

    await withAdminUserRoute(db, async (patch) => {
      const res = response();
      await patch(request(scenario.body), res);
      assert.equal(res.statusCode, 200);
    });

    assert.equal(supabase.calls.some((call) => call.method === 'update'), true);
  }
});

test('serialized admin mutation lock prevents two concurrent deactivations from removing every admin', async () => {
  const pool = createAdvisoryLockPool();
  let startSecond;
  const db = makeConcurrentAdminDb(pool, async () => {
    startSecond();
    await pool.secondLockEntered;
  });

  await withAdminUserRoute(db, async (patch) => {
    let secondMutation;
    const secondResponse = response();
    startSecond = () => {
      secondMutation = patch(request({ is_active: false }, 'admin-b'), secondResponse);
    };

    const firstResponse = response();
    await patch(request({ is_active: false }, 'admin-a'), firstResponse);
    await secondMutation;

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 409);
    assert.equal(db.activeAdminCount(), 1);
    assert.equal(pool.lockAttempts, 2);
  });
});

test('migration classifier blocks destructive SQL while preserving paired constraint replacements', () => {
  const destructiveStatements = [
    'DROP TABLE invoices',
    'DROP INDEX idx_documents_status',
    'DROP VIEW invoice_summary',
    'ALTER TABLE invoices DROP COLUMN vendor_code',
    'ALTER TABLE invoices ALTER COLUMN amount DROP DEFAULT',
    'ALTER TABLE invoices ALTER COLUMN amount DROP NOT NULL',
    'TRUNCATE TABLE invoices',
    'DELETE FROM invoices',
    'ALTER TABLE invoices RENAME TO archived_invoices',
    'ALTER TABLE invoices ALTER COLUMN amount TYPE numeric(12, 2)',
    'ALTER TABLE invoices DROP CONSTRAINT invoices_vendor_fkey',
    'DROP/* deliberate comment */TABLE invoices',
  ];

  for (const sql of destructiveStatements) {
    const result = classifyMigrationSql(sql);
    assert.equal(result.classification, 'mark-applied', sql);
    assert.equal(result.safeToApplyPending, false, sql);
  }

  const pairedConstraintReplacement = classifyMigrationSql(`
    ALTER TABLE invoices DROP CONSTRAINT invoices_vendor_fkey;
    ALTER TABLE invoices ADD CONSTRAINT invoices_vendor_fkey FOREIGN KEY (vendor_code) REFERENCES vendors(code) ON DELETE CASCADE;
  `);
  assert.equal(pairedConstraintReplacement.classification, 'safe-rerun');

  const mismatchedConstraintReplacement = classifyMigrationSql(`
    ALTER TABLE invoices DROP CONSTRAINT invoices_vendor_fkey;
    ALTER TABLE invoices ADD CONSTRAINT another_vendor_fkey FOREIGN KEY (vendor_code) REFERENCES vendors(code) ON DELETE CASCADE;
  `);
  assert.equal(mismatchedConstraintReplacement.classification, 'mark-applied');
});

test('migration classifier handles nested PostgreSQL comments and destructive constraint cascades conservatively', () => {
  const nestedCommentStatements = [
    'DROP/* outer /* inner */ still outer */TABLE invoices',
    'ALTER TABLE invoices DROP/* outer /* inner */ still outer */COLUMN vendor_code',
    'DELETE/* outer /* inner */ still outer */FROM invoices',
    'ALTER TABLE invoices ALTER/* outer /* inner */ still outer */COLUMN amount TYPE numeric(12, 2)',
    'ALTER TABLE invoices DROP/* outer /* inner */ still outer */CONSTRAINT invoices_vendor_fkey',
  ];

  for (const sql of nestedCommentStatements) {
    assert.equal(classifyMigrationSql(sql).classification, 'mark-applied', sql);
  }

  const cascadeReplacement = classifyMigrationSql(`
    ALTER TABLE invoices DROP CONSTRAINT invoices_vendor_fkey CASCADE;
    ALTER TABLE invoices ADD CONSTRAINT invoices_vendor_fkey FOREIGN KEY (vendor_code) REFERENCES vendors(code) ON DELETE CASCADE;
  `);
  assert.equal(cascadeReplacement.classification, 'mark-applied');
  assert.ok(cascadeReplacement.reasons.includes('drops a constraint with CASCADE'));

  const unclosedComment = classifyMigrationSql('CREATE TABLE IF NOT EXISTS invoices (id UUID); /* unclosed');
  assert.equal(unclosedComment.classification, 'mark-applied');
  assert.ok(unclosedComment.reasons.includes('contains an unclosed block comment'));

  const commentAndStringOnly = classifyMigrationSql(`
    -- DROP TABLE invoices
    CREATE TABLE IF NOT EXISTS notes (message TEXT DEFAULT 'DELETE FROM invoices');
  `);
  assert.equal(commentAndStringOnly.classification, 'safe-rerun');
});

test('token-aware migration classifier fails closed on quoted identifiers while preserving literal isolation', () => {
  const quotedPair = classifyMigrationSql(`
    ALTER TABLE invoices DROP CONSTRAINT "Vendor FK";
    ALTER TABLE invoices ADD CONSTRAINT "Vendor FK" FOREIGN KEY (vendor_code) REFERENCES vendors(code);
  `);
  assert.equal(quotedPair.classification, 'mark-applied');

  const quotedMismatch = classifyMigrationSql(`
    ALTER TABLE invoices DROP CONSTRAINT "Vendor FK";
    ALTER TABLE invoices ADD CONSTRAINT "vendor fk" FOREIGN KEY (vendor_code) REFERENCES vendors(code);
  `);
  assert.equal(quotedMismatch.classification, 'mark-applied');

  const quotedSchemaQualifiedPair = classifyMigrationSql(`
    ALTER TABLE "Billing"."Invoice""Queue" DROP CONSTRAINT "Vendor""FK";
    ALTER TABLE "Billing"."Invoice""Queue" ADD CONSTRAINT "Vendor""FK" FOREIGN KEY (vendor_code) REFERENCES vendors(code);
  `);
  assert.equal(quotedSchemaQualifiedPair.classification, 'mark-applied');

  const crossTableConstraintNameReuse = classifyMigrationSql(`
    ALTER TABLE invoice_queue DROP CONSTRAINT vendor_fkey;
    ALTER TABLE payment_queue ADD CONSTRAINT vendor_fkey FOREIGN KEY (vendor_code) REFERENCES vendors(code);
  `);
  assert.equal(crossTableConstraintNameReuse.classification, 'mark-applied');

  const crossSchemaConstraintNameReuse = classifyMigrationSql(`
    ALTER TABLE accounting.invoice_queue DROP CONSTRAINT vendor_fkey;
    ALTER TABLE archive.invoice_queue ADD CONSTRAINT vendor_fkey FOREIGN KEY (vendor_code) REFERENCES vendors(code);
  `);
  assert.equal(crossSchemaConstraintNameReuse.classification, 'mark-applied');

  const quotedNames = classifyMigrationSql(`
    CREATE TABLE IF NOT EXISTS "DROP TABLE" ("DELETE FROM" TEXT);
    CREATE INDEX IF NOT EXISTS "RENAME INDEX" ON "DROP TABLE" ("DELETE FROM");
  `);
  assert.equal(quotedNames.classification, 'mark-applied');

  const stringLiteralOnly = classifyMigrationSql(`
    CREATE TABLE IF NOT EXISTS notes (message TEXT DEFAULT 'DROP TABLE invoices');
  `);
  assert.equal(stringLiteralOnly.classification, 'safe-rerun');

  const dollarLiteralInUnapprovedInsert = classifyMigrationSql(`
    INSERT INTO notes (message) VALUES ($safety$DELETE FROM invoices$safety$) ON CONFLICT DO NOTHING;
  `);
  assert.equal(dollarLiteralInUnapprovedInsert.classification, 'mark-applied');

  const malformedDollarQuote = classifyMigrationSql('DO $broken$ DELETE FROM invoices;');
  assert.equal(malformedDollarQuote.classification, 'mark-applied');
  assert.ok(malformedDollarQuote.reasons.includes('contains an unclosed dollar-quoted literal'));

  const mixedInserts = classifyMigrationSql(`
    INSERT INTO permissions (key) VALUES ('safe') ON CONFLICT (key) DO NOTHING;
    INSERT INTO role_permissions (role_id) VALUES ('unsafe');
  `);
  assert.equal(mixedInserts.classification, 'mark-applied');
  assert.ok(mixedInserts.reasons.includes('contains a statement outside the approved migration allowlist'));
});

test('migration classifier permits only the two structurally exact guarded UPDATE forms', () => {
  const approvedNamespaceRewrite = classifyMigrationSql(`
    UPDATE role_permissions
    SET permission_key = 'accounting.' || permission_key
    WHERE permission_key LIKE 'invoices.%'
      AND permission_key NOT LIKE 'accounting.%';
  `);
  assert.equal(approvedNamespaceRewrite.classification, 'safe-rerun');

  const approvedGrandfatherBackfill = classifyMigrationSql(`
    UPDATE documents
    SET waiver_on_document = true,
        waiver_on_document_at = NOW(),
        waiver_on_document_by = 'grandfathered-pre-gate-2026-07-14',
        updated_at = NOW()
    WHERE classification IN ('invoice', 'pay-application')
      AND status = 'approved'
      AND lien_waiver_required = true
      AND linked_lien_waiver_id IS NULL
      AND waiver_on_document IS NOT TRUE;
  `);
  assert.equal(approvedGrandfatherBackfill.classification, 'safe-rerun');

  for (const sql of [
    'UPDATE documents SET x = y',
    `UPDATE role_permissions
     SET permission_key = 'accounting.' || permission_key
     WHERE permission_key LIKE 'invoices.%';`,
    `UPDATE documents
     SET waiver_on_document = true,
         waiver_on_document_at = NOW(),
         waiver_on_document_by = 'grandfathered-pre-gate-2026-07-14',
         updated_at = NOW()
     WHERE classification IN ('invoice', 'pay-application')
       AND status = 'pending'
       AND lien_waiver_required = true
       AND linked_lien_waiver_id IS NULL
       AND waiver_on_document IS NOT TRUE;`,
    `UPDATE documents
     SET waiver_on_document = true,
         waiver_on_document_at = NOW(),
         waiver_on_document_by = 'grandfathered-pre-gate-2026-07-14',
         updated_at = NOW()
     WHERE classification IN ('invoice', 'pay-application')
       AND status = 'approved'
       AND lien_waiver_required = true
       AND linked_lien_waiver_id IS NULL;`,
  ]) {
    const result = classifyMigrationSql(sql);
    assert.equal(result.classification, 'mark-applied', sql);
    assert.equal(result.safeToApplyPending, false, sql);
  }
});

test('migration classifier preserves ordinary string backslashes and rejects escape-string syntax', () => {
  const ordinaryBackslashLiteral = classifyMigrationSql(
    String.raw`CREATE TABLE IF NOT EXISTS notes (message TEXT DEFAULT 'literal\value')`,
  );
  assert.equal(ordinaryBackslashLiteral.classification, 'safe-rerun');

  for (const sql of [
    `UPDATE role_permissions
     SET permission_key = 'accounting\\.' || permission_key
     WHERE permission_key LIKE 'invoices.%'
       AND permission_key NOT LIKE 'accounting.%'`,
    `INSERT INTO permissions (key, module, description, created_at)
     VALUES ('invoices\\.manage_rules', 'invoices', 'Manage and apply invoice automation rules', NOW())
     ON CONFLICT (key) DO UPDATE
     SET module = EXCLUDED.module, description = EXCLUDED.description`,
    `UPDATE documents
     SET waiver_on_document = true,
         waiver_on_document_at = NOW(),
         waiver_on_document_by = 'grandfathered\\-pre-gate-2026-07-14',
         updated_at = NOW()
     WHERE classification IN ('invoice', 'pay-application')
       AND status = 'approved'
       AND lien_waiver_required = true
       AND linked_lien_waiver_id IS NULL
       AND waiver_on_document IS NOT TRUE`,
  ]) {
    const result = classifyMigrationSql(sql);
    assert.equal(result.classification, 'mark-applied', sql);
    assert.equal(result.safeToApplyPending, false, sql);
  }

  const escaped = classifyMigrationSql("CREATE TABLE IF NOT EXISTS notes (message TEXT DEFAULT E'escaped')");
  assert.equal(escaped.classification, 'mark-applied');
  assert.ok(escaped.reasons.includes('contains an unsupported escape string literal'));

  const unicodeEscaped = classifyMigrationSql("CREATE TABLE IF NOT EXISTS notes (message TEXT DEFAULT U&'escaped')");
  assert.equal(unicodeEscaped.classification, 'mark-applied');
  assert.ok(unicodeEscaped.reasons.includes('contains an unsupported Unicode escape string literal'));
});

test('migration classifier rejects executable expressions in INSERT values, select, where, and cross joins', () => {
  for (const sql of [
    `INSERT INTO permissions (key)
     VALUES (pg_terminate_backend(pg_backend_pid()))
     ON CONFLICT (key) DO NOTHING`,
    `INSERT INTO permissions (key)
     VALUES (dblink_exec('host=untrusted', 'DROP TABLE documents'))
     ON CONFLICT (key) DO NOTHING`,
    `INSERT INTO permissions (key, module, description, created_at)
     VALUES (custom_permission_key(), 'invoices', 'UDF value bypass', NOW())
     ON CONFLICT (key) DO UPDATE
     SET module = EXCLUDED.module, description = EXCLUDED.description`,
    `INSERT INTO role_permissions (role_id, permission_key, granted)
     SELECT custom_role_id(), 'invoices.manage_rules', TRUE
     FROM roles
     WHERE roles.name = 'admin'
     ON CONFLICT (role_id, permission_key) DO UPDATE
     SET granted = EXCLUDED.granted`,
    `INSERT INTO role_permissions (role_id, permission_key, granted)
     SELECT roles.id, 'invoices.manage_rules', TRUE
     FROM roles
     WHERE custom_role_filter(roles.name)
     ON CONFLICT (role_id, permission_key) DO UPDATE
     SET granted = EXCLUDED.granted`,
    `INSERT INTO role_permissions (role_id, permission_key, granted)
     SELECT roles.id, permission_keys.permission_key, TRUE
     FROM roles
     CROSS JOIN (VALUES (custom_permission_key())) AS permission_keys(permission_key)
     WHERE roles.name = 'admin'
     ON CONFLICT (role_id, permission_key) DO UPDATE
     SET granted = EXCLUDED.granted`,
  ]) {
    const result = classifyMigrationSql(sql);
    assert.equal(result.classification, 'mark-applied', sql);
    assert.equal(result.safeToApplyPending, false, sql);
  }
});

test('migration classifier fails closed for malformed and unapproved top-level grammar', () => {
  for (const sql of [
    'ALTER TABLE documents ALTER COLUMN status SET DEFAULT true',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_status ON documents(status)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_status ON documents(status)',
    'UPDATE documents SET x = y WHERE id = 1',
    'SELECT * FROM documents',
    'CREATE TABLE IF NOT EXISTS malformed (id TEXT',
    'ALTER TABLE documents ADD COLUMN IF NOT EXISTS malformed INTEGER DEFAULT 1.2.3',
    'CREATE TABLE IF NOT EXISTS migration$probe (id TEXT)',
  ]) {
    const result = classifyMigrationSql(sql);
    assert.equal(result.classification, 'mark-applied', sql);
    assert.equal(result.safeToApplyPending, false, sql);
  }
});

test('migration classifier fails closed on executable procedural SQL and malformed destructive clauses', () => {
  for (const sql of [
    "DO $$ BEGIN EXECUTE 'DROP TABLE invoices'; END $$;",
    "DO $$ BEGIN EXECUTE 'DELETE FROM invoices'; END $$;",
    "CREATE OR REPLACE FUNCTION destructive() RETURNS void AS $$ BEGIN EXECUTE 'DROP TABLE invoices'; END $$ LANGUAGE plpgsql;",
  ]) {
    const result = classifyMigrationSql(sql);
    assert.equal(result.classification, 'mark-applied', sql);
    assert.ok(result.reasons.includes('contains an executable procedural SQL body requiring independent review'));
  }

  const malformedConstraint = classifyMigrationSql(`
    ALTER TABLE invoices DROP CONSTRAINT invoices_vendor_fkey nonsense;
    ALTER TABLE invoices ADD CONSTRAINT invoices_vendor_fkey FOREIGN KEY (vendor_code) REFERENCES vendors(code) ON DELETE CASCADE;
  `);
  assert.equal(malformedConstraint.classification, 'mark-applied');
  assert.ok(malformedConstraint.reasons.includes('has a malformed dropped constraint clause'));
});

test('safeEqual HMACs inputs and invokes crypto.timingSafeEqual on fixed-length digests', () => {
  const hmacCalls = [];
  const timingCalls = [];
  const cryptoSpy = {
    ...crypto,
    createHmac(...args) {
      hmacCalls.push(args);
      return crypto.createHmac(...args);
    },
    timingSafeEqual(left, right) {
      timingCalls.push([left, right]);
      return crypto.timingSafeEqual(left, right);
    },
  };
  const safeEqualWithSpy = loadSafeEqual(cryptoSpy);

  assert.equal(safeEqualWithSpy('secret-value', 'secret-value'), true);
  assert.equal(safeEqualWithSpy('secret-value', 'secret-other'), false);
  assert.equal(safeEqualWithSpy('secret-value', 'x'), false);
  assert.equal(safeEqualWithSpy('secret-value', null), false);
  assert.equal(hmacCalls.length, 6);
  assert.equal(timingCalls.length, 3);
  for (const [left, right] of timingCalls) {
    assert.equal(left.length, 32);
    assert.equal(right.length, 32);
  }
});
