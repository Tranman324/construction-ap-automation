'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const { assertCanonicalErrorBody } = require('../helpers/assertCanonicalErrorResponse');

const root = path.resolve(__dirname, '..', '..');
const { invoiceBulkActionSchema } = require('../../lib/schemas');

test('bulk action request validation accepts approve', () => {
  const result = invoiceBulkActionSchema.safeParse({ ids: ['doc-1'], action: 'approve' });
  assert.equal(result.success, true);
});

test('single and bulk approval structurally share the eligibility validator', () => {
  const bulkSource = fs.readFileSync(path.join(root, 'modules/invoices/services/bulkActionService.js'), 'utf8');
  const singleSource = fs.readFileSync(path.join(root, 'modules/invoices/services/invoiceApprovalService.js'), 'utf8');

  // Both mutations validate the EFFECTIVE row (row merged with served
  // codingDefaults via getEffectiveCoding) — the same merge the verdict previews.
  // Both also evaluate the live duplicate status and pass it to the validator
  // (DUPLICATE-WORKFLOW-SPEC 2.4).
  assert.match(bulkSource, /validateApprovalEligibility\(effectiveRow, \{ invoiceId: row\.id, duplicateStatus \}\)/);
  assert.match(singleSource, /validateApprovalEligibility\(effectiveRow, \{ invoiceId: req\.params\.id, closedPeriodDateSource: 'invoice', duplicateStatus \}\)/);
  assert.match(bulkSource, /evaluateDuplicateStatus\(row, \{ db \}\)/);
  assert.match(singleSource, /evaluateDuplicateStatus\(row, \{ db \}\)/);
  assert.match(bulkSource, /getEffectiveCoding\(row\)/);
  assert.match(singleSource, /getEffectiveCoding\(row, \{ log: req\.log \}\)/);
  assert.doesNotMatch(bulkSource, /function isLienWaiverMissing/);
  assert.doesNotMatch(bulkSource, /function getMultiPhaseRoutingError/);
});

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

// W7: only the current calendar month is open — fixtures must track it.
const NOW = new Date();
const OPEN_DATE = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-01`;

function approvalRow(overrides = {}) {
  return {
    id: 'doc-1',
    status: 'pending',
    invoice_number: 'INV-1',
    vendor_code: 'VEND',
    invoice_date: OPEN_DATE,
    gl_date: OPEN_DATE,
    amount: 100,
    job_match_number: 'JOB-1',
    subcontract_number: null,
    phase_code: '0100',
    cost_type: 'S',
    gl_account: '5450', // must pair with cost_type S (B2 cost-type/GL gate)
    routing_code: 'R',
    multi_phase_candidate: false,
    phase_allocations: null,
    lien_waiver_required: false,
    linked_lien_waiver_id: null,
    waiver_on_document: false,
    ...overrides,
  };
}

function makePool(row, calls, { beforeLockedSelect } = {}) {
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (/SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) {
      beforeLockedSelect?.(row);
      return { rows: [row] };
    }
    if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row] };
    if (/UPDATE documents/.test(sql)) {
      if (/status IN \('pending', 'modified', 'reviewed'\)/.test(sql)) {
        if (!['pending', 'modified', 'reviewed'].includes(row.status)) return { rows: [], rowCount: 0 };
        row.status = 'approved';
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected bulk approval update: ${sql}`);
    }
    throw new Error(`unexpected query: ${sql}`);
  }

  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  };
}

