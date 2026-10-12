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

// Load the REAL rowToDoc by injecting a fake lib/db (avoids createClient at import).
function loadRowToDoc() {
  const dbPath = require.resolve('../../lib/db.js');
  const supabasePath = require.resolve('../../modules/invoices/services/supabase.js');
  const before = { db: require.cache[dbPath], sup: require.cache[supabasePath] };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign(async () => {}, { query: async () => ({ rows: [] }), on() {}, supabase: {} }) };
  delete require.cache[supabasePath];
  const { rowToDoc } = require(supabasePath);
  if (before.db) require.cache[dbPath] = before.db; else delete require.cache[dbPath];
  if (before.sup) require.cache[supabasePath] = before.sup; else delete require.cache[supabasePath];
  return rowToDoc;
}

// ── Waiver workflow-state contract matrix (from PERSISTED fields) ──
test('waiver state fields derive from persisted linkage/filing/release columns', () => {
  const rowToDoc = loadRowToDoc();

  const paired = rowToDoc({ id: 'w1', classification: 'lien-waiver', linked_lien_waiver_id: 'inv-9', filed: true, sp_file_url: 'https://sp/x', status: 'filed', waiver_type: 'Unconditional final' });
  assert.equal(paired.pairingStatus, 'paired');
  assert.equal(paired.filingStatus, 'filed');
  assert.equal(paired.releaseStatus, 'released');
  assert.equal(paired.waiverType, 'Unconditional final');

  const shelved = rowToDoc({ id: 'w2', classification: 'lien-waiver', linked_lien_waiver_id: null, filed: true, sp_file_url: null, status: 'pending' });
  assert.equal(shelved.pairingStatus, 'unpaired');
  assert.equal(shelved.filingStatus, 'shelved');
  assert.equal(shelved.releaseStatus, 'held');

  const unfiled = rowToDoc({ id: 'w3', classification: 'lien-waiver', linked_lien_waiver_id: null, filed: false, sp_file_url: null, status: 'pending' });
  assert.equal(unfiled.pairingStatus, 'unpaired');
  assert.equal(unfiled.filingStatus, 'unfiled');
  assert.equal(unfiled.releaseStatus, 'held');

  // Released via submitted status even without a SharePoint copy.
  const submitted = rowToDoc({ id: 'w4', classification: 'lien-waiver', filed: false, sp_file_url: null, status: 'submitted' });
  assert.equal(submitted.releaseStatus, 'released');
});

test('waiverType is the persisted value only — never a filename/subject heuristic', () => {
  const rowToDoc = loadRowToDoc();
  // No persisted waiver_type, but file_name/subject scream "final unconditional":
  // the backend must return null, NOT infer a type.
  const noType = rowToDoc({ id: 'w5', classification: 'lien-waiver', waiver_type: null, file_name: 'Final Unconditional Waiver.pdf', email_subject: 'final unconditional release' });
  assert.equal(noType.waiverType, null);
});

test('canonical waiver actions are caller-aware and follow the persisted workflow state', () => {
  const rowToDoc = loadRowToDoc();
  const row = {
    id: 'invoice-waiver-actions',
    classification: 'invoice',
    email_message_id: 'source-email',
    lien_waiver_required: true,
    waiver_requested_at: null,
    waiver_on_document: false,
  };

  const denied = rowToDoc(row, { includeWaiverActions: true });
  assert.equal(denied.waiverActions.request.permitted, false);
  assert.equal(denied.waiverActions.markOnDocument.permitted, false);
  assert.equal(denied.waiverActions.bypass.permitted, false);
  assert.deepEqual(denied.waiverActions.request.blockers.map((blocker) => blocker.code), ['WAIVER_REQUEST_FORBIDDEN']);
  assert.deepEqual(denied.waiverActions.markOnDocument.blockers.map((blocker) => blocker.code), ['WAIVER_APPROVAL_FORBIDDEN']);

  const requestOnly = rowToDoc(row, { includeWaiverActions: true, canRequestWaiver: true });
  assert.equal(requestOnly.waiverActions.request.permitted, true);
  assert.equal(requestOnly.waiverActions.resend.permitted, false);
  assert.deepEqual(requestOnly.waiverActions.resend.blockers.map((blocker) => blocker.code), ['WAIVER_REQUEST_NOT_SENT']);
  assert.equal(requestOnly.waiverActions.markOnDocument.permitted, false);

  const afterRequest = rowToDoc({ ...row, waiver_requested_at: new Date('2026-08-03T12:00:00.000Z') }, {
    includeWaiverActions: true,
    canRequestWaiver: true,
    canApproveWaiver: true,
  });
  assert.equal(afterRequest.waiverActions.request.permitted, false);
  assert.deepEqual(afterRequest.waiverActions.request.blockers.map((blocker) => blocker.code), ['WAIVER_REQUEST_ALREADY_SENT']);
  assert.equal(afterRequest.waiverActions.resend.permitted, true);
  assert.equal(afterRequest.waiverActions.markOnDocument.permitted, true);
  assert.equal(afterRequest.waiverActions.clearOnDocument.permitted, false);
  assert.equal(afterRequest.waiverActions.bypass.permitted, true);
  assert.equal(afterRequest.waiverActions.revertBypass.permitted, false);

  // Persistent bypass (2026-08-06): the detection flag stays true; the bypass
  // lives in waiver_bypassed and suppresses the effective requirement.
  const bypassedAndMarked = rowToDoc({ ...row, waiver_bypassed: true, waiver_on_document: true }, {
    includeWaiverActions: true,
    canApproveWaiver: true,
  });
  assert.equal(bypassedAndMarked.waiverActions.markOnDocument.permitted, false);
  assert.equal(bypassedAndMarked.waiverActions.clearOnDocument.permitted, true);
  assert.equal(bypassedAndMarked.waiverActions.bypass.permitted, false);
  assert.equal(bypassedAndMarked.waiverActions.revertBypass.permitted, true);
});

