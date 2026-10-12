'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function freshRequire(relativePath) {
  const resolved = require.resolve(path.join(root, relativePath));
  delete require.cache[resolved];
  return require(resolved);
}

function makePool(row, calls) {
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
    if (/SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [row] };
    if (/UPDATE documents/.test(sql)) {
      row.status = 'pending';
      row.approved_at = null;
      row.approved_by = null;
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row] };
    throw new Error(`unexpected query: ${sql}`);
  }

  return {
    query,
    async connect() { return { query, release() {} }; },
  };
}

test('unapprove source locks the document inside a transaction', () => {
  const source = fs.readFileSync(
    path.join(root, 'modules/invoices/services/invoiceApprovalService.js'),
    'utf8'
  );
  const functionSource = source.slice(source.indexOf('async function unapproveInvoice'));
  assert.match(functionSource, /withTransaction\(pool, async \(db\) =>/);
  assert.match(functionSource, /SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/);
  assert.match(functionSource, /await db\.query\(\s*`UPDATE documents/);
  assert.match(functionSource, /await db\.query\('SELECT \* FROM documents WHERE id = \$1'/);
});

test('unapprove status guard evaluates the locked row before mutation', async () => {
  const row = { id: 'doc-1', status: 'submitted' };
  const calls = [];
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool: makePool(row, calls), audit: async () => {}, rowToDoc: (value) => value },
    '../../../lib/auditEvents': {
      checkStateMatch: () => ({ match: true }),
      emitInvoiceAuditEvent: async () => ({ id: 'event-1' }),
      findUndoableAction: async () => null,
      getRequestAuditActor: () => ({ name: 'reviewer@example.com' }),
      markActionUndone: async () => {},
    },
    '../../../middleware/errorResponse': {
      fail: (response, status, message) => response.status(status).json({ error: message }),
      safeError: (response) => response.status(500).json({ error: 'unexpected' }),
    },
    './transaction': require(path.join(root, 'modules/invoices/services/transaction.js')),
    './approvalValidator': {},
    './approvalStateService': {},
    './pdfMergeService': {},
    './waiverLinkedStatusService': {},
  }, async () => {
    const { unapproveInvoice } = freshRequire('modules/invoices/services/invoiceApprovalService.js');
    await unapproveInvoice({ params: { id: row.id }, user: { email: 'reviewer@example.com' } }, res);
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /status "submitted"/);
  assert.match(calls[1].sql, /FOR UPDATE/);
  assert.equal(calls.some((call) => /UPDATE documents/.test(call.sql)), false);
});

test('unapprove happy path commits the mutation before auditing and returns { invoice, action }', async () => {
  const row = {
    id: 'doc-1',
    status: 'approved',
    approved_at: '2026-09-22T00:00:00.000Z',
    approved_by: 'approver',
  };
  const calls = [];
  const auditCalls = [];
  const auditEventCalls = [];
  const markUndoneCalls = [];
  const res = makeRes();

  await withMockedModules({
    './supabase': {
      pool: makePool(row, calls),
      audit: async (...args) => {
        auditCalls.push(args);
        calls.push({ sql: 'AUDIT' });
      },
      rowToDoc: (value) => value,
    },
    '../../../lib/auditEvents': {
      checkStateMatch: () => ({ match: true }),
      emitInvoiceAuditEvent: async (...args) => {
        auditEventCalls.push(args);
        return { id: 'event-1' };
      },
      findUndoableAction: async () => null,
      getRequestAuditActor: () => ({ name: 'reviewer@example.com' }),
      markActionUndone: async (...args) => { markUndoneCalls.push(args); },
    },
    '../../../middleware/errorResponse': {
      fail: (response, status, message) => response.status(status).json({ error: message }),
      safeError: (response) => response.status(500).json({ error: 'unexpected' }),
    },
    './transaction': require(path.join(root, 'modules/invoices/services/transaction.js')),
    './approvalValidator': {},
    './approvalStateService': {},
    './pdfMergeService': {},
    './waiverLinkedStatusService': {},
  }, async () => {
    const { unapproveInvoice } = freshRequire('modules/invoices/services/invoiceApprovalService.js');
    await unapproveInvoice({ params: { id: row.id }, user: { email: 'reviewer@example.com' } }, res);
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['action', 'invoice']);
  assert.equal(res.body.invoice.status, 'pending');

  const sqls = calls.map((call) => call.sql);
  assert.equal(sqls[0], 'BEGIN');
  assert.match(sqls[1], /SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/);
  assert.match(sqls[2], /UPDATE documents/);
  assert.equal(sqls[3], 'SELECT * FROM documents WHERE id = $1');
  assert.equal(sqls[4], 'COMMIT');
  assert.ok(sqls.indexOf('AUDIT') > sqls.indexOf('COMMIT'), 'audit must run after COMMIT');

  assert.equal(auditCalls.length, 1);
  assert.equal(auditEventCalls.length, 1);
  assert.equal(markUndoneCalls.length, 0);
});