async function runBulkApprove(row, { phaseInfo = null, beforeLockedSelect } = {}) {
  const calls = [];
  const auditCalls = [];
  const auditEventCalls = [];
  const res = makeRes();
  const approvalValidatorPath = require.resolve(path.join(root, 'modules/invoices/services/approvalValidator.js'));
  delete require.cache[approvalValidatorPath];

  await withMockedModules({
    './supabase': { pool: makePool(row, calls, { beforeLockedSelect }), audit: async (...args) => auditCalls.push(args) },
    './matching': { getSubcontractsMap: () => ({}) },
    './matcher': { getSubcontractPhaseInfo: () => phaseInfo },
    '../../../middleware/permissions': { checkPermission: () => true },
    '../../../middleware/errorResponse': { safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
    '../../../lib/auditEvents': {
      getRequestAuditActor: () => ({ name: 'reviewer@example.com', userId: 'reviewer', role: null }),
      emitInvoiceAuditEvent: async (...args) => {
        auditEventCalls.push(args);
        return { id: 'event-1' };
      },
    },
  }, async () => {
    const { bulkAction } = freshRequire('modules/invoices/services/bulkActionService.js');
    await bulkAction({
      body: { ids: [row.id], action: 'approve' },
      user: { email: 'reviewer@example.com' },
    }, res);
  });

  return { calls, auditCalls, auditEventCalls, res, row };
}

test('bulk approval skips an invoice with the same lien-waiver failure as single approval', async () => {
  const row = approvalRow({ lien_waiver_required: true });
  const { calls, auditCalls, res } = await runBulkApprove(row);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.updated, 0);
  assert.equal(res.body.skipped, 1);
  assert.equal(res.body.skippedInvoices[0].error, 'Missing required fields for approval');
  assert.deepEqual(res.body.skippedInvoices[0].missing, ['linked_lien_waiver_id']);
  assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
  assert.equal(auditCalls.length, 0);
});

test('bulk approval skips a multi-phase invoice that requires an allocation', async () => {
  const row = approvalRow({ multi_phase_candidate: true, phase_allocations: null });
  const { calls, res } = await runBulkApprove(row);

  assert.equal(res.body.updated, 0);
  assert.equal(res.body.skippedInvoices[0].code, 'MULTI_PHASE_ALLOCATION_REQUIRED');
  assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
});

test('bulk approval skips a PM-routing violation through the shared eligibility validator', async () => {
  const row = approvalRow({
    subcontract_number: 'SUB-1',
    routing_code: null,
    amount: 150,
    multi_phase_candidate: true,
    phase_allocations: JSON.stringify([{ phase_code: '0100', cost_type: 'S', amount: 150 }]),
  });
  const { calls, res } = await runBulkApprove(row, { phaseInfo: { unbilled: 100 } });

  assert.equal(res.body.updated, 0);
  assert.equal(res.body.skippedInvoices[0].code, 'PM_ROUTING_REQUIRED');
  assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
});

test('bulk approval rejects an ineligible status and conditionally updates an allowed status', async () => {
  const rejected = await runBulkApprove(approvalRow({ status: 'submitted' }));
  assert.equal(rejected.res.body.updated, 0);
  assert.equal(rejected.res.body.skippedInvoices[0].code, 'INVALID_STATUS_TRANSITION');
  assert.equal(rejected.calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);

  const accepted = await runBulkApprove(approvalRow({ status: 'reviewed' }));
  assert.equal(accepted.res.body.updated, 1);
  assert.equal(accepted.row.status, 'approved');
  assert.match(accepted.calls.find((call) => /UPDATE documents/.test(call.sql)).sql, /status IN \('pending', 'modified', 'reviewed'\)/);
  assert.deepEqual(accepted.auditCalls, [['doc-1', 'approve', { status: ['reviewed', 'approved'] }]]);
  assert.equal(accepted.auditEventCalls.length, 1);
});

test('bulk approval retains GL-date eligibility and never recovers a closed invoice date', async () => {
  const row = approvalRow({ invoice_date: '2025-01-15', gl_date: OPEN_DATE });
  const { calls, res } = await runBulkApprove(row);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.updated, 1);
  assert.equal(row.status, 'approved');
  assert.equal(row.invoice_date, '2025-01-15');
  const update = calls.find((call) => /UPDATE documents/.test(call.sql));
  assert.doesNotMatch(update.sql, /invoice_date/);
  assert.equal(update.params.includes(OPEN_DATE), false, 'bulk has no invoice-date recovery payload');
});

test('bulk closed GL rejection remains GL-only when the canonical invoice date is open', async () => {
  const row = approvalRow({ invoice_date: OPEN_DATE, gl_date: '2025-01-15' });
  const { calls, res } = await runBulkApprove(row);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.updated, 0);
  const skipped = res.body.skippedInvoices[0];
  assert.equal(skipped.code, 'CLOSED_PERIOD_DATE');
  assert.equal(skipped.glDateMonth, '2025-01');
  assert.equal(skipped.suggestedGlDate, OPEN_DATE);
  assert.match(skipped.nextAction, /glDate/);
  assert.doesNotMatch(skipped.nextAction, /invoiceDate/);
  assert.equal(skipped.invoiceDateMonth, undefined);
  assert.equal(skipped.suggestedInvoiceDate, undefined);
  assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
});

