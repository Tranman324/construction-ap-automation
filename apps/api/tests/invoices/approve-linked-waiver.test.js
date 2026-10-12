'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

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

function clearModules() {
  for (const relativePath of [
    'modules/invoices/services/invoiceApprovalService.js',
    'modules/invoices/services/waiverLinkedStatusService.js',
  ]) {
    delete require.cache[require.resolve(path.join(root, relativePath))];
  }
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeReq(id) {
  return {
    params: { id },
    body: {},
    requestId: 'req-1',
    log: { info() {}, warn() {}, error() {} },
    user: { email: 'tester@northwindcg.example', userId: 'tester', role: 'admin' },
  };
}

// In-memory documents table understanding the exact SQL shapes the approval
// service and waiverLinkedStatusService issue. Behavioral, not shape-checking:
// the assertions read the resulting row state, so a missing waiver UPDATE
// fails the test even if every call "succeeds".
function makeState({ waiverStatus = 'pending', waiverFiled = false, linked = 'wv-1' } = {}) {
  const invoice = {
    id: 'inv-1',
    classification: 'invoice',
    status: 'pending',
    linked_lien_waiver_id: linked,
    invoice_date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
    approved_at: null,
    approved_by: null,
    routing_code: 'D',
    phase_code: '03-100',
    cost_type: 'S',
    gl_account: '5450',
    // W7: only the current calendar month is an open period.
    gl_date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
  };
  const waiver = linked ? {
    id: linked,
    classification: 'lien-waiver',
    status: waiverStatus,
    filed: waiverFiled,
    linked_lien_waiver_id: 'inv-1',
  } : null;
  const byId = (id) => (id === invoice.id ? invoice : (waiver && id === waiver.id ? waiver : null));
  const calls = [];
  const db = {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: s, params });
      if (/^SELECT \* FROM documents WHERE id = \$1( FOR UPDATE)?$/.test(s)) {
        const row = byId(params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (/SET status = 'linked', updated_at = NOW\(\) WHERE id = \$1$/.test(s)) {
        byId(params[0]).status = 'linked';
        return { rows: [], rowCount: 1 };
      }
      if (/SET status = 'pending', updated_at = NOW\(\) WHERE id = \$1 AND status = 'linked'$/.test(s)) {
        const row = byId(params[0]);
        if (row.status === 'linked') { row.status = 'pending'; return { rows: [], rowCount: 1 }; }
        return { rows: [], rowCount: 0 };
      }
      if (/UPDATE documents SET status = \$1, approved_at = \$2, approved_by = \$3, updated_at = \$2 WHERE id = \$4/.test(s)) {
        invoice.status = params[0];
        invoice.approved_at = params[1];
        invoice.approved_by = params[2];
        return { rows: [], rowCount: 1 };
      }
      // Unapprove restores the original canonical invoice date with the other
      // approval state, so recovery approvals are fully reversible.
      if (/UPDATE documents SET status = \$1, invoice_date = \$2, approved_at = \$3, approved_by = \$4/.test(s)) {
        invoice.status = params[0];
        invoice.invoice_date = params[1];
        invoice.approved_at = params[2];
        invoice.approved_by = params[3];
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { invoice, waiver, db, calls };
}

function approvalMocks(db) {
  return {
    '../../../lib/auditEvents': {
      checkStateMatch: () => ({ match: true, staleFields: [] }),
      emitInvoiceAuditEvent: async () => ({ id: 'evt-1' }),
      emitLegacyInvoiceAuditEvent: async () => {},
      findUndoableAction: async () => null,
      getRequestAuditActor: () => ({ name: 'tester@northwindcg.example' }),
      insertAuditEvent: async () => ({ id: 'evt-1' }),
      markActionUndone: async () => {},
    },
    './approvalValidator': { validateApprovalEligibility: () => ({ approvalPath: 'auto' }) },
    './approvalStateService': { getEffectiveCoding: (row) => ({ applied: {}, effectiveRow: row }) },
    './pdfMergeService': { queueApprovedInvoiceWaiverMerge: () => {} },
    './supabase': {
      pool: db,
      audit: async () => {},
      rowToDoc: (r) => ({ ...r }),
    },
    './transaction': { withTransaction: async (_pool, fn) => fn(db) },
    './matcher': { recordApprovalConfirmation: async () => ({}) },
  };
}

test('approving an invoice parks its linked waiver as status linked', async () => {
  const state = makeState();
  await withMockedModules(approvalMocks(state.db), async () => {
    clearModules();
    const { approveInvoice } = freshRequire('modules/invoices/services/invoiceApprovalService.js');
    const res = makeRes();
    await approveInvoice(makeReq('inv-1'), res);
    assert.equal(res.statusCode, 200);
    assert.equal(state.invoice.status, 'approved');
    assert.equal(state.waiver.status, 'linked', 'linked waiver must leave the pending queue on approval');
  });
});

test('approving an invoice with no linked waiver touches no waiver row', async () => {
  const state = makeState({ linked: null });
  await withMockedModules(approvalMocks(state.db), async () => {
    clearModules();
    const { approveInvoice } = freshRequire('modules/invoices/services/invoiceApprovalService.js');
    const res = makeRes();
    await approveInvoice(makeReq('inv-1'), res);
    assert.equal(res.statusCode, 200);
    assert.equal(state.invoice.status, 'approved');
    assert.ok(!state.calls.some((c) => /SET status = 'linked'/.test(c.sql)));
  });
});

test('filed (shelved) waivers are left as-is on approval', async () => {
  const state = makeState({ waiverFiled: true });
  await withMockedModules(approvalMocks(state.db), async () => {
    clearModules();
    const { approveInvoice } = freshRequire('modules/invoices/services/invoiceApprovalService.js');
    const res = makeRes();
    await approveInvoice(makeReq('inv-1'), res);
    assert.equal(res.statusCode, 200);
    assert.equal(state.waiver.status, 'pending', 'filed waivers are not in the pending queue; do not repark them');
  });
});

test('terminal waiver statuses are never overwritten by approval', async () => {
  const state = makeState({ waiverStatus: 'discarded' });
  await withMockedModules(approvalMocks(state.db), async () => {
    clearModules();
    const { approveInvoice } = freshRequire('modules/invoices/services/invoiceApprovalService.js');
    const res = makeRes();
    await approveInvoice(makeReq('inv-1'), res);
    assert.equal(res.statusCode, 200);
    assert.equal(state.waiver.status, 'discarded');
  });
});

test('unapproving the invoice keeps its still-linked waiver parked', async () => {
  const state = makeState();
  await withMockedModules(approvalMocks(state.db), async () => {
    clearModules();
    const service = freshRequire('modules/invoices/services/invoiceApprovalService.js');

    const approveRes = makeRes();
    await service.approveInvoice(makeReq('inv-1'), approveRes);
    assert.equal(state.waiver.status, 'linked');

    const unapproveRes = makeRes();
    await service.unapproveInvoice(makeReq('inv-1'), unapproveRes);
    assert.equal(unapproveRes.statusCode, 200);
    assert.equal(state.invoice.status, 'pending');
    assert.equal(state.waiver.status, 'linked', 'unapprove must not requeue a waiver while the reciprocal link remains');
  });
});

test('a saved canonical date survives normal approval and unapproval', async () => {
  const state = makeState({ linked: null });
  const savedInvoiceDate = '2026-08-01';
  // The ordinary PATCH has already persisted the save-only recovery date before
  // approval begins. Approval must snapshot that saved state for its undo.
  state.invoice.invoice_date = savedInvoiceDate;
  let approvalAction = null;
  const mocks = approvalMocks(state.db);
  mocks['../../../lib/auditEvents'] = {
    ...mocks['../../../lib/auditEvents'],
    emitInvoiceAuditEvent: async (_req, _res, event) => {
      if (event.type === 'invoice.approved') {
        approvalAction = {
          id: 'approval-action',
          beforeState: event.beforeState,
          afterState: event.afterState,
        };
      }
      return { id: 'evt-1' };
    },
    findUndoableAction: async () => approvalAction,
  };

  await withMockedModules(mocks, async () => {
    clearModules();
    const service = freshRequire('modules/invoices/services/invoiceApprovalService.js');

    const approveRes = makeRes();
    await service.approveInvoice(makeReq('inv-1'), approveRes);
    assert.equal(approveRes.statusCode, 200);
    assert.equal(state.invoice.invoice_date, savedInvoiceDate);

    const unapproveRes = makeRes();
    await service.unapproveInvoice(makeReq('inv-1'), unapproveRes);
    assert.equal(unapproveRes.statusCode, 200);
    assert.equal(state.invoice.status, 'pending');
    assert.equal(state.invoice.invoice_date, savedInvoiceDate);
  });
});

test('unapprove falls back to plain unapprove when the doc was edited after approval', async () => {
  // Regression: post-approval edits (e.g. fixing coding after a Spectrum
  // rejection) made checkStateMatch fail and unapprove returned 409 forever,
  // stranding the doc in approved. Expected: flip to pending, KEEP the
  // current coding, and leave the approval action's undo record alone.
  const state = makeState({ linked: null });
  state.invoice.status = 'approved';
  state.invoice.approved_at = '2026-08-17T17:05:35.084Z';
  state.invoice.approved_by = 'amorgan@northwindcg.example';

  let markActionUndoneCalled = false;
  const mocks = approvalMocks(state.db);
  mocks['../../../lib/auditEvents'] = {
    ...mocks['../../../lib/auditEvents'],
    findUndoableAction: async () => ({
      id: 'act-1',
      beforeState: {
        status: 'pending', invoice_date: '2026-08-01', approved_at: null, approved_by: null,
        routing_code: 'D', phase_code: '03-100', cost_type: 'M',
        gl_account: '5300', gl_date: '2026-08-01',
      },
      afterState: { status: 'approved', cost_type: 'M', gl_account: '5300' },
    }),
    checkStateMatch: () => ({ match: false, staleFields: ['cost_type', 'gl_account'] }),
    markActionUndone: async () => { markActionUndoneCalled = true; },
  };

  await withMockedModules(mocks, async () => {
    clearModules();
    const { unapproveInvoice } = freshRequire('modules/invoices/services/invoiceApprovalService.js');
    const res = makeRes();
    await unapproveInvoice(makeReq('inv-1'), res);

    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(state.invoice.status, 'pending');
    assert.equal(state.invoice.approved_at, null);
    assert.equal(markActionUndoneCalled, false, 'diverged approval action must not be marked undone');

    const restore = state.calls.find(
      (call) => /UPDATE documents SET status = \$1, invoice_date = \$2, approved_at = \$3, approved_by = \$4/.test(call.sql)
    );
    assert.ok(restore, 'expected an unapprove restore UPDATE');
    assert.ok(restore.params.includes('S'), 'current cost_type must be preserved');
    assert.ok(restore.params.includes('5450'), 'current gl_account must be preserved');
    assert.ok(!restore.params.includes('M'), 'pre-approval cost_type must NOT be restored');
    assert.ok(!restore.params.includes('5300'), 'pre-approval gl_account must NOT be restored');
  });
});

test('unapprove leaves non-parked waiver statuses alone', async () => {
  const state = makeState({ waiverStatus: 'discarded' });
  state.invoice.status = 'approved';
  await withMockedModules(approvalMocks(state.db), async () => {
    clearModules();
    const { unapproveInvoice } = freshRequire('modules/invoices/services/invoiceApprovalService.js');
    const res = makeRes();
    await unapproveInvoice(makeReq('inv-1'), res);
    assert.equal(res.statusCode, 200);
    assert.equal(state.waiver.status, 'discarded');
  });
});
