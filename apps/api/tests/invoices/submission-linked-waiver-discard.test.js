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
  try { return await fn(); } finally { Module._load = originalLoad; }
}

function clearSubmissionModules() {
  for (const relativePath of [
    'modules/invoices/services/submitResult.js',
    'modules/invoices/services/documentDiscardService.js',
  ]) {
    // Keep this test executable against the direct parent, where the discard
    // service did not exist yet. The parent reaches the success assertion and
    // fails because it never issues the discard, rather than failing to load.
    delete require.cache[path.join(root, relativePath)];
  }
}

function spectrumResult(success = true) {
  return {
    Invoice_Number: 'INV-1',
    Vendor_Code: 'VEND-1',
    Success: success,
    ...(success ? {} : { Error_Message: 'Rejected by Spectrum' }),
  };
}

function makePool({ linkedWaiverId = 'waiver-1', waiverStatus = 'pending' } = {}) {
  const calls = [];
  const invoice = { id: 'invoice-1', status: 'submitting', linked_lien_waiver_id: linkedWaiverId };
  const waiver = linkedWaiverId ? {
    id: linkedWaiverId, classification: 'lien-waiver', status: waiverStatus,
    linked_lien_waiver_id: 'invoice-1', discarded_at: null, discarded_by: null,
    filed: true, filed_at: new Date('2026-08-03T11:00:00.000Z'),
  } : null;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (/SELECT linked_lien_waiver_id FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [invoice] };
      if (/SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: waiver ? [waiver] : [] };
      if (/UPDATE documents\s+SET status = 'discarded'/.test(sql)) {
        waiver.status = 'discarded';
        waiver.discarded_by = params[0];
        waiver.discarded_at = new Date('2026-08-03T12:00:00.000Z');
        if (/filed = false/.test(sql)) {
          waiver.filed = false;
          waiver.filed_at = null;
        }
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE documents\s+SET filed = false/.test(sql)) {
        waiver.filed = false;
        waiver.filed_at = null;
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: waiver ? [waiver] : [] };
      if (/WHERE linked_to/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { calls.push({ sql: 'RELEASE', params: [] }); },
  };
  return {
    calls,
    invoice,
    waiver,
    query: (...args) => client.query(...args),
    async connect() { calls.push({ sql: 'CONNECT', params: [] }); return client; },
  };
}

async function runApply({ linkedWaiverId, waiverStatus, success = true } = {}) {
  const pool = makePool({ linkedWaiverId, waiverStatus });
  const events = [];
  const legacyAudits = [];
  const finalizations = [];
  const reverts = [];
  const logs = [];
  const entry = {
    docId: 'invoice-1',
    row: { id: 'invoice-1', invoice_number: 'INV-1', vendor_code: 'VEND-1', linked_lien_waiver_id: linkedWaiverId },
    invoice: { Invoice_Number: 'INV-1', Vendor_Code: 'VEND-1' },
  };

  await withMockedModules({
    './submitState': {
      finalizeSubmittedInvoice: async (_db, id) => { finalizations.push(id); pool.invoice.status = 'submitted'; },
      logSubmitError: (_log, _operation, _context, _message, err) => logs.push({ error: err?.message }),
      normalizeSubmitError: (message, fallback) => message || fallback,
      revertClaimedInvoices: async (_db, ids) => reverts.push(...ids),
    },
    '../../../lib/auditEvents': {
      emitInvoiceAuditEvent: async (_req, _res, event) => { events.push(event); return { id: `event-${events.length}` }; },
      emitLegacyInvoiceAuditEvent: async (...args) => legacyAudits.push(args),
    },
  }, async () => {
    clearSubmissionModules();
    const { applySpectrumResults } = require(path.join(root, 'modules/invoices/services/submitResult.js'));
    pool.results = await applySpectrumResults({
      pool, audit: async () => {}, req: { user: { email: 'reviewer@example.com' } }, res: {},
      now: '2026-08-03T12:00:00.000Z',
      spectrumResp: { statusCode: 200, body: { APInvoices: [spectrumResult(success)] } },
      submissionEntries: [entry], requestLog: { debug() {}, error(entry) { logs.push(entry); } },
    });
  });
  return { ...pool, events, legacyAudits, finalizations, reverts, logs };
}

test('successful Spectrum submission discards its linked lien waiver with system undo audits before the transaction commits', async () => {
  const outcome = await runApply({ linkedWaiverId: 'waiver-1' });

  assert.equal(outcome.results[0].success, true, JSON.stringify({ results: outcome.results, logs: outcome.logs }));
  assert.equal(outcome.waiver.status, 'discarded');
  assert.equal(outcome.waiver.discarded_by, 'system');
  assert.equal(outcome.waiver.filed, false);
  assert.equal(outcome.waiver.filed_at, null);
  assert.deepEqual(outcome.finalizations, ['invoice-1']);
  assert.equal(outcome.legacyAudits.length, 1);
  assert.equal(outcome.legacyAudits[0][3], 'system');
  assert.equal(outcome.events.filter((event) => event.type === 'invoice.discarded').length, 1);
  const discardEvent = outcome.events.find((event) => event.type === 'invoice.discarded');
  assert.ok(discardEvent.client);
  assert.equal(discardEvent.beforeState.filed, true);
  assert.equal(discardEvent.afterState.filed, false);

  const begin = outcome.calls.findIndex((call) => call.sql === 'BEGIN');
  const discard = outcome.calls.findIndex((call) => /UPDATE documents\s+SET status = 'discarded'/.test(call.sql));
  const commit = outcome.calls.findIndex((call) => call.sql === 'COMMIT');
  assert.ok(begin >= 0 && begin < discard && discard < commit);
  assert.equal(outcome.results[0].waiverDiscard, 'discarded');
});

