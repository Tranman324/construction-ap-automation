'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  if (relativePath === 'modules/invoices/services/invoiceStatusService.js') {
    delete require.cache[require.resolve(path.join(root, 'modules/invoices/services/documentDiscardService.js'))];
  }
  return require(resolved);
}

function freshPrivateStatusService() {
  const filename = path.join(root, 'modules/invoices/services/invoiceStatusService.js');
  const privateModule = new Module(filename, module);
  privateModule.filename = filename;
  privateModule.paths = Module._nodeModulePaths(path.dirname(filename));
  privateModule._compile(
    `${fs.readFileSync(filename, 'utf8')}\nmodule.exports.__testUnfileDocument = unfileDocument;`,
    filename
  );
  return privateModule.exports;
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

function documentRow(status, overrides = {}) {
  return {
    id: 'doc-1', status, classification: 'invoice', invoice_number: 'INV-1', vendor_code: 'VEND-1',
    amount: 100, description: 'Original description', discarded_at: null, discarded_by: null, was_modified: false,
    ...overrides,
  };
}

function makePool(row, calls, { beforeLockedSelect, beforeGuardedUpdate } = {}) {
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (/SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) {
      beforeLockedSelect?.(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/SELECT classification, file_name, linked_lien_waiver_id FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) {
      beforeLockedSelect?.(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row], rowCount: 1 };
    if (/UPDATE documents/.test(sql)) {
      if (/status <> ALL\(\$\d+::text\[\]\)/.test(sql)) {
        beforeGuardedUpdate?.(row);
        const protectedStatuses = params.find(Array.isArray) || [];
        if (protectedStatuses.includes(row.status)) return { rows: [], rowCount: 0 };
        if (/status <> \$\d+/.test(sql) && params.includes(row.status)) return { rows: [], rowCount: 0 };
      }
      if (/status = 'discarded'/.test(sql) || /SET status = \$1,\s+discarded_at/.test(sql)) {
        row.status = 'discarded';
        if (/filed = false/.test(sql)) {
          row.filed = false;
          row.filed_at = null;
        }
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE documents SET/.test(sql)) {
        if (/description = \$1/.test(sql)) row.description = params[0];
        row.was_modified = true;
        return { rows: [], rowCount: 1 };
      }
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
  return { query, async connect() { return { query, release() {} }; } };
}

function auditEvents(eventCalls, { legacyCalls, undoCalls, undoAction, stateCheck } = {}) {
  return {
    checkStateMatch: () => stateCheck || ({ match: true, staleFields: [] }),
    emitInvoiceAuditEvent: async (...args) => { eventCalls.push(args); return { id: 'event-1' }; },
    findUndoableAction: async () => undoAction || null,
    getRequestAuditActor: () => ({ name: 'reviewer@example.com', userId: 'reviewer', role: null }),
    emitLegacyInvoiceAuditEvent: async (...args) => { legacyCalls?.push(args); },
    insertAuditEvent: async () => ({ id: 'event-1' }),
    markActionUndone: async (...args) => { undoCalls?.push(args); },
  };
}

async function runStaleStatusUndo(operation) {
  const rowByOperation = {
    unreviewInvoice: documentRow('reviewed', { reviewed_at: new Date('2026-07-16T00:00:00.000Z') }),
    unfileDocument: documentRow('pending', { filed: true, filed_at: new Date('2026-07-16T00:00:00.000Z') }),
    unreconcileInvoice: documentRow('approved', { reconciled: true, reconciled_at: new Date('2026-07-16T00:00:00.000Z') }),
  };
  const row = rowByOperation[operation];
  const calls = [];
  const eventCalls = [];
  const res = makeRes();
  const action = {
    id: `${operation}-action`,
    afterState: { status: 'different' },
    beforeState: { status: 'pending', filed: false, reconciled: false },
  };

  await withMockedModules({
    './supabase': { pool: makePool(row, calls), audit: async () => {}, rowToDoc: (value) => value, getWaiverActionSerializationOptions: () => ({}) },
    './sharepointUndoService': { deleteFiledSharePointCopy: async () => ({ deleted: true }) },
    '../../../lib/auditEvents': auditEvents(eventCalls, {
      undoAction: action,
      stateCheck: { match: false, staleFields: ['status'] },
    }),
    '../../../middleware/errorResponse': { safeError: (response, error) => response.status(500).json({ error: error.message }) },
  }, async () => {
    const service = operation === 'unfileDocument'
      ? freshPrivateStatusService()
      : freshRequire('modules/invoices/services/invoiceStatusService.js');
    const handler = operation === 'unfileDocument' ? service.__testUnfileDocument : service[operation];
    await handler({ params: { id: row.id }, user: { email: 'reviewer@example.com' }, log: { warn() {} } }, res);
  });

  return { calls, eventCalls, res };
}

async function runSingleDiscard(status, { beforeLockedSelect, beforeGuardedUpdate } = {}) {
  const row = documentRow(status); const calls = []; const auditCalls = []; const eventCalls = []; const res = makeRes();
  await withMockedModules({
    './supabase': { pool: makePool(row, calls, { beforeLockedSelect, beforeGuardedUpdate }), audit: async (...args) => auditCalls.push(args), rowToDoc: (value) => value, getWaiverActionSerializationOptions: () => ({}) },
    './sharepointUndoService': { deleteFiledSharePointCopy: async () => {} },
    '../../../lib/auditEvents': auditEvents(eventCalls, { legacyCalls: auditCalls }),
    '../../../middleware/errorResponse': { safeError: (response, error) => response.status(500).json({ error: error.message }) },
  }, async () => {
    const { discardInvoice } = freshRequire('modules/invoices/services/invoiceStatusService.js');
    await discardInvoice({ params: { id: row.id }, body: { reason: 'duplicate' } }, res);
  });
  return { row, calls, auditCalls, eventCalls, res };
}

async function runBulkDiscard(status, { beforeLockedSelect, beforeGuardedUpdate, rowOverrides = {} } = {}) {
  const row = documentRow(status, rowOverrides); const calls = []; const auditCalls = []; const eventCalls = []; const res = makeRes();
  await withMockedModules({
    './supabase': { pool: makePool(row, calls, { beforeLockedSelect, beforeGuardedUpdate }), audit: async (...args) => auditCalls.push(args), getWaiverActionSerializationOptions: () => ({}) },
    '../../../lib/auditEvents': auditEvents(eventCalls, { legacyCalls: auditCalls }),
    '../../../middleware/permissions': { checkPermission: () => true },
    '../../../middleware/errorResponse': { safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
  }, async () => {
    const { bulkAction } = freshRequire('modules/invoices/services/bulkActionService.js');
    await bulkAction({ body: { ids: [row.id], action: 'discard' } }, res);
  });
  return { row, calls, auditCalls, eventCalls, res };
}

async function runEdit(body, { status = 'submitted', rowOverrides = {} } = {}) {
  const row = documentRow(status, rowOverrides); const calls = []; const auditCalls = []; const eventCalls = []; const res = makeRes();
  await withMockedModules({
    './supabase': { pool: makePool(row, calls), audit: async (...args) => auditCalls.push(args), rowToDoc: (value) => value, getWaiverActionSerializationOptions: () => ({}) },
    './matcher': {
      recordJobFeedback() {}, recordSubcontractFeedback() {}, recordVendorFeedback() {},
      recordSubjectJobFeedback() {}, recordSenderJobFeedback() {},
    },
    '../routes/settings': { getActiveClassificationNames: async () => new Set(['invoice', 'receipt', 'lien-waiver']) },
    '../../../lib/auditEvents': auditEvents(eventCalls),
    '../../../middleware/errorResponse': { safeError: (response, error) => response.status(500).json({ error: error.message }) },
  }, async () => {
    const { updateInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    await updateInvoice({ params: { id: row.id }, body, user: { email: 'reviewer@example.com' }, log: { info() {}, warn() {} } }, res);
  });
  return { row, calls, auditCalls, eventCalls, res };
}

async function runReclassify({ rowOverrides = {}, classification = 'receipt', activeNames = ['invoice', 'receipt', 'lien-waiver'], spawnCalls = null } = {}) {
  const row = documentRow('pending', rowOverrides); const calls = []; const auditCalls = []; const res = makeRes();
  const mocks = {
    './supabase': { pool: makePool(row, calls), audit: async (...args) => auditCalls.push(args), rowToDoc: (value) => value, getWaiverActionSerializationOptions: () => ({}) },
    '../../../lib/invoiceAuditActor': { resolveActor: async () => ({ userId: 'reviewer', name: 'Reviewer', role: 'ap' }) },
    '../../../lib/auditEvents': auditEvents(calls),
    '../routes/settings': { getActiveClassificationNames: async () => new Set(activeNames) },
    '../../../middleware/errorResponse': { safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
  };
  if (spawnCalls) mocks.child_process = { spawn: (...args) => { spawnCalls.push(args); return { unref() {} }; } };
  await withMockedModules(mocks, async () => {
    const { reclassifyInvoice } = freshRequire('modules/invoices/services/invoiceStatusService.js');
    await reclassifyInvoice({
      params: { id: row.id },
      body: { classification },
      user: { email: 'reviewer@example.com' },
      log: { info() {}, warn() {} },
    }, res);
  });
  return { row, calls, auditCalls, res };
}

async function runUnedit({ status = 'submitted', beforeLockedSelect, beforeGuardedUpdate, action } = {}) {
  const row = documentRow(status); const calls = []; const auditCalls = []; const eventCalls = []; const undoCalls = []; const res = makeRes();
  const undoAction = action || {
    id: 'edit-action-1',
    afterState: { amount: 120 },
    beforeState: { amount: 100 },
  };
  await withMockedModules({
    './supabase': { pool: makePool(row, calls, { beforeLockedSelect, beforeGuardedUpdate }), audit: async (...args) => auditCalls.push(args), rowToDoc: (value) => value, getWaiverActionSerializationOptions: () => ({}) },
    './matcher': {
      recordJobFeedback() {}, recordSubcontractFeedback() {}, recordVendorFeedback() {},
      recordSubjectJobFeedback() {}, recordSenderJobFeedback() {},
    },
    '../../../lib/auditEvents': auditEvents(eventCalls, { undoCalls, undoAction }),
    '../../../middleware/errorResponse': { safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
  }, async () => {
    const { uneditInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    await uneditInvoice({ params: { id: row.id }, user: { email: 'reviewer@example.com' }, log: { info() {}, warn() {} } }, res);
  });
  return { row, calls, auditCalls, eventCalls, undoCalls, res };
}

for (const status of ['split-processing', 'submitting', 'submitted']) {
  test(`single discard rejects ${status} after locking without a write or audit`, async () => {
    const { row, calls, auditCalls, eventCalls, res } = await runSingleDiscard(status);
    assert.equal(res.statusCode, 409); assert.equal(row.status, status);
    assert.match(calls.find((call) => /FOR UPDATE/.test(call.sql)).sql, /FOR UPDATE/);
    assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
    assert.equal(auditCalls.length, 0); assert.equal(eventCalls.length, 0);
  });
  test(`bulk discard rejects ${status} after locking without a write or audit`, async () => {
    const { row, calls, auditCalls, eventCalls, res } = await runBulkDiscard(status);
    assert.equal(res.statusCode, 409); assert.equal(res.body.details.updated, 0);
    assert.equal(res.body.details.skippedInvoices[0].code, status === 'submitted' ? 'INVALID_STATUS_TRANSITION' : 'TRANSIENT_STATUS');
    assert.equal(row.status, status);
    assert.match(calls.find((call) => /FOR UPDATE/.test(call.sql)).sql, /FOR UPDATE/);
    assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
    assert.equal(auditCalls.length, 0); assert.equal(eventCalls.length, 0);
  });
}

test('single and bulk discard commit an allowed pending transition with a guarded update', async () => {
  const single = await runSingleDiscard('pending');
  assert.equal(single.res.statusCode, 200); assert.equal(single.row.status, 'discarded');
  assert.match(single.calls.find((call) => /UPDATE documents/.test(call.sql)).sql, /status <> ALL/);
  assert.equal(single.auditCalls.length, 1); assert.equal(single.eventCalls.length, 1);
  const bulk = await runBulkDiscard('pending');
  assert.equal(bulk.res.body.updated, 1); assert.equal(bulk.row.status, 'discarded');
  assert.match(bulk.calls.find((call) => /UPDATE documents/.test(call.sql)).sql, /status <> ALL/);
  assert.equal(bulk.auditCalls.length, 1); assert.equal(bulk.eventCalls.length, 1);
});

test('bulk discard removes a linked lien waiver from the document shelf', async () => {
  const bulk = await runBulkDiscard('pending', {
    rowOverrides: {
      classification: 'lien-waiver',
      linked_lien_waiver_id: 'invoice-1',
      filed: true,
      filed_at: new Date('2026-08-14T12:00:00.000Z'),
    },
  });

  assert.equal(bulk.res.body.updated, 1);
  assert.equal(bulk.row.status, 'discarded');
  assert.equal(bulk.row.filed, false);
  assert.equal(bulk.row.filed_at, null);
  assert.match(bulk.calls.find((call) => /UPDATE documents/.test(call.sql)).sql, /filed = false/);
});

test('generic edit cannot reclassify either side of a live lien waiver link', async () => {
  const outcome = await runEdit(
    { classification: 'receipt' },
    { status: 'pending', rowOverrides: { linked_lien_waiver_id: 'waiver-1' } }
  );

  assert.equal(outcome.res.statusCode, 409, JSON.stringify(outcome.res.body));
  assert.equal(outcome.res.body.code, 'WAIVER_LINKED_CLASSIFICATION_PROTECTED');
  assert.equal(outcome.row.classification, 'invoice');
  assert.equal(outcome.calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
  assert.equal(outcome.auditCalls.length, 0);
  assert.equal(outcome.eventCalls.length, 0);
});

test('dedicated reclassify cannot change a linked lien waiver classification', async () => {
  const outcome = await runReclassify({
    rowOverrides: { classification: 'lien-waiver', linked_lien_waiver_id: 'invoice-1' },
  });

  assert.equal(outcome.res.statusCode, 409);
  assert.equal(outcome.res.body.code, 'WAIVER_LINKED_CLASSIFICATION_PROTECTED');
  assert.equal(outcome.row.classification, 'lien-waiver');
  assert.equal(outcome.calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
  assert.equal(outcome.auditCalls.length, 0);
});

test('reclassify to coi spawns the detached COI re-extract worker after commit', async () => {
  const spawnCalls = [];
  const outcome = await runReclassify({ classification: 'coi', activeNames: ['invoice', 'coi'], spawnCalls });
  assert.equal(outcome.res.statusCode, 200);
  assert.equal(spawnCalls.length, 1);
  const [command, args, options] = spawnCalls[0];
  assert.equal(command, 'node');
  assert.match(args[0], /modules[\/\\]invoices[\/\\]scripts[\/\\]re-extract\.js$/);
  assert.equal(args[1], 'doc-1');
  assert.equal(options.detached, true);
  assert.ok(fs.existsSync(args[0]), 're-extract.js must exist at the spawned path');
});

test('reclassify to a non-coi target or an already-coi document spawns nothing', async () => {
  for (const scenario of [
    { classification: 'receipt', activeNames: ['invoice', 'receipt'] },
    { classification: 'coi', rowOverrides: { classification: 'coi' }, activeNames: ['coi'] },
  ]) {
    const spawnCalls = [];
    const outcome = await runReclassify({ ...scenario, spawnCalls });
    assert.equal(outcome.res.statusCode, 200);
    assert.equal(spawnCalls.length, 0);
  }
});

test('discard preserves reconciliation state', async () => {
  const row = documentRow('pending', { reconciled: true, reconciled_at: new Date('2026-07-30T00:00:00.000Z') });
  const calls = []; const auditCalls = []; const eventCalls = []; const res = makeRes();
  await withMockedModules({
    './supabase': { pool: makePool(row, calls), audit: async (...args) => auditCalls.push(args), rowToDoc: (value) => value, getWaiverActionSerializationOptions: () => ({}) },
    './sharepointUndoService': { deleteFiledSharePointCopy: async () => {} },
    '../../../lib/auditEvents': auditEvents(eventCalls),
    '../../../middleware/errorResponse': { safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
  }, async () => {
    const { discardInvoice } = freshRequire('modules/invoices/services/invoiceStatusService.js');
    await discardInvoice({ params: { id: row.id }, body: { reason: 'duplicate' } }, res);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(row.status, 'discarded');
  assert.equal(row.reconciled, true);
  assert.equal(row.reconciled_at.toISOString(), '2026-07-30T00:00:00.000Z');
  assert.equal(res.body.invoice.reconciled, true);
});

test('single and bulk discard re-read the locked status after concurrent submission', async () => {
  const injected = (row) => { row.status = 'submitted'; };
  const single = await runSingleDiscard('pending', { beforeLockedSelect: injected });
  assert.equal(single.res.statusCode, 409);
  assert.equal(single.row.status, 'submitted');
  assert.equal(single.calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
  assert.equal(single.auditCalls.length, 0);
  assert.equal(single.eventCalls.length, 0);

  const bulk = await runBulkDiscard('pending', { beforeLockedSelect: injected });
  assert.equal(bulk.res.statusCode, 409);
  assert.equal(bulk.res.body.details.updated, 0);
  assert.equal(bulk.row.status, 'submitted');
  assert.equal(bulk.calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
  assert.equal(bulk.auditCalls.length, 0);
  assert.equal(bulk.eventCalls.length, 0);
});

test('single and bulk discard reject a guarded update invalidated after the lock without audit', async () => {
  const invalidateAfterLock = (row) => { row.status = 'submitted'; };
  const single = await runSingleDiscard('pending', { beforeGuardedUpdate: invalidateAfterLock });
  assert.equal(single.res.statusCode, 409);
  assert.equal(single.res.body.code, 'INVALID_STATUS_TRANSITION');
  assert.equal(single.row.status, 'submitted');
  assert.equal(single.calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 1);
  assert.equal(single.auditCalls.length, 0);
  assert.equal(single.eventCalls.length, 0);

  const bulk = await runBulkDiscard('pending', { beforeGuardedUpdate: invalidateAfterLock });
  assert.equal(bulk.res.statusCode, 409);
  assert.equal(bulk.res.body.details.updated, 0);
  assert.equal(bulk.res.body.details.skippedInvoices[0].code, 'INVALID_STATUS_TRANSITION');
  assert.equal(bulk.row.status, 'submitted');
  assert.equal(bulk.calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 1);
  assert.equal(bulk.auditCalls.length, 0);
  assert.equal(bulk.eventCalls.length, 0);
});

test('submitted invoice rejects a financial unedit after locking without mutation, audit, or undo success', async () => {
  const { row, calls, auditCalls, eventCalls, undoCalls, res } = await runUnedit();
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'SUBMITTED_FINANCIAL_LOCKED');
  assert.deepEqual(res.body.details.lockedFields, ['amount']);
  assert.equal(row.amount, 100);
  assert.match(calls.find((call) => /FOR UPDATE/.test(call.sql)).sql, /FOR UPDATE/);
  assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
  assert.equal(auditCalls.length, 0);
  assert.equal(eventCalls.length, 0);
  assert.equal(undoCalls.length, 0);
});

test('financial unedit rejects a guarded update invalidated after the lock without audit or undo success', async () => {
  const invalidateAfterLock = (row) => { row.status = 'submitted'; };
  const { row, calls, auditCalls, eventCalls, undoCalls, res } = await runUnedit({
    status: 'approved',
    beforeGuardedUpdate: invalidateAfterLock,
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'INVALID_STATUS_TRANSITION');
  assert.equal(row.status, 'submitted');
  assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 1);
  assert.equal(auditCalls.length, 0);
  assert.equal(eventCalls.length, 0);
  assert.equal(undoCalls.length, 0);
});

test('submitted invoice allows a non-financial unedit through the guarded update', async () => {
  const action = {
    id: 'edit-action-1',
    afterState: { description: 'Changed description' },
    beforeState: { description: 'Original description' },
  };
  const { calls, auditCalls, eventCalls, undoCalls, res } = await runUnedit({ action });
  assert.equal(res.statusCode, 200);
  assert.match(calls.find((call) => /UPDATE documents/.test(call.sql)).sql, /status <> ALL/);
  assert.equal(auditCalls.length, 1);
  assert.equal(eventCalls.length, 1);
  assert.equal(undoCalls.length, 1);
});

for (const field of ['amount', 'invoiceNumber', 'vendorCode']) {
  test(`submitted invoice rejects financial ${field} edits without a write or audit`, async () => {
    const value = field === 'amount' ? 101 : `${field}-changed`;
    const { calls, auditCalls, eventCalls, res } = await runEdit({ [field]: value });
    assert.equal(res.statusCode, 409); assert.equal(res.body.code, 'SUBMITTED_FINANCIAL_LOCKED');
    assert.deepEqual(res.body.details.lockedFields, [field]);
    assert.match(calls.find((call) => /FOR UPDATE/.test(call.sql)).sql, /FOR UPDATE/);
    assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
    assert.equal(auditCalls.length, 0); assert.equal(eventCalls.length, 0);
  });
}

// ── subcontract change invalidates phase state (owner ruling 2026-07-24) ──
async function runSubcontractEdit(rowOverrides, body, { isMultiPhase }) {
  const row = documentRow('pending', {
    subcontract_number: 'SUB-OLD',
    phase_allocations: [{ phase_code: '01-100', amount: 100 }],
    multi_phase_candidate: true,
    ...rowOverrides,
  });
  const calls = []; const auditCalls = []; const eventCalls = []; const res = makeRes();
  await withMockedModules({
    './supabase': { pool: makePool(row, calls), audit: async (...args) => auditCalls.push(args), rowToDoc: (value) => value, getWaiverActionSerializationOptions: () => ({}) },
    './matcher': {
      recordJobFeedback() {}, recordSubcontractFeedback() {}, recordVendorFeedback() {},
      recordSubjectJobFeedback() {}, recordSenderJobFeedback() {},
      getSubcontractPhaseInfo: () => ({ isMultiPhase }),
    },
    '../../../lib/auditEvents': auditEvents(eventCalls),
    '../../../middleware/errorResponse': { safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
  }, async () => {
    const { updateInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    await updateInvoice({ params: { id: row.id }, body, user: { email: 'reviewer@example.com' }, log: { info() {}, warn() {} } }, res);
  });
  return { row, calls, auditCalls, res };
}

test('editing subcontract_number clears phase_allocations and recomputes the flag from the NEW sub (multi→single)', async () => {
  const { calls, auditCalls, res } = await runSubcontractEdit({}, { subcontractNumber: 'SUB-NEW' }, { isMultiPhase: false });
  assert.equal(res.statusCode, 200);
  const update = calls.find((c) => /UPDATE documents SET/.test(c.sql));
  assert.match(update.sql, /phase_allocations = \$2/);
  assert.match(update.sql, /multi_phase_candidate = \$3/);
  assert.deepEqual(update.params.slice(0, 3), ['SUB-NEW', null, false]);
  const [, , changes] = auditCalls[0];
  assert.deepEqual(changes.multiPhaseCandidate, [true, false]);
  assert.deepEqual(changes.phaseAllocations, [[{ phase_code: '01-100', amount: 100 }], null]);
});

test('editing subcontract_number single→multi sets the flag true so approval demands an allocation', async () => {
  const { calls } = await runSubcontractEdit(
    { phase_allocations: null, multi_phase_candidate: false },
    { subcontractNumber: 'SUB-NEW' },
    { isMultiPhase: true }
  );
  const update = calls.find((c) => /UPDATE documents SET/.test(c.sql));
  assert.deepEqual(update.params.slice(0, 3), ['SUB-NEW', null, true]);
});

test('clearing the subcontract clears allocations and sets the flag false', async () => {
  const { calls } = await runSubcontractEdit({}, { subcontractNumber: null }, { isMultiPhase: true });
  const update = calls.find((c) => /UPDATE documents SET/.test(c.sql));
  assert.deepEqual(update.params.slice(0, 3), [null, null, false]);
});

test('edits NOT touching the subcontract never write phase_allocations or multi_phase_candidate', async () => {
  const { calls } = await runSubcontractEdit({}, { description: 'note' }, { isMultiPhase: false });
  const update = calls.find((c) => /UPDATE documents SET/.test(c.sql));
  assert.doesNotMatch(update.sql, /phase_allocations/);
  assert.doesNotMatch(update.sql, /multi_phase_candidate/);
});

test('an unchanged subcontract value in the body does not invalidate phase state', async () => {
  const { calls } = await runSubcontractEdit({}, { subcontractNumber: 'SUB-OLD', description: 'note' }, { isMultiPhase: false });
  const update = calls.find((c) => /UPDATE documents SET/.test(c.sql));
  assert.doesNotMatch(update.sql, /phase_allocations/);
  assert.doesNotMatch(update.sql, /multi_phase_candidate/);
});

test('submitted invoice can still receive a non-financial edit through the guarded update', async () => {
  const { row, calls, auditCalls, eventCalls, res } = await runEdit({ description: 'Corrected description' });
  assert.equal(res.statusCode, 200); assert.equal(row.description, 'Corrected description');
  assert.match(calls.find((call) => /UPDATE documents/.test(call.sql)).sql, /status <> ALL/);
  assert.equal(auditCalls.length, 1); assert.equal(eventCalls.length, 1);
});

test('statement vendor save returns the canonical statement lines and server-produced status changes', async () => {
  const row = documentRow('pending', {
    classification: 'statement',
    statement_lines: JSON.stringify([{ id: 'line-1', invoiceNumber: '7552', amount: 10, status: 'not_received', source: 'extracted' }]),
  });
  const calls = []; const auditCalls = []; const eventCalls = []; const res = makeRes();
  const canonicalLines = [{ id: 'line-1', invoiceNumber: '7552', amount: 10, status: 'matched', source: 'extracted' }];
  await withMockedModules({
    './supabase': {
      pool: makePool(row, calls),
      audit: async (...args) => auditCalls.push(args),
      rowToDoc: (value) => ({ id: value.id, statementLines: canonicalLines }),
      getWaiverActionSerializationOptions: () => ({}),
    },
    './matcher': {
      recordJobFeedback() {}, recordSubcontractFeedback() {}, recordVendorFeedback() {},
      recordSubjectJobFeedback() {}, recordSenderJobFeedback() {},
    },
    './statementLineService': {
      rematchStatementLinesForDocument: async () => ({
        statementLines: canonicalLines,
        statusChanges: [{ lineId: 'line-1', invoiceNumber: '7552', status: ['not_received', 'matched'] }],
      }),
    },
    './rematch': { rematchVendorPending: async () => ({ improved: 0, total: 0 }) },
    './approvalStateService': { buildApprovalState: () => ({ blockers: [], permittedActions: [] }) },
    '../../../lib/auditEvents': auditEvents(eventCalls),
    '../../../middleware/errorResponse': { safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
  }, async () => {
    const { updateInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    await updateInvoice({
      params: { id: row.id },
      body: { vendorCode: 'LARK01' },
      user: { email: 'reviewer@example.com' },
      log: { info() {}, warn() {} },
    }, res);
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.invoice.statementLines, canonicalLines);
  assert.deepEqual(res.body.statementLines, canonicalLines);
  assert.deepEqual(res.body.statusChanges, [
    { lineId: 'line-1', invoiceNumber: '7552', status: ['not_received', 'matched'] },
  ]);
  assert.equal(auditCalls.some(([, event]) => event === 'statement-lines-rematched'), true);
});

for (const operation of ['unreviewInvoice', 'unfileDocument', 'unreconcileInvoice']) {
  test(`${operation} emits a canonical stale-action response at the actual response boundary`, async () => {
    const { calls, eventCalls, res } = await runStaleStatusUndo(operation);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, {
      error: 'Document was modified since your action. Undo is no longer safe.',
      code: 'STATE_CHANGED_SINCE_ACTION',
      details: { actionId: `${operation}-action`, staleFields: ['status'] },
    });
    assert.equal(calls.filter((call) => /UPDATE documents/.test(call.sql)).length, 0);
    assert.equal(eventCalls.length, 0);
  });
}

test('the three guarded services import one shared transient-status definition', () => {
  const services = ['invoiceStatusService.js', 'bulkActionService.js', 'invoiceEditService.js'];
  const sources = services.map((name) => fs.readFileSync(path.join(root, 'modules/invoices/services', name), 'utf8'));
  const constants = fs.readFileSync(path.join(root, 'modules/invoices/services/statusConstants.js'), 'utf8');
  assert.equal(sources.flatMap((source) => source.match(/const TRANSIENT_STATUSES\s*=/g) || []).length, 0);
  assert.equal((constants.match(/const TRANSIENT_STATUSES\s*=/g) || []).length, 1);
  for (const source of sources) assert.match(source, /require\('\.\/statusConstants'\)/);
});
