'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const { fail } = require('../../middleware/errorResponse');

const root = path.resolve(__dirname, '..', '..');

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
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

function filedDocument(overrides = {}) {
  return {
    id: 'doc-1',
    classification: 'invoice',
    file_name: 'invoice.pdf',
    invoice_number: 'INV-100',
    filed: true,
    filed_at: new Date('2026-07-02T12:00:00Z'),
    filed_destination: 'Billings',
    filing_note: 'filed',
    hold_reason: null,
    sp_file_url: 'https://sharepoint/doc',
    sharepoint_item_id: 'sp-item-1',
    sharepoint_filename: 'INV Vendor.pdf',
    ...overrides,
  };
}

function makeFileAction(overrides = {}) {
  const afterState = {
    filed: true,
    filed_at: '2026-07-02T12:00:00.000Z',
    filed_destination: 'Billings',
    filing_note: 'filed',
    hold_reason: null,
    sp_file_url: 'https://sharepoint/doc',
    sharepoint_item_id: 'sp-item-1',
    sharepoint_filename: 'INV Vendor.pdf',
  };

  return {
    id: 'act-file-1',
    type: 'invoice.filed',
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    undoneAt: null,
    undoable: true,
    beforeState: {
      filed: false,
      filed_at: null,
      filed_destination: null,
      filing_note: null,
      hold_reason: null,
      sp_file_url: null,
      sharepoint_item_id: null,
      sharepoint_filename: null,
    },
    afterState,
    ...overrides,
  };
}

function rowToDoc(row) {
  return {
    id: row.id,
    status: row.status || null,
    filed: Boolean(row.filed),
    sharePointItemId: row.sharepoint_item_id || null,
    waiverOnDocument: Boolean(row.waiver_on_document),
    waiverOnDocumentAt: row.waiver_on_document_at
      ? new Date(row.waiver_on_document_at).toISOString()
      : null,
    waiverOnDocumentBy: row.waiver_on_document_by || null,
    // Effective requirement (2026-08-06): detection flag minus persistent bypass
    lienWaiverRequired: row.lien_waiver_required === true && row.waiver_bypassed !== true,
    waiverBypassed: row.waiver_bypassed === true,
    lienWaiverStatus: row.lien_waiver_status || null,
  };
}

function makeWaiverRowToDoc(getWaiverActionState) {
  return (row, options = {}) => {
    const invoice = rowToDoc(row);
    if (options.includeWaiverActions) {
      invoice.waiverActions = getWaiverActionState(row, options);
    }
    return invoice;
  };
}

function loadWaiverActionHelpers() {
  const dbPath = require.resolve('../../lib/db.js');
  const supabasePath = require.resolve('../../modules/invoices/services/supabase.js');
  const before = { db: require.cache[dbPath], supabase: require.cache[supabasePath] };
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: Object.assign(async () => {}, { query: async () => ({ rows: [] }), on() {}, supabase: {} }),
  };
  delete require.cache[supabasePath];
  try {
    const { getWaiverActionSerializationOptions, getWaiverActionState } = require(supabasePath);
    return { getWaiverActionSerializationOptions, getWaiverActionState };
  } finally {
    if (before.db) require.cache[dbPath] = before.db; else delete require.cache[dbPath];
    if (before.supabase) require.cache[supabasePath] = before.supabase; else delete require.cache[supabasePath];
  }
}

function makeAuditEvents(action, calls) {
  const auditEvents = {
    AUDIT_EVENT_COLUMNS: 'id',
    checkStateMatch: () => ({ match: true, staleFields: [] }),
    findAuditEvent: async () => action,
    findUndoableAction: async () => action,
    getRequestAuditActor: (req) => ({
      userId: req.headers?.['x-user-id'] || req.headers?.['x-user-email'] || 'system',
      name: req.headers?.['x-user-email'] || 'system',
      role: req.headers?.['x-user-role'] || null,
    }),
    insertAuditEvent: async () => null,
    markActionUndone: async (id, actor) => calls.markUndone.push({ id, actor }),
    rowToAuditEvent: (row) => row,
  };
  auditEvents.emitInvoiceAuditEvent = async (req, res, event) => {
    calls.auditEvents.push({
      ...event,
      actor: auditEvents.getRequestAuditActor(req, res),
    });
    return { id: `event-${calls.auditEvents.length}` };
  };
  return auditEvents;
}

