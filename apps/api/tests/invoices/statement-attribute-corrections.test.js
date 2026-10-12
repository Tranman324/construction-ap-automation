'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const { applyManualStatementAttributePatch } = require('../../modules/invoices/services/statementAttributes');
const { statementAttributePatchSchema } = require('../../lib/schemas');

const root = path.resolve(__dirname, '..', '..');

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return await fn(); } finally { Module._load = originalLoad; }
}

function freshRequire(relativePath) {
  const resolved = require.resolve(path.join(root, relativePath));
  delete require.cache[resolved];
  return require(resolved);
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeTransactionalPool(initialRow) {
  let row = initialRow;
  const calls = [];
  const pool = {
    async connect() {
      return {
        async query(sql, params = []) {
          calls.push({ sql, params });
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
          if (/SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [row] };
          if (/UPDATE documents SET statement_attributes/.test(sql)) {
            row = { ...row, statement_attributes: params[1] };
            return { rows: [row] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {},
      };
    },
  };
  return { pool, calls, get row() { return row; } };
}

function makeLockedPool(initialRow) {
  let row = initialRow;
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      let releaseLock = null;
      return {
        async query(sql, params = []) {
          if (sql === 'BEGIN') return { rows: [] };
          if (/SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) {
            const previous = tail;
            tail = new Promise((resolve) => { releaseLock = resolve; });
            await previous;
            return { rows: [row] };
          }
          if (/UPDATE documents SET statement_attributes/.test(sql)) {
            row = { ...row, statement_attributes: params[1] };
            return { rows: [row] };
          }
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            releaseLock?.();
            return { rows: [] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {},
      };
    },
  };
  return { pool, get row() { return row; } };
}

test('statement attribute correction applies manual values without replacing other sources', () => {
  assert.equal(typeof applyManualStatementAttributePatch, 'function');
  const next = applyManualStatementAttributePatch({
    extracted: { statementPeriod: 'July 2026', balance: 33.25 },
    computed: { balance: 30 },
  }, { balance: 44.5 }, { name: 'reviewer@example.com' }, '2026-07-31T00:00:00.000Z');
  assert.equal(next.manual.balance.value, 44.5);
  assert.equal(next.manual.balance.setBy, 'reviewer@example.com');
  assert.equal(next.extracted.statementPeriod, 'July 2026');
  assert.equal(next.computed.balance, 30);
});

test('statement attribute patch schema rejects empty, non-finite, and unknown input', () => {
  assert.equal(statementAttributePatchSchema.safeParse({}).success, false);
  assert.equal(statementAttributePatchSchema.safeParse({ balance: 'Infinity' }).success, false);
  assert.equal(statementAttributePatchSchema.safeParse({ balance: '' }).success, false);
  assert.equal(statementAttributePatchSchema.safeParse({ statementPeriod: '   ' }).success, false);
  assert.equal(statementAttributePatchSchema.safeParse({ balance: 44, extra: true }).success, false);
  assert.deepEqual(statementAttributePatchSchema.parse({ statementPeriod: null, balance: '44.5' }), {
    statementPeriod: null,
    balance: 44.5,
  });
});

test('statement attribute patch locks, replaces one JSONB object, audits the revealed clear state, and never changes amount', async () => {
  const database = makeTransactionalPool({
    id: 'statement-1', classification: 'statement', amount: 999,
    statement_attributes: {
      manual: { balance: { value: 88, setBy: 'prior', setAt: '2026-07-01T00:00:00.000Z' } },
      extracted: { statementPeriod: 'July 2026', balance: 33.25 },
    },
  });
  const audits = [];
  const req = { params: { id: 'statement-1' }, body: { balance: null, statementPeriod: 'August 2026' }, user: { userId: 'user-1', email: 'reviewer@example.com', role: 'approver' } };
  const res = makeResponse();

  await withMockedModules({
    './supabase': { pool: database.pool, rowToDoc: (row) => ({ id: row.id, amount: row.amount, statementAttributes: row.statement_attributes }) },
    '../../../lib/auditEvents': {
      getRequestAuditActor: () => ({ userId: 'user-1', name: 'reviewer@example.com', role: 'approver' }),
      emitInvoiceAuditEvent: async (_req, _res, event) => audits.push(event),
    },
    '../../../middleware/errorResponse': { safeError: (response, error) => response.status(500).json({ error: error.message }) },
  }, async () => {
    const { updateStatementAttributes } = freshRequire('modules/invoices/services/statementAttributeService.js');
    await updateStatementAttributes(req, res);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice.amount, 999);
  assert.deepEqual(res.body.invoice.statementAttributes.manual, {
    statementPeriod: { value: 'August 2026', setBy: 'reviewer@example.com', setAt: res.body.invoice.statementAttributes.manual.statementPeriod.setAt },
  });
  assert.deepEqual(audits[0].beforeState.statementAttributes.resolved.balance, { value: 88, source: 'manual' });
  assert.deepEqual(audits[0].afterState.statementAttributes.resolved.balance, { value: 33.25, source: 'extracted' });
  assert.deepEqual(database.calls.map((entry) => entry.sql), [
    'BEGIN',
    'SELECT * FROM documents WHERE id = $1 FOR UPDATE',
    'UPDATE documents SET statement_attributes = $2 WHERE id = $1 RETURNING *',
    'COMMIT',
  ]);
  assert.equal(database.calls.some((entry) => /amount\s*=/.test(entry.sql)), false);
  assert.equal(audits[0].client !== database.pool, true, 'audit must enlist in the transaction client');
});

test('statement attribute mutation returns the canonical reconcile envelope for the caller permission', async () => {
  const database = makeTransactionalPool({
    id: 'statement-reconcile-envelope', classification: 'statement',
    statement_lines: [{ id: 'open', status: 'not_received' }],
    statement_attributes: { extracted: { balance: 33.25 } },
  });
  const res = makeResponse();
  let serializationOptions = null;
  await withMockedModules({
    './supabase': {
      pool: database.pool,
      rowToDoc: (row, options) => {
        serializationOptions = options;
        return { id: row.id, reconcile: { canReconcile: options.canReconcile, blockers: [{ code: 'STATEMENT_LINE_UNRESOLVED' }] } };
      },
    },
    '../../../middleware/permissions': { checkPermission: (_req, key) => key === 'accounting.invoices.approve' },
    '../../../lib/auditEvents': { getRequestAuditActor: () => ({ name: 'reviewer@example.com' }), emitInvoiceAuditEvent: async () => null },
    '../../../middleware/errorResponse': { safeError: (response, error) => response.status(500).json({ error: error.message }) },
  }, async () => {
    const { updateStatementAttributes } = freshRequire('modules/invoices/services/statementAttributeService.js');
    await updateStatementAttributes({ params: { id: 'statement-reconcile-envelope' }, body: { balance: 44 }, user: {} }, res);
  });
  assert.deepEqual(serializationOptions, { includeStatementReconcile: true, canReconcile: true });
  assert.deepEqual(res.body.invoice.reconcile, { canReconcile: true, blockers: [{ code: 'STATEMENT_LINE_UNRESOLVED' }] });
});

test('sole manual-slot clear removes manual from the persisted replacement and audit reveals its fallback', async () => {
  const database = makeTransactionalPool({
    id: 'statement-sole-clear', classification: 'statement',
    statement_attributes: {
      manual: { balance: { value: 88, setBy: 'prior', setAt: '2026-07-01T00:00:00.000Z' } },
      extracted: { balance: 33.25 },
      computed: { balance: 30 },
    },
  });
  const audits = [];
  await withMockedModules({
    './supabase': { pool: database.pool, rowToDoc: (row) => ({ id: row.id, statementAttributes: row.statement_attributes }) },
    '../../../lib/auditEvents': {
      getRequestAuditActor: () => ({ name: 'reviewer@example.com' }),
      emitInvoiceAuditEvent: async (_req, _res, event) => audits.push(event),
    },
    '../../../middleware/errorResponse': { safeError: (response, error) => response.status(500).json({ error: error.message }) },
  }, async () => {
    const { updateStatementAttributes } = freshRequire('modules/invoices/services/statementAttributeService.js');
    await updateStatementAttributes({ params: { id: 'statement-sole-clear' }, body: { balance: null }, user: {} }, makeResponse());
  });

  assert.equal(database.row.statement_attributes.manual, undefined);
  assert.deepEqual(audits[0].beforeState.statementAttributes.manual, {
    balance: { value: 88, setBy: 'prior', setAt: '2026-07-01T00:00:00.000Z' },
  });
  assert.deepEqual(audits[0].afterState.statementAttributes.manual, {});
  assert.deepEqual(audits[0].afterState.statementAttributes.resolved.balance, { value: 33.25, source: 'extracted' });
});

test('statement attribute audit failures roll back the JSONB mutation', async () => {
  const database = makeTransactionalPool({ id: 'statement-rollback', classification: 'statement', statement_attributes: { extracted: { balance: 33.25 } } });
  const req = { params: { id: 'statement-rollback' }, body: { balance: 44 }, user: { email: 'reviewer@example.com' } };
  const res = makeResponse();
  await withMockedModules({
    './supabase': { pool: database.pool, rowToDoc: (row) => row },
    '../../../lib/auditEvents': { getRequestAuditActor: () => ({ name: 'reviewer@example.com' }), emitInvoiceAuditEvent: async () => { throw new Error('audit unavailable'); } },
    '../../../middleware/errorResponse': { safeError: (response, error) => response.status(500).json({ error: error.message }) },
  }, async () => {
    const { updateStatementAttributes } = freshRequire('modules/invoices/services/statementAttributeService.js');
    await updateStatementAttributes(req, res);
  });
  assert.equal(res.statusCode, 500);
  assert.equal(database.calls.at(-1).sql, 'ROLLBACK');
});

test('concurrent statement attribute patches retain both fields from their locked latest rows', async () => {
  const database = makeLockedPool({ id: 'statement-concurrent', classification: 'statement', statement_attributes: { extracted: { statementPeriod: 'July 2026', balance: 33.25 } } });
  const auditEvents = { getRequestAuditActor: () => ({ name: 'reviewer@example.com' }), emitInvoiceAuditEvent: async () => null };
  await withMockedModules({
    './supabase': { pool: database.pool, rowToDoc: (row) => ({ id: row.id, statementAttributes: row.statement_attributes }) },
    '../../../lib/auditEvents': auditEvents,
    '../../../middleware/errorResponse': { safeError: (response, error) => response.status(500).json({ error: error.message }) },
  }, async () => {
    const { updateStatementAttributes } = freshRequire('modules/invoices/services/statementAttributeService.js');
    await Promise.all([
      updateStatementAttributes({ params: { id: 'statement-concurrent' }, body: { balance: 44 }, user: {} }, makeResponse()),
      updateStatementAttributes({ params: { id: 'statement-concurrent' }, body: { statementPeriod: 'August 2026' }, user: {} }, makeResponse()),
    ]);
  });
  assert.equal(database.row.statement_attributes.manual.balance.value, 44);
  assert.equal(database.row.statement_attributes.manual.statementPeriod.value, 'August 2026');
});

test('route pins approve permission before the 422 schema gate and service handler', () => {
  const source = fs.readFileSync(path.join(root, 'modules/invoices/routes/invoices.js'), 'utf8');
  assert.match(source, /router\.patch\('\/:id\/statement-attributes',\s*requirePermission\('accounting\.invoices\.approve'\),\s*validate\(statementAttributePatchSchema, 'body', 422\),\s*async \(req, res\) => \{\s*return updateStatementAttributes\(req, res\);/s);
});
