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

function documentRow(status) {
  return {
    id: 'doc-1',
    status,
    classification: 'invoice',
    file_name: 'invoice.pdf',
    invoice_number: 'INV-1',
    vendor_code: 'VENDOR',
    // W7: only the current calendar month is an open period.
    invoice_date: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    gl_date: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
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
  };
}

function makePool(row, calls, { statusBeforeUpdate } = {}) {
  const state = { status: row.status };
  return {
    state,
    pool: {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [row] };
      if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row] };
      if (/UPDATE documents/.test(sql)) {
        if (statusBeforeUpdate) state.status = statusBeforeUpdate;
        if (/status IN \('pending', 'modified', 'reviewed'\)/.test(sql)) {
          if (!['pending', 'modified', 'reviewed'].includes(state.status)) return { rows: [], rowCount: 0 };
          state.status = 'approved';
          row.status = 'approved';
          row.approved_at = new Date(params[params.length - 3]);
          row.approved_by = params[params.length - 2];
          return { rows: [], rowCount: 1 };
        }
        if (/status NOT IN \('submitting', 'submitted'\)/.test(sql)) {
          if (['submitting', 'submitted'].includes(state.status)) return { rows: [], rowCount: 0 };
          state.status = 'rejected';
          row.status = 'rejected';
          row.rejection_reason = params[1];
          return { rows: [], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 1 };
    },
    },
  };
}

function auditEvents(sideEffects) {
  return {
    getRequestAuditActor: () => ({ name: 'reviewer@example.com', userId: 'reviewer', role: null }),
    emitInvoiceAuditEvent: async () => {
      sideEffects.events += 1;
      return { id: 'event-1' };
    },
  };
}

async function runApprove(status, options = {}) {
  const row = documentRow(status);
  const calls = [];
  const res = makeRes();
  const sideEffects = { audits: 0, events: 0 };
  const fakePool = makePool(row, calls, options);
  await withMockedModules({
    './supabase': {
      pool: fakePool.pool,
      audit: async () => { sideEffects.audits += 1; },
      rowToDoc: (value) => value,
    },
    './matching': { getSubcontractsMap: () => ({}) },
    './pdfMergeService': { queueApprovedInvoiceWaiverMerge: () => {} },
    './matcher': { recordApprovalConfirmation: async () => ({}) },
    '../../../lib/auditEvents': auditEvents(sideEffects),
    '../../../middleware/errorResponse': { safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
  }, async () => {
    const { approveInvoice } = freshRequire('modules/invoices/services/invoiceApprovalService.js');
    await approveInvoice({
      params: { id: row.id }, body: {}, requestId: 'req-1',
      log: { info() {}, warn() {} }, user: { email: 'reviewer@example.com' },
    }, res);
  });
  return { row, state: fakePool.state, calls, res, sideEffects };
}

async function runReject(status, options = {}) {
  const row = documentRow(status);
  const calls = [];
  const res = makeRes();
  const sideEffects = { audits: 0, events: 0 };
  const fakePool = makePool(row, calls, options);
  await withMockedModules({
    './supabase': {
      pool: fakePool.pool,
      audit: async () => { sideEffects.audits += 1; },
      rowToDoc: (value) => value,
    },
    './sharepointUndoService': {},
    '../../../lib/auditEvents': auditEvents(sideEffects),
    '../../../middleware/errorResponse': { safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
  }, async () => {
    const { rejectInvoice } = freshRequire('modules/invoices/services/invoiceStatusService.js');
    await rejectInvoice({ params: { id: row.id }, body: { reason: 'duplicate' } }, res);
  });
  return { row, state: fakePool.state, calls, res, sideEffects };
}

for (const status of ['submitting', 'submitted']) {
  test(`approve returns 409 and leaves a ${status} invoice unchanged`, async () => {
    const { row, calls, res } = await runApprove(status);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'INVALID_STATUS_TRANSITION');
    assert.equal(row.status, status);
    assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
    assert.match(calls[0].sql, /FOR UPDATE/);
  });

  test(`reject returns 409 and leaves a ${status} invoice unchanged`, async () => {
    const { row, calls, res } = await runReject(status);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'INVALID_STATUS_TRANSITION');
    assert.equal(row.status, status);
    assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
    assert.match(calls[0].sql, /FOR UPDATE/);
  });
}

test('approve transitions an allowed pending invoice with a conditional status update', async () => {
  const { row, calls, res } = await runApprove('pending');
  assert.equal(res.statusCode, 200);
  assert.equal(row.status, 'approved');
  assert.match(calls.find((call) => /UPDATE documents/.test(call.sql)).sql, /status IN \('pending', 'modified', 'reviewed'\)/);
});

test('reject transitions an allowed pending invoice with a conditional status update', async () => {
  const { row, calls, res } = await runReject('pending');
  assert.equal(res.statusCode, 200);
  assert.equal(row.status, 'rejected');
  assert.match(calls.find((call) => /UPDATE documents/.test(call.sql)).sql, /status NOT IN \('submitting', 'submitted'\)/);
});

test('approve returns 409 without an audit when a submitted status wins after the lock', async () => {
  const { state, calls, res, sideEffects } = await runApprove('pending', { statusBeforeUpdate: 'submitted' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'INVALID_STATUS_TRANSITION');
  assert.equal(state.status, 'submitted');
  assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 1);
  assert.equal(sideEffects.audits, 0);
  assert.equal(sideEffects.events, 0);
});

for (const status of ['submitting', 'submitted']) {
  test(`reject returns 409 without an audit when ${status} wins after the lock`, async () => {
    const { state, calls, res, sideEffects } = await runReject('pending', { statusBeforeUpdate: status });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'INVALID_STATUS_TRANSITION');
    assert.equal(state.status, status);
    assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 1);
    assert.equal(sideEffects.audits, 0);
    assert.equal(sideEffects.events, 0);
  });
}
