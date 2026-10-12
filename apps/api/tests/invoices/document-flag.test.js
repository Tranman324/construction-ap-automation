'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const { assertCanonicalErrorBody } = require('../helpers/assertCanonicalErrorResponse');

const root = path.resolve(__dirname, '..', '..');

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

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) {
      if (this.statusCode >= 400) assertCanonicalErrorBody(body);
      this.body = body;
      return this;
    },
  };
}

// Derives the audit actor from the request, matching the real
// getRequestAuditActor, so the service's flagger comparison uses req.user.email.
function auditEventsMock(captured) {
  return {
    getRequestAuditActor: (req, res) => ({
      name: req?.user?.email || res?.locals?.userEmail || 'system',
      userId: req?.user?.userId || req?.user?.email || 'system',
      role: req?.user?.role || null,
    }),
    emitInvoiceAuditEvent: async (req, res, options) => {
      captured.push(options);
      return { id: 'event-1' };
    },
  };
}

const errorResponseMock = require('../../middleware/errorResponse');

// Stateful fake pool for flag/unflag: FOR UPDATE returns the row, the flag/unflag
// UPDATE mutates the row in place so the re-read reflects the new state.
function makeFlagPool(row, calls) {
  return {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FOR UPDATE/.test(sql)) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      if (/UPDATE documents/.test(sql) && /flagged_at = NOW\(\)/.test(sql)) {
        row.flagged_at = new Date('2026-07-17T12:00:00Z');
        row.flagged_by = params[0];
        row.flag_reason = params[1];
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE documents/.test(sql) && /flagged_at = NULL/.test(sql)) {
        row.flagged_at = null;
        row.flagged_by = null;
        row.flag_reason = null;
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
}

function baseRow(overrides = {}) {
  return {
    id: 'doc-1',
    status: 'pending',
    classification: 'invoice',
    file_name: 'invoice.pdf',
    flagged_at: null,
    flagged_by: null,
    flag_reason: null,
    ...overrides,
  };
}

async function runFlag(row, req, captured) {
  const calls = [];
  const res = makeRes();
  const pool = makeFlagPool(row, calls);
  await withMockedModules({
    './supabase': { pool, audit: async () => {}, rowToDoc: (value) => value },
    '../../../lib/auditEvents': auditEventsMock(captured),
    '../../../middleware/errorResponse': errorResponseMock,
  }, async () => {
    const { flagDocument } = freshRequire('modules/invoices/services/documentFlagService.js');
    await flagDocument(req, res);
  });
  return { calls, res };
}

async function runUnflag(row, req, captured) {
  const calls = [];
  const res = makeRes();
  const pool = makeFlagPool(row, calls);
  await withMockedModules({
    './supabase': { pool, audit: async () => {}, rowToDoc: (value) => value },
    '../../../lib/auditEvents': auditEventsMock(captured),
    '../../../middleware/errorResponse': errorResponseMock,
    // The real permission middleware is used so the service-level unflag policy
    // (original flagger OR accounting.invoices.manage_rules) is exercised.
    '../../../middleware/permissions': require('../../middleware/permissions'),
  }, async () => {
    const { unflagDocument } = freshRequire('modules/invoices/services/documentFlagService.js');
    await unflagDocument(req, res);
  });
  return { calls, res };
}

// 1. flag persists actor + timestamp + reason and emits invoice.flagged.
test('flag persists actor, timestamp, and reason and emits invoice.flagged with before/after state', async () => {
  const row = baseRow();
  const captured = [];
  const { calls, res } = await runFlag(
    row,
    { params: { id: 'doc-1' }, body: { reason: 'Needs Dana review' }, user: { email: 'clerk@example.com' } },
    captured,
  );

  assert.equal(res.statusCode, 200);
  const update = calls.find((c) => /UPDATE documents/.test(c.sql) && /flagged_at = NOW\(\)/.test(c.sql));
  assert.ok(update, 'flag UPDATE ran');
  assert.deepEqual(update.params, ['clerk@example.com', 'Needs Dana review', 'doc-1']);
  // Workflow-neutral write: the flag UPDATE must not touch status.
  assert.doesNotMatch(update.sql, /\bstatus\b/);
  assert.equal(row.flagged_by, 'clerk@example.com');
  assert.ok(row.flagged_at);

  assert.equal(captured.length, 1);
  assert.equal(captured[0].type, 'invoice.flagged');
  assert.equal(captured[0].undoable, true);
  assert.equal(captured[0].beforeState.flagged_at, null);
  assert.ok(captured[0].afterState.flagged_at);
  assert.equal(captured[0].afterState.flagged_by, 'clerk@example.com');
  assert.equal(captured[0].afterState.flag_reason, 'Needs Dana review');
});

// 2. unflag by the flagger succeeds.
test('unflag by the original flagger succeeds and emits invoice.unflagged', async () => {
  const row = baseRow({ flagged_at: new Date('2026-07-17T12:00:00Z'), flagged_by: 'owner@example.com', flag_reason: 'x' });
  const captured = [];
  const { calls, res } = await runUnflag(
    row,
    { params: { id: 'doc-1' }, body: {}, user: { email: 'owner@example.com', permissions: [] } },
    captured,
  );

  assert.equal(res.statusCode, 200);
  const update = calls.find((c) => /UPDATE documents/.test(c.sql) && /flagged_at = NULL/.test(c.sql));
  assert.ok(update, 'unflag UPDATE ran');
  assert.equal(row.flagged_at, null);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].type, 'invoice.unflagged');
});