test('bulk approval re-reads locked eligibility after a concurrent waiver requirement is committed', async () => {
  const row = approvalRow();
  const { auditCalls, auditEventCalls, calls, res } = await runBulkApprove(row, {
    beforeLockedSelect(current) {
      current.lien_waiver_required = true;
    },
  });

  assert.equal(res.body.updated, 0);
  assert.equal(res.body.skippedInvoices[0].error, 'Missing required fields for approval');
  assert.deepEqual(res.body.skippedInvoices[0].missing, ['linked_lien_waiver_id']);
  assert.match(calls.find((call) => /FOR UPDATE/.test(call.sql)).sql, /FOR UPDATE/);
  assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
  assert.equal(auditCalls.length, 0);
  assert.equal(auditEventCalls.length, 0);
});

function makeBulkMutationPool(row, calls) {
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
    if (/SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [row] };
    if (/UPDATE documents/.test(sql)) {
      if (/filed = true/.test(sql)) {
        row.filed = true;
        row.filed_at = params[0];
      } else if (/approved_at = NULL/.test(sql)) {
        row.status = 'pending';
        row.approved_at = null;
        row.approved_by = null;
      } else if (/reviewed_at/.test(sql)) {
        row.status = 'reviewed';
        row.reviewed_at = params[1];
      }
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected bulk mutation query: ${sql}`);
  }

  return {
    query,
    async connect() { return { query, release() {} }; },
  };
}

async function runBulkMutation(action, row) {
  const calls = [];
  const auditCalls = [];
  const auditEventCalls = [];
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool: makeBulkMutationPool(row, calls), audit: async (...args) => auditCalls.push(args) },
    '../../../middleware/permissions': { checkPermission: () => true },
    '../../../middleware/errorResponse': { safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
    '../../../lib/auditEvents': {
      getRequestAuditActor: () => ({ name: 'reviewer@example.com', userId: 'reviewer', role: null }),
      emitInvoiceAuditEvent: async (...args) => { auditEventCalls.push(args); return { id: 'event-1' }; },
    },
  }, async () => {
    const { bulkAction } = freshRequire('modules/invoices/services/bulkActionService.js');
    await bulkAction({
      body: { ids: [row.id], action },
      user: { email: 'reviewer@example.com' },
    }, res);
  });
  return { calls, auditCalls, auditEventCalls, res };
}

test('bulk unapprove, review, and file each lock and mutate within one transaction per id', async () => {
  const fixtures = {
    unapprove: approvalRow({ status: 'approved', approved_at: '2026-09-22T00:00:00.000Z', approved_by: 'approver' }),
    review: approvalRow({ status: 'pending' }),
    file: approvalRow({ status: 'pending', filed: false, filed_at: null }),
  };

  for (const [action, row] of Object.entries(fixtures)) {
    const { calls, auditCalls, auditEventCalls, res } = await runBulkMutation(action, row);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.updated, 1);
    assert.equal(calls.filter((call) => call.sql === 'BEGIN').length, 1);
    assert.equal(calls.filter((call) => call.sql === 'COMMIT').length, 1);
    assert.match(calls.find((call) => /SELECT \* FROM documents/.test(call.sql)).sql, /FOR UPDATE/);
    assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 1);
    assert.equal(auditCalls.length, 1);
    assert.equal(auditEventCalls.length, 1);
  }
});

test('bulk unapprove and file skip in-transaction without mutating, auditing, or leaking the lock', async () => {
  const cases = [
    ['unapprove', approvalRow({ status: 'pending' })],
    ['file', approvalRow({ status: 'pending', filed: true, filed_at: '2026-09-22T00:00:00.000Z' })],
  ];

  for (const [action, row] of cases) {
    const { calls, auditCalls, auditEventCalls, res } = await runBulkMutation(action, row);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.updated, 0);
    // Current semantics: an in-transaction skip is NOT counted in the `skipped`
    // counter (only approve/discard pre-checks populate it), so the field is
    // omitted from the response entirely.
    assert.equal(res.body.skipped, undefined);
    assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
    assert.equal(auditCalls.length, 0);
    assert.equal(auditEventCalls.length, 0);
    assert.equal(calls.filter((call) => call.sql === 'BEGIN').length, 1);
    assert.equal(calls.filter((call) => call.sql === 'COMMIT').length, 1);
  }
});