test('ordinary discard of a linked lien waiver also removes it from the document shelf', async () => {
  const db = makePool({ linkedWaiverId: 'waiver-1' });
  const events = [];
  const legacyAudits = [];

  await withMockedModules({
    '../../../lib/auditEvents': {
      emitInvoiceAuditEvent: async (_req, _res, event) => {
        events.push(event);
        return { id: `event-${events.length}` };
      },
      emitLegacyInvoiceAuditEvent: async (...args) => legacyAudits.push(args),
    },
  }, async () => {
    clearSubmissionModules();
    const { discardDocumentInTransaction } = require(path.join(root, 'modules/invoices/services/documentDiscardService.js'));
    const result = await discardDocumentInTransaction({
      db,
      id: 'waiver-1',
      actor: 'reviewer@example.com',
      lockedRow: db.waiver,
    });
    assert.equal(result.outcome, 'discarded');
  });

  assert.equal(db.waiver.status, 'discarded');
  assert.equal(db.waiver.filed, false);
  assert.equal(db.waiver.filed_at, null);
  assert.equal(legacyAudits.length, 1);
  assert.equal(events[0].beforeState.filed, true);
  assert.equal(events[0].afterState.filed, false);
});

test('direct discard refusal cannot unshelf a protected linked lien waiver', async () => {
  const db = makePool({ linkedWaiverId: 'waiver-1', waiverStatus: 'submitted' });
  const events = [];
  const legacyAudits = [];

  await withMockedModules({
    '../../../lib/auditEvents': {
      emitInvoiceAuditEvent: async (_req, _res, event) => {
        events.push(event);
        return { id: `event-${events.length}` };
      },
      emitLegacyInvoiceAuditEvent: async (...args) => legacyAudits.push(args),
    },
  }, async () => {
    clearSubmissionModules();
    const { discardDocumentInTransaction } = require(path.join(root, 'modules/invoices/services/documentDiscardService.js'));
    const result = await discardDocumentInTransaction({
      db,
      id: 'waiver-1',
      actor: 'reviewer@example.com',
      lockedRow: db.waiver,
    });
    assert.equal(result.outcome, 'protected');
  });

  assert.equal(db.waiver.status, 'submitted');
  assert.equal(db.waiver.filed, true);
  assert.equal(db.waiver.filed_at.toISOString(), '2026-08-03T11:00:00.000Z');
  assert.equal(db.calls.some((call) => /UPDATE documents/.test(call.sql)), false);
  assert.equal(legacyAudits.length, 0);
  assert.equal(events.length, 0);
});

test('rejected Spectrum result never finalizes or discards its linked waiver', async () => {
  const outcome = await runApply({ linkedWaiverId: 'waiver-1', success: false });

  assert.equal(outcome.results[0].success, false);
  assert.deepEqual(outcome.finalizations, []);
  assert.deepEqual(outcome.reverts, ['invoice-1']);
  assert.equal(outcome.waiver.status, 'pending');
  assert.equal(outcome.events.filter((event) => event.type === 'invoice.discarded').length, 0);
});

test('successful submission without a link performs no waiver discard or audit', async () => {
  const outcome = await runApply({ linkedWaiverId: null });

  assert.equal(outcome.results[0].success, true, JSON.stringify({ results: outcome.results, logs: outcome.logs }));
  assert.equal(outcome.results[0].waiverDiscard, 'no_link');
  assert.equal(outcome.calls.some((call) => /SET status = 'discarded'/.test(call.sql)), false);
  assert.equal(outcome.legacyAudits.length, 0);
  assert.equal(outcome.events.filter((event) => event.type === 'invoice.discarded').length, 0);
});

test('already-discarded linked waiver repairs shelf state without duplicating the discard audit', async () => {
  const outcome = await runApply({ linkedWaiverId: 'waiver-1', waiverStatus: 'discarded' });

  assert.equal(outcome.results[0].success, true, JSON.stringify({ results: outcome.results, logs: outcome.logs }));
  assert.equal(outcome.results[0].waiverDiscard, 'already_discarded');
  assert.equal(outcome.calls.some((call) => /SET status = 'discarded'/.test(call.sql)), false);
  assert.equal(outcome.waiver.filed, false);
  assert.equal(outcome.waiver.filed_at, null);
  assert.equal(outcome.legacyAudits.length, 1);
  assert.equal(outcome.events.filter((event) => event.type === 'invoice.discarded').length, 0);
  assert.equal(outcome.events.filter((event) => event.type === 'invoice.unfiled').length, 1);
});

test('protected linked waiver keeps its terminal status and remains on the document shelf', async () => {
  const outcome = await runApply({ linkedWaiverId: 'waiver-1', waiverStatus: 'submitted' });

  assert.equal(outcome.results[0].success, true, JSON.stringify({ results: outcome.results, logs: outcome.logs }));
  assert.equal(outcome.results[0].waiverDiscard, 'protected');
  assert.equal(outcome.waiver.status, 'submitted');
  assert.equal(outcome.waiver.filed, true);
  assert.equal(outcome.waiver.filed_at.toISOString(), '2026-08-03T11:00:00.000Z');
  assert.equal(outcome.events.filter((event) => event.type === 'invoice.discarded').length, 0);
  assert.equal(outcome.events.filter((event) => event.type === 'invoice.unfiled').length, 0);
});