// 3. unflag by a non-flagger without manage_rules -> 403, row unchanged.
test('unflag by a non-flagger without manage_rules returns 403 and leaves the flag unchanged', async () => {
  const flaggedAt = new Date('2026-07-17T12:00:00Z');
  const row = baseRow({ flagged_at: flaggedAt, flagged_by: 'owner@example.com', flag_reason: 'x' });
  const captured = [];
  const { calls, res } = await runUnflag(
    row,
    { params: { id: 'doc-1' }, body: {}, user: { email: 'other@example.com', permissions: [] } },
    captured,
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'FLAG_UNFLAG_FORBIDDEN');
  // Row unchanged: still flagged, no unflag UPDATE, no audit event.
  assert.equal(row.flagged_at, flaggedAt);
  assert.equal(row.flagged_by, 'owner@example.com');
  assert.equal(calls.filter((c) => /flagged_at = NULL/.test(c.sql)).length, 0);
  assert.equal(captured.length, 0);
});

// 4. unflag by a manage_rules holder succeeds.
test('unflag by a manage_rules holder (not the flagger) succeeds', async () => {
  const row = baseRow({ flagged_at: new Date('2026-07-17T12:00:00Z'), flagged_by: 'owner@example.com', flag_reason: 'x' });
  const captured = [];
  const { calls, res } = await runUnflag(
    row,
    { params: { id: 'doc-1' }, body: {}, user: { email: 'mgr@example.com', permissions: ['accounting.invoices.manage_rules'] } },
    captured,
  );

  assert.equal(res.statusCode, 200);
  assert.ok(calls.find((c) => /flagged_at = NULL/.test(c.sql)));
  assert.equal(row.flagged_at, null);
  assert.equal(captured[0].type, 'invoice.unflagged');
});

// 5. stats response includes the flagged count.
test('invoice stats response includes the flagged count derived from flagged_at IS NOT NULL', async () => {
  const seenSql = [];
  const pool = {
    async query(sql) {
      seenSql.push(sql);
      if (/GROUP BY status/.test(sql)) return { rows: [] };
      if (/flagged_count/.test(sql)) {
        return { rows: [{ today_count: 0, avg_conf: null, err_count: 0, flagged_count: 3 }] };
      }
      if (/active_count/.test(sql)) return { rows: [{ active_count: 0, trash_count: 0, shelf_count: 0 }] };
      return { rows: [{}] };
    },
  };
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool, rowToDoc: (value) => value },
  }, async () => {
    const { getInvoiceStats } = freshRequire('modules/invoices/services/invoiceCollectionService.js');
    await getInvoiceStats({ query: {} }, res);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.flaggedCount, 3);
  assert.ok(seenSql.some((sql) => /COUNT\(\*\) FILTER \(WHERE flagged_at IS NOT NULL\)/.test(sql)));
});

// 6. workflow-neutrality: a flagged document is still approve-eligible.
// W7: only the current calendar month is an open period — dates must track it.
const OPEN_MONTH_DATE = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
function approvalRow(overrides = {}) {
  return {
    id: 'doc-1',
    status: 'pending',
    classification: 'invoice',
    file_name: 'invoice.pdf',
    invoice_number: 'INV-1',
    vendor_code: 'VENDOR',
    invoice_date: OPEN_MONTH_DATE,
    gl_date: OPEN_MONTH_DATE,
    amount: 100,
    job_match_number: 'JOB-1',
    subcontract_number: null,
    phase_code: '100',
    cost_type: 'L',
    gl_account: '5000',
    routing_code: 'R',
    multi_phase_candidate: false,
    phase_allocations: null,
    lien_waiver_required: false,
    linked_lien_waiver_id: null,
    waiver_on_document: false,
    rejection_reason: null,
    ...overrides,
  };
}

function makeApprovePool(row, calls) {
  const state = { status: row.status };
  return {
    state,
    pool: {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (/SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [row] };
        if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row] };
        if (/UPDATE documents/.test(sql)) {
          if (/status IN \('pending', 'modified', 'reviewed'\)/.test(sql)) {
            if (!['pending', 'modified', 'reviewed'].includes(state.status)) return { rows: [], rowCount: 0 };
            state.status = 'approved';
            row.status = 'approved';
            row.approved_at = new Date(params[params.length - 3]);
            row.approved_by = params[params.length - 2];
            return { rows: [], rowCount: 1 };
          }
        }
        return { rows: [], rowCount: 1 };
      },
    },
  };
}

test('flagging leaves approve eligibility untouched: a flagged pending invoice still approves', async () => {
  // Already flagged for review, but still pending — must remain approve-eligible.
  const row = approvalRow({ flagged_at: new Date('2026-07-17T12:00:00Z'), flagged_by: 'clerk@example.com', flag_reason: 'review' });
  const calls = [];
  const res = makeRes();
  const fakePool = makeApprovePool(row, calls);
  const captured = [];
  await withMockedModules({
    './supabase': { pool: fakePool.pool, audit: async () => {}, rowToDoc: (value) => value },
    './matching': { getSubcontractsMap: () => ({}) },
    './pdfMergeService': { queueApprovedInvoiceWaiverMerge: () => {} },
    './matcher': { recordApprovalConfirmation: async () => ({}) },
    '../../../lib/auditEvents': auditEventsMock(captured),
    '../../../middleware/errorResponse': errorResponseMock,
  }, async () => {
    const { approveInvoice } = freshRequire('modules/invoices/services/invoiceApprovalService.js');
    await approveInvoice({
      params: { id: row.id }, body: {}, requestId: 'req-1',
      log: { info() {}, warn() {} }, user: { email: 'reviewer@example.com' },
    }, res);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(row.status, 'approved');
  // The approve predicate is status-only; it never references flag columns.
  const approveUpdate = calls.find((c) => /UPDATE documents/.test(c.sql) && /status IN \('pending', 'modified', 'reviewed'\)/.test(c.sql));
  assert.ok(approveUpdate);
  assert.doesNotMatch(approveUpdate.sql, /flagged/);
});