async function runUndoAction({ action = makeFileAction(), deleteResult, rowOverrides = {} }) {
  const calls = {
    auditEvents: [],
    deletes: [],
    markUndone: [],
    updates: [],
  };
  const originalRow = filedDocument(rowOverrides);
  let updatedRow = { ...originalRow };
  const pool = {
    query: async (sql, params = []) => {
      if (/^SELECT \* FROM documents WHERE id = \$1/.test(sql)) {
        return { rows: [updatedRow] };
      }
      if (/UPDATE documents SET/.test(sql)) {
        calls.updates.push({ sql, params });
        updatedRow = {
          ...updatedRow,
          filed: false,
          filed_at: null,
          filed_destination: null,
          filing_note: null,
          hold_reason: null,
          sp_file_url: null,
          sharepoint_item_id: null,
          sharepoint_filename: null,
        };
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const req = {
    params: { id: 'doc-1', actionId: action.id },
    headers: { 'x-user-email': 'worker@example.com', 'x-user-id': 'user-1' },
    log: { warn() {} },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': { pool, rowToDoc },
    './sharepointUndoService': {
      deleteFiledSharePointCopy: async (args) => {
        calls.deletes.push(args);
        return deleteResult === undefined
          ? { deleted: true, itemId: originalRow.sharepoint_item_id, driveId: 'drive-id' }
          : deleteResult;
      },
    },
    '../../../lib/auditEvents': makeAuditEvents(action, calls),
    '../../../middleware/errorResponse': {
      fail,
      safeError(response, err) {
        return response.status(500).json({ error: err.message });
      },
    },
  }, async () => {
    const { undoAction } = freshRequire('modules/invoices/services/unifiedActionService.js');
    await undoAction(req, res);
  });

  return { calls, res };
}

test('in-window file undo reverts local filing and deletes SharePoint copy', async () => {
  const { calls, res } = await runUndoAction({});

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice.filed, false);
  assert.equal(res.body.invoice.sharePointItemId, null);
  assert.equal(res.body.sharePoint.deleted, true);
  assert.equal(calls.deletes.length, 1);
  assert.equal(calls.deletes[0].row.sharepoint_item_id, 'sp-item-1');
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.markUndone, [{ id: 'act-file-1', actor: 'worker@example.com' }]);
  assert.equal(calls.auditEvents[0].type, 'invoice.file_undo');
  assert.equal(calls.auditEvents[0].actor.name, 'worker@example.com');
});

test('file undo cannot unshelf a lien waiver that is still linked to an invoice', async () => {
  const { calls, res } = await runUndoAction({
    rowOverrides: {
      classification: 'lien-waiver',
      linked_lien_waiver_id: 'invoice-1',
    },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'WAIVER_LINKED_SHELF_PROTECTED');
  assert.equal(calls.deletes.length, 0);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.markUndone.length, 0);
});

