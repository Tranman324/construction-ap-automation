'use strict';

// Server-derived subcontract (owner ruling 2026-08-05): on a vendor/job edit
// the server derives the subcontract from the (vendor, job) pairing — unique
// match attaches, no match clears (direct-to-job), ambiguous clears and
// reports options for a picker. An explicit subcontractNumber in the body
// always wins, and only explicit HUMAN picks are recorded as feedback.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
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

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function documentRow(overrides = {}) {
  return {
    id: 'doc-1', status: 'pending', classification: 'invoice', invoice_number: 'INV-1',
    vendor_code: 'VEND-1', job_match_number: '25-500', subcontract_number: null,
    routing_code: 'LP', amount: 100, description: 'Original description',
    phase_allocations: null, multi_phase_candidate: false,
    discarded_at: null, discarded_by: null, was_modified: false,
    ...overrides,
  };
}

function makePool(row, calls) {
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (/SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [row], rowCount: 1 };
    if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row], rowCount: 1 };
    if (/UPDATE documents SET/.test(sql)) { row.was_modified = true; return { rows: [], rowCount: 1 }; }
    throw new Error(`Unexpected query: ${sql}`);
  }
  return { query, async connect() { return { query, release() {} }; } };
}

function auditEvents(eventCalls) {
  return {
    checkStateMatch: () => ({ match: true, staleFields: [] }),
    emitInvoiceAuditEvent: async (...args) => { eventCalls.push(args); return { id: 'event-1' }; },
    findUndoableAction: async () => null,
    getRequestAuditActor: () => ({ name: 'reviewer@example.com', userId: 'reviewer', role: null }),
    emitLegacyInvoiceAuditEvent: async () => {},
    insertAuditEvent: async () => ({ id: 'event-1' }),
    markActionUndone: async () => {},
  };
}

async function runEdit(body, { rowOverrides = {}, matchResult, phaseInfo } = {}) {
  const row = documentRow(rowOverrides);
  const calls = []; const eventCalls = []; const matchCalls = []; const feedbackCalls = [];
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool: makePool(row, calls), audit: async () => {}, rowToDoc: (value) => value },
    './matcher': {
      matchSubcontract: async (vendorCode, jobNumber) => {
        matchCalls.push([vendorCode, jobNumber]);
        return matchResult || { subcontractNumber: null, confidence: 0, method: 'no-match' };
      },
      getSubcontractPhaseInfo: () => phaseInfo || { isMultiPhase: false },
      recordJobFeedback() {}, recordVendorFeedback() {},
      recordSubjectJobFeedback() {}, recordSenderJobFeedback() {},
      recordSubcontractFeedback: (...args) => { feedbackCalls.push(args); },
    },
    './rematch': { rematchVendorPending: async () => ({ improved: 0, total: 0 }) },
    './submitRouting': { deriveRoutingCode: () => null },
    '../../../lib/auditEvents': auditEvents(eventCalls),
    '../../../middleware/errorResponse': { safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
  }, async () => {
    const { updateInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    await updateInvoice({ params: { id: row.id }, body, user: { email: 'reviewer@example.com' }, log: { info() {}, warn() {} } }, res);
  });
  const update = calls.find((c) => /UPDATE documents SET/.test(c.sql)) || null;
  return { row, calls, update, matchCalls, feedbackCalls, res };
}