test('invoice detail derives waiver action permissions from the request user', async () => {
  const row = {
    id: 'invoice-waiver-detail',
    classification: 'invoice',
    email_message_id: 'source-email',
    lien_waiver_required: true,
    waiver_requested_at: null,
    waiver_on_document: false,
  };
  const rowToDoc = loadRowToDoc();
  const pool = { query: async () => ({ rows: [row] }) };
  const mocks = {
    './supabase': {
      pool,
      rowToDoc,
      getVendorBypassCounts: async () => ({}),
      getWaiverActionSerializationOptions: (req) => ({
        includeWaiverActions: true,
        canRequestWaiver: req.user?.permissions?.includes('accounting.invoices.request_waiver') === true,
        canApproveWaiver: req.user?.permissions?.includes('accounting.invoices.approve') === true,
      }),
    },
    '../../../middleware/errorResponse': { fail: (res, status, error) => res.status(status).json({ error }), safeError: (res, error) => res.status(500).json({ error: error.message }) },
    '../../../lib/pagination': { getPagination: () => ({ limit: 50, offset: 0 }) },
    './coiComplianceService': { evaluateCoiCompliance: () => ({}) },
  };

  const denied = makeRes();
  await withMockedModules(mocks, async () => {
    const { getInvoice } = freshRequire('modules/invoices/services/invoiceCollectionService.js');
    await getInvoice({ params: { id: row.id }, query: {}, user: { permissions: [] } }, denied);
  });
  assert.equal(denied.statusCode, 200);
  assert.equal(denied.body.waiverActions.request.permitted, false);
  assert.equal(denied.body.waiverActions.bypass.permitted, false);

  const requestOnly = makeRes();
  await withMockedModules(mocks, async () => {
    const { getInvoice } = freshRequire('modules/invoices/services/invoiceCollectionService.js');
    await getInvoice({
      params: { id: row.id },
      query: {},
      user: { permissions: ['accounting.invoices.request_waiver'] },
    }, requestOnly);
  });
  assert.equal(requestOnly.body.waiverActions.request.permitted, true);
  assert.equal(requestOnly.body.waiverActions.bypass.permitted, false);
});

// ── Waived-amount semantics on the edit mutation path ──
function makeEditPool(row) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FOR UPDATE/.test(sql)) return { rows: [row] };
      if (/UPDATE documents SET/.test(sql)) return { rows: [], rowCount: 1 };
      if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row] };
      return { rows: [], rowCount: 1 };
    },
    amountUpdate() { return this.calls.find((c) => /UPDATE documents SET/.test(c.sql)); },
  };
}

async function runEditAmount(amount, { rowStatus = 'pending' } = {}) {
  const row = { id: 'doc-1', status: rowStatus, amount: 100, submit_error: null, was_modified: false, classification: 'lien-waiver' };
  const pool = makeEditPool(row);
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool, audit: async () => {}, rowToDoc: (v) => v, getWaiverActionSerializationOptions: () => ({}) },
    '../../../lib/auditEvents': {
      getRequestAuditActor: () => ({ name: 'u@x.example' }),
      emitInvoiceAuditEvent: async () => ({ id: 'e' }),
      findUndoableAction: async () => null,
      markActionUndone: async () => {},
      checkStateMatch: () => ({ match: true }),
    },
    './matcher': {},
  }, async () => {
    const { updateInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    await updateInvoice({ params: { id: row.id }, body: { amount }, user: { email: 'u@x.example' }, log: { info() {}, warn() {} } }, res);
  });
  return { pool, res };
}

test('an invalid (non-numeric) amount → 422 with the row unchanged (no write)', async () => {
  const { pool, res } = await runEditAmount('not-a-number');
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'INVALID_AMOUNT');
  assert.equal(pool.amountUpdate(), undefined); // no UPDATE ran → row unchanged
});

test('explicit null clears the persisted amount', async () => {
  const { pool, res } = await runEditAmount(null);
  assert.equal(res.statusCode, 200);
  const update = pool.amountUpdate();
  assert.ok(update, 'UPDATE ran');
  assert.match(update.sql, /amount = \$1/);
  assert.equal(update.params[0], null); // amount set to NULL
});

test('a valid numeric string persists (no coercion/strip)', async () => {
  const { pool, res } = await runEditAmount('250.75');
  assert.equal(res.statusCode, 200);
  const update = pool.amountUpdate();
  assert.ok(update);
  assert.equal(update.params[0], '250.75'); // written as provided, not dropped
});

test('a valid number persists', async () => {
  const { pool, res } = await runEditAmount(999.5);
  assert.equal(res.statusCode, 200);
  assert.equal(pool.amountUpdate().params[0], 999.5);
});