test('generic undo cannot restore a historical one-sided lien waiver link', async () => {
  const action = {
    id: 'act-old-edit',
    type: 'invoice.edited',
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    undoneAt: null,
    undoable: true,
    beforeState: {
      description: 'Before edit',
      linked_lien_waiver_id: 'waiver-old',
    },
    afterState: {
      description: 'After edit',
      linked_lien_waiver_id: null,
    },
  };
  const { calls, res } = await runUndoAction({
    action,
    rowOverrides: { description: 'After edit', linked_lien_waiver_id: null },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.updates.length, 1);
  assert.match(calls.updates[0].sql, /description = \$1/);
  assert.doesNotMatch(calls.updates[0].sql, /linked_lien_waiver_id/);
});

test('expired footer file undo is rejected and explicit unfile is not exported', async () => {
  const expiredAction = makeFileAction({
    timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
  });
  const expired = await runUndoAction({ action: expiredAction });

  assert.equal(expired.res.statusCode, 410);
  assert.equal(expired.res.body.code, 'UNDO_WINDOW_EXPIRED');
  assert.equal(expired.calls.deletes.length, 0);
  assert.equal(expired.calls.updates.length, 0);

  await withMockedModules({
    './supabase': {
      pool: { query: async () => ({ rows: [] }) },
      audit: async () => {},
      rowToDoc,
    },
    './sharepointUndoService': {
      deleteFiledSharePointCopy: async () => ({ deleted: false }),
    },
    '../../../lib/auditEvents': makeAuditEvents(expiredAction, {
      auditEvents: [],
      markUndone: [],
    }),
    '../../../middleware/errorResponse': {
      fail,
      safeError(response, err) {
        return response.status(500).json({ error: err.message });
      },
    },
  }, async () => {
    const statusService = freshRequire('modules/invoices/services/invoiceStatusService.js');
    assert.equal(statusService.unfileDocument, undefined);
  });
});

test('file undo keeps local rollback when SharePoint delete fails', async () => {
  const { calls, res } = await runUndoAction({
    deleteResult: {
      deleted: false,
      itemId: 'sp-item-1',
      driveId: 'drive-id',
      warning: 'Graph 500',
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice.filed, false);
  assert.equal(res.body.sharePoint.deleted, false);
  assert.equal(res.body.sharePoint.warning, 'Graph 500');
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.auditEvents[0].changes.sharePointDelete.warning, 'Graph 500');
});

function approvalDocument(overrides = {}) {
  return {
    id: 'doc-approval-1',
    classification: 'invoice',
    file_name: 'approval.pdf',
    status: 'pending',
    invoice_number: 'INV-200',
    vendor_code: 'ZVEN91',
    // W7: only the current calendar month is an open period.
    invoice_date: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    gl_date: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    amount: 100,
    job_match_number: '25-401',
    subcontract_number: 'SC-001',
    phase_code: '0100',
    cost_type: 'S',
    gl_account: '5450',
    routing_code: null,
    multi_phase_candidate: false,
    phase_allocations: null,
    lien_waiver_required: true,
    linked_lien_waiver_id: null,
    lien_waiver_status: 'missing',
    waiver_on_document: false,
    waiver_on_document_at: null,
    waiver_on_document_by: null,
    waiver_bypassed: false,
    waiver_bypassed_at: null,
    waiver_bypassed_by: null,
    ...overrides,
  };
}

test('attached override and bypass independently clear the waiver gate without mutating pipeline status', async () => {
  const { getWaiverActionSerializationOptions, getWaiverActionState } = loadWaiverActionHelpers();
  const calls = {
    auditEvents: [],
    legacyAudit: [],
    markUndone: [],
  };
  let row = approvalDocument();
  const bypassUpdates = [];
  const pool = {
    query: async (sql, params = []) => {
      if (/^SELECT \* FROM documents WHERE id = \$1/.test(sql)) {
        return { rows: [row] };
      }
      if (/UPDATE documents\s+SET waiver_on_document = true/.test(sql)) {
        row = {
          ...row,
          waiver_on_document: true,
          waiver_on_document_at: new Date('2026-07-02T12:05:00Z'),
          waiver_on_document_by: params[0],
        };
        return { rows: [] };
      }
      if (/UPDATE documents\s+SET waiver_on_document = false/.test(sql)) {
        row = {
          ...row,
          waiver_on_document: false,
          waiver_on_document_at: null,
          waiver_on_document_by: null,
        };
        return { rows: [] };
      }
      if (/UPDATE documents\s+SET waiver_bypassed = true/.test(sql)) {
        bypassUpdates.push(sql);
        row = {
          ...row,
          waiver_bypassed: true,
          waiver_bypassed_at: new Date('2026-07-02T12:10:00Z'),
          waiver_bypassed_by: params[0],
        };
        return { rows: [] };
      }
      if (/UPDATE documents\s+SET waiver_bypassed = false/.test(sql)) {
        bypassUpdates.push(sql);
        row = {
          ...row,
          waiver_bypassed: false,
          waiver_bypassed_at: null,
          waiver_bypassed_by: null,
        };
        return { rows: [] };
      }
      if (/UPDATE documents\s+SET routing_code = \$1,\s+status = \$2/.test(sql)) {
        row = {
          ...row,
          routing_code: params[0],
          status: params[1],
          approved_at: new Date(params[2]),
          approved_by: params[3],
        };
        return { rows: [] };
      }
      if (/UPDATE documents\s+SET status = \$1,\s+approved_at = \$2/.test(sql)) {
        row = {
          ...row,
          status: params[0],
          approved_at: new Date(params[1]),
          approved_by: params[2],
        };
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const supabase = {
    pool,
    audit: async (id, event, changes, actor) => calls.legacyAudit.push({ id, event, changes, actor }),
    getWaiverActionSerializationOptions,
    rowToDoc: makeWaiverRowToDoc(getWaiverActionState),
  };
  const auditEvents = makeAuditEvents(null, calls);
  const req = {
    params: { id: 'doc-approval-1' },
    body: {},
    user: { permissions: ['accounting.invoices.approve', 'accounting.invoices.request_waiver'] },
    headers: { 'x-user-email': 'ap@example.com', 'x-user-id': 'ap-user' },
    log: { info() {}, warn() {} },
    requestId: 'req-1',
  };

  await withMockedModules({
    './supabase': supabase,
    './matching': { getSubcontractsMap: () => ({ 'SC-001': { unbilled: 200 } }) },
    './pdfMergeService': { queueApprovedInvoiceWaiverMerge: () => {} },
    './matcher': { recordApprovalConfirmation: async () => ({}), getSubcontractPhaseInfo: () => null },
    '../../../lib/auditEvents': auditEvents,
    '../../../middleware/errorResponse': {
      fail,
      safeError(response, err) {
        return response.status(500).json({ error: err.message });
      },
    },
  }, async () => {
    const { approveInvoice } = freshRequire('modules/invoices/services/invoiceApprovalService.js');
    const {
      revertLienWaiverBypass,
      revertWaiverOverride,
      setLienWaiverBypass,
      setWaiverOverride,
    } = freshRequire('modules/invoices/services/invoiceStatusService.js');

    const firstApprove = makeRes();
    await approveInvoice(req, firstApprove);
    assert.equal(firstApprove.statusCode, 400);
    assert.deepEqual(firstApprove.body.details.missing, ['linked_lien_waiver_id']);

    const bypassRes = makeRes();
    await setLienWaiverBypass(req, bypassRes);
    assert.equal(bypassRes.statusCode, 200);
    assert.equal(bypassRes.body.invoice.lienWaiverRequired, false);
    assert.equal(bypassRes.body.invoice.lienWaiverStatus, 'missing');
    assert.ok(bypassRes.body.invoice.waiverActions, 'bypass response retains canonical waiver actions');
    assert.equal(bypassRes.body.invoice.waiverActions.bypass.permitted, false);
    assert.equal(bypassRes.body.invoice.waiverActions.revertBypass.permitted, true);
    assert.equal(bypassRes.body.action.undoEndpoint, '/api/invoices/doc-approval-1/waiver-bypass/revert');
    assert.equal(row.lien_waiver_status, 'missing', 'bypass must not mutate pipeline-owned status');
    assert.equal(row.waiver_on_document, false, 'bypass must not turn into an Attached override');
    assert.equal(bypassUpdates.length, 1);
    assert.doesNotMatch(bypassUpdates[0], /lien_waiver_status|waiver_on_document/);

    const alreadyBypassed = makeRes();
    await setLienWaiverBypass(req, alreadyBypassed);
    assert.equal(alreadyBypassed.statusCode, 200);
    assert.ok(alreadyBypassed.body.invoice.waiverActions, 'idempotent bypass response retains canonical waiver actions');
    assert.equal(alreadyBypassed.body.invoice.waiverActions.revertBypass.permitted, true);

    const bypassApproved = makeRes();
    await approveInvoice(req, bypassApproved);
    assert.equal(bypassApproved.statusCode, 200);

    const revertBypassRes = makeRes();
    await revertLienWaiverBypass(req, revertBypassRes);
    assert.equal(revertBypassRes.statusCode, 200);
    assert.equal(revertBypassRes.body.invoice.lienWaiverRequired, true);
    assert.equal(revertBypassRes.body.invoice.lienWaiverStatus, 'missing');
    assert.ok(revertBypassRes.body.invoice.waiverActions, 'revert response retains canonical waiver actions');
    assert.equal(revertBypassRes.body.invoice.waiverActions.bypass.permitted, true);
    assert.equal(revertBypassRes.body.invoice.waiverActions.revertBypass.permitted, false);

    const alreadyRequired = makeRes();
    await revertLienWaiverBypass(req, alreadyRequired);
    assert.equal(alreadyRequired.statusCode, 200);
    assert.ok(alreadyRequired.body.invoice.waiverActions, 'idempotent bypass revert response retains canonical waiver actions');
    assert.equal(alreadyRequired.body.invoice.waiverActions.bypass.permitted, true);

    row = { ...row, status: 'pending', approved_at: null, approved_by: null };
    const afterBypassRevertApprove = makeRes();
    await approveInvoice(req, afterBypassRevertApprove);
    assert.equal(afterBypassRevertApprove.statusCode, 400);
    assert.deepEqual(afterBypassRevertApprove.body.details.missing, ['linked_lien_waiver_id']);

    const setRes = makeRes();
    await setWaiverOverride(req, setRes);
    assert.equal(setRes.statusCode, 200);
    assert.equal(setRes.body.waiverOverride.active, true);
    assert.equal(setRes.body.waiverOverride.by, 'ap@example.com');
    assert.ok(setRes.body.invoice.waiverActions, 'Attached response retains canonical waiver actions');
    assert.equal(setRes.body.invoice.waiverActions.markOnDocument.permitted, false);
    assert.equal(setRes.body.invoice.waiverActions.clearOnDocument.permitted, true);

    const alreadyAttached = makeRes();
    await setWaiverOverride(req, alreadyAttached);
    assert.equal(alreadyAttached.statusCode, 200);
    assert.ok(alreadyAttached.body.invoice.waiverActions, 'idempotent Attached response retains canonical waiver actions');
    assert.equal(alreadyAttached.body.invoice.waiverActions.clearOnDocument.permitted, true);

    const approved = makeRes();
    await approveInvoice(req, approved);
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.body.invoice.status, 'approved');

    const revertRes = makeRes();
    await revertWaiverOverride(req, revertRes);
    assert.equal(revertRes.statusCode, 200);
    assert.equal(revertRes.body.waiverOverride.active, false);
    assert.ok(revertRes.body.invoice.waiverActions, 'clear Attached response retains canonical waiver actions');
    assert.equal(revertRes.body.invoice.waiverActions.markOnDocument.permitted, true);
    assert.equal(revertRes.body.invoice.waiverActions.clearOnDocument.permitted, false);

    const alreadyClear = makeRes();
    await revertWaiverOverride(req, alreadyClear);
    assert.equal(alreadyClear.statusCode, 200);
    assert.ok(alreadyClear.body.invoice.waiverActions, 'idempotent clear Attached response retains canonical waiver actions');
    assert.equal(alreadyClear.body.invoice.waiverActions.markOnDocument.permitted, true);

    // Re-approval is intentionally guarded from an already-approved status.
    // Simulate the explicit lifecycle reversal that makes the invoice eligible
    // again, then verify that removing Attached restores waiver validation.
    row = { ...row, status: 'pending', approved_at: null, approved_by: null };
    const afterRevertApprove = makeRes();
    await approveInvoice(req, afterRevertApprove);
    assert.equal(afterRevertApprove.statusCode, 400);
    assert.deepEqual(afterRevertApprove.body.details.missing, ['linked_lien_waiver_id']);
  });

  assert.deepEqual(
    calls.legacyAudit
      .filter((entry) => entry.event.startsWith('waiver-override'))
      .map((entry) => entry.actor),
    ['ap@example.com', 'ap@example.com']
  );
  assert.deepEqual(
    calls.legacyAudit
      .filter((entry) => entry.event.startsWith('waiver-bypass'))
      .map((entry) => [entry.event, entry.actor, entry.changes.waiverBypassed]),
    [
      ['waiver-bypass-set', 'ap@example.com', [false, true]],
      ['waiver-bypass-reverted', 'ap@example.com', [true, false]],
    ]
  );
  assert.deepEqual(
    calls.auditEvents
      .filter((entry) => entry.type.startsWith('document.waiver_override'))
      .map((entry) => [entry.type, entry.actor.name, entry.targetType]),
    [
      ['document.waiver_override_set', 'ap@example.com', 'document'],
      ['document.waiver_override_reverted', 'ap@example.com', 'document'],
    ]
  );
  assert.deepEqual(
    calls.auditEvents
      .filter((entry) => entry.type.startsWith('document.waiver_bypass'))
      .map((entry) => [entry.type, entry.actor.name, entry.targetType, entry.changes.waiverBypassed]),
    [
      ['document.waiver_bypass_set', 'ap@example.com', 'document', [false, true]],
      ['document.waiver_bypass_reverted', 'ap@example.com', 'document', [true, false]],
    ]
  );
});