test('vendor edit with a unique (vendor, job) match derives and persists the subcontract', async () => {
  const { update, matchCalls, res } = await runEdit(
    { vendorCode: 'VEND-2' },
    { matchResult: { subcontractNumber: 'SC-9', confidence: 0.95, method: 'exact-unique' } }
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(matchCalls, [['VEND-2', '25-500']]);
  assert.match(update.sql, /subcontract_number = \$\d+/);
  assert.equal(update.params.includes('SC-9'), true);
  assert.deepEqual(res.body.subcontractDerivation, {
    method: 'exact-unique',
    subcontractNumber: 'SC-9',
  });
});

test('job edit with no match clears an existing subcontract (direct-to-job)', async () => {
  const { update, matchCalls, res } = await runEdit(
    { jobNumber: '25-200' },
    { rowOverrides: { subcontract_number: 'SC-OLD' } }
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(matchCalls, [['VEND-1', '25-200']]);
  assert.match(update.sql, /subcontract_number = \$\d+/);
  const subIdx = update.sql.match(/subcontract_number = \$(\d+)/)[1] - 1;
  assert.equal(update.params[subIdx], null);
  assert.deepEqual(res.body.subcontractDerivation, { method: 'no-match', subcontractNumber: null });
});

test('ambiguous pairing keeps the current subcontract when it is among the options', async () => {
  const options = [
    { number: 'SC-A', revContract: 100, status: 'Active' },
    { number: 'SC-B', revContract: 200, status: 'Active' },
  ];
  const { update, res } = await runEdit(
    { vendorCode: 'VEND-2' },
    {
      rowOverrides: { subcontract_number: 'SC-B' },
      matchResult: { subcontractNumber: null, confidence: 0.5, method: 'ambiguous', options },
    }
  );
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(update.sql, /subcontract_number/);
  assert.deepEqual(res.body.subcontractDerivation, {
    method: 'ambiguous',
    subcontractNumber: 'SC-B',
    options,
  });
});

test('ambiguous pairing clears a current subcontract that is NOT among the options', async () => {
  const options = [
    { number: 'SC-A', revContract: 100, status: 'Active' },
    { number: 'SC-B', revContract: 200, status: 'Active' },
  ];
  const { update, res } = await runEdit(
    { vendorCode: 'VEND-2' },
    {
      rowOverrides: { subcontract_number: 'SC-STALE' },
      matchResult: { subcontractNumber: null, confidence: 0.5, method: 'ambiguous', options },
    }
  );
  assert.equal(res.statusCode, 200);
  assert.match(update.sql, /subcontract_number = \$\d+/);
  const subIdx = update.sql.match(/subcontract_number = \$(\d+)/)[1] - 1;
  assert.equal(update.params[subIdx], null);
  assert.deepEqual(res.body.subcontractDerivation, {
    method: 'ambiguous',
    subcontractNumber: null,
    options,
  });
});

test('an explicit subcontractNumber in the body wins: no derivation runs', async () => {
  const { update, matchCalls, res } = await runEdit(
    { vendorCode: 'VEND-2', subcontractNumber: 'SC-PICKED' },
    { matchResult: { subcontractNumber: 'SC-DERIVED', confidence: 0.95, method: 'exact-unique' } }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(matchCalls.length, 0);
  assert.equal(update.params.includes('SC-PICKED'), true);
  assert.equal('subcontractDerivation' in res.body, false);
});

test('a derived subcontract write is NOT recorded as feedback', async () => {
  const { feedbackCalls, res } = await runEdit(
    { vendorCode: 'VEND-2' },
    { matchResult: { subcontractNumber: 'SC-9', confidence: 0.95, method: 'exact-unique' } }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(feedbackCalls.length, 0);
});

test('an explicit human subcontract pick IS recorded as feedback', async () => {
  const { feedbackCalls, res } = await runEdit({ subcontractNumber: 'SC-PICKED' });
  assert.equal(res.statusCode, 200);
  assert.equal(feedbackCalls.length, 1);
  assert.equal(feedbackCalls[0][0].subcontractNumber, 'SC-PICKED');
});

test('an explicit subcontract clear is NEVER recorded as feedback (null-cache poison)', async () => {
  const { feedbackCalls, res } = await runEdit(
    { subcontractNumber: '' },
    { rowOverrides: { subcontract_number: 'SC-OLD' } }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(feedbackCalls.length, 0);
});

test('a derivation failure leaves the subcontract untouched and the edit succeeds', async () => {
  const row = documentRow({ subcontract_number: 'SC-OLD' });
  const calls = []; const eventCalls = []; const res = makeRes();
  await withMockedModules({
    './supabase': { pool: makePool(row, calls), audit: async () => {}, rowToDoc: (value) => value },
    './matcher': {
      matchSubcontract: async () => { throw new Error('spectrum file unreadable'); },
      getSubcontractPhaseInfo: () => ({ isMultiPhase: false }),
      recordJobFeedback() {}, recordVendorFeedback() {}, recordSubcontractFeedback() {},
      recordSubjectJobFeedback() {}, recordSenderJobFeedback() {},
    },
    './rematch': { rematchVendorPending: async () => ({ improved: 0, total: 0 }) },
    './submitRouting': { deriveRoutingCode: () => null },
    '../../../lib/auditEvents': auditEvents(eventCalls),
    '../../../middleware/errorResponse': { safeError: (response) => response.status(500).json({ error: 'unexpected' }) },
  }, async () => {
    const { updateInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    await updateInvoice({ params: { id: row.id }, body: { vendorCode: 'VEND-2' }, user: { email: 'reviewer@example.com' }, log: { info() {}, warn() {} } }, res);
  });
  assert.equal(res.statusCode, 200);
  const update = calls.find((c) => /UPDATE documents SET/.test(c.sql));
  assert.doesNotMatch(update.sql, /subcontract_number/);
  assert.equal('subcontractDerivation' in res.body, false);
});

// ── matcher level: a null cached mapping must not block file-based lookup ──

test('matchSubcontract ignores a null cached mapping and falls through to the exact file match', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-derive-'));
  const subsPath = path.join(dir, 'subcontracts.json');
  fs.writeFileSync(subsPath, JSON.stringify([
    { vendor_code: 'VEND-1', job: '25-500', subcontract_number: 'SC-REAL', rev_contract: 5000, status: 'Active' },
  ]));
  try {
    await withMockedModules({
      '../../../lib/db': { query: async () => ({ rows: [{ subcontract_number: null }] }) },
      '../../../lib/logger': { info() {}, warn() {}, error() {}, debug() {} },
      '../../../config': {
        VENDOR_CACHE_PATH: path.join(dir, 'vendor-cache.json'),
        SUBCONTRACT_CACHE_PATH: path.join(dir, 'sub-cache.json'),
        VENDORS_PATH: path.join(dir, 'vendors.json'),
        SUBCONTRACTS_PATH: subsPath,
        JOBS_PATH: path.join(dir, 'jobs.json'),
      },
    }, async () => {
      const { matchSubcontract } = freshRequire('modules/invoices/services/matcher.js');
      const result = await matchSubcontract('VEND-1', '25-500');
      assert.deepEqual(result, { subcontractNumber: 'SC-REAL', confidence: 0.95, method: 'exact-unique' });
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
