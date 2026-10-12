'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { assertCanonicalErrorBody } = require('../helpers/assertCanonicalErrorResponse');

const root = path.resolve(__dirname, '..', '..');

function resolved(relativePath) {
  return require.resolve(path.join(root, relativePath));
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    locals: {},
    status(code) { this.statusCode = code; return this; },
    json(body) {
      if (this.statusCode >= 400) assertCanonicalErrorBody(body);
      this.body = body;
      return this;
    },
  };
}

function makeReq(id) {
  return {
    params: { id },
    body: {},
    user: { email: 'reviewer@example.com' },
    log: { info() {}, warn() {} },
  };
}

// Fake pool shared by lib/db, so the REAL services/supabase pool, the REAL
// auditEvents emitter + findUndoableAction lookup, and BOTH handlers
// (restoreInvoice → undiscardInvoice) round-trip against ONE in-memory store.
function makeDelegationPool(doc, { seedDiscardEvent = false, linkedWaiverShelf = false } = {}) {
  const auditEvents = [];
  const auditLog = [];
  if (seedDiscardEvent) {
    // A genuine undoable invoice.discarded event, DB-column shaped, that the REAL
    // findUndoableAction query below will locate. afterState matches the current
    // discarded row so the undo safety check passes; beforeState.status drives the
    // restored status.
    auditEvents.push({
      id: 'evt-discard-1', type: 'invoice.discarded', timestamp: new Date(), created_at: new Date(),
      actor_user_id: 'dana@example.com', actor_name: 'dana@example.com', actor_role: null,
      target_type: 'invoice', target_id: doc.id, target_label: doc.invoice_number || null,
      changes: {
        status: ['pending', 'discarded'],
        ...(linkedWaiverShelf ? { filed: [true, false] } : {}),
      },
      before_state: {
        status: 'pending',
        ...(linkedWaiverShelf ? { filed: true, filed_at: '2026-08-14T12:00:00.000Z' } : {}),
      },
      after_state: {
        status: 'discarded',
        ...(linkedWaiverShelf ? { filed: false, filed_at: null } : {}),
      },
      undoable: true, undone_at: null, undone_by: null, summary: 'Invoice discarded',
      module: 'invoices', severity: 'info',
    });
  }
  return {
    doc, auditEvents, auditLog,
    async query(sql, params = []) {
      // ── documents reads ──
      if (/SELECT id, status, deleted_at, invoice_number, file_name FROM documents WHERE id = \$1/.test(sql)) {
        return { rows: doc ? [doc] : [], rowCount: doc ? 1 : 0 };
      }
      if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) {
        return { rows: doc ? [doc] : [], rowCount: doc ? 1 : 0 };
      }
      // ── restore (soft-delete) UPDATE ──
      if (/UPDATE documents\s+SET deleted_at = NULL/.test(sql)) {
        doc.deleted_at = null; doc.restored_at = new Date(); doc.restored_by = params[0];
        return { rows: [], rowCount: 1 };
      }
      // ── undiscard UPDATE ──
      if (/UPDATE documents\s+SET status = \$1/.test(sql)) {
        if (/filed = true/.test(sql) && doc.linked_lien_waiver_id !== params[3]) {
          return { rows: [], rowCount: 0 };
        }
        doc.status = params[0]; doc.discarded_at = null; doc.discarded_by = null;
        if (/filed = true/.test(sql)) {
          doc.filed = true;
          doc.filed_at = new Date(params[1]);
        }
        return { rows: [], rowCount: 1 };
      }
      // ── legacy audit_log INSERT (services/supabase.audit) ──
      if (/INSERT INTO audit_log/.test(sql)) {
        auditLog.push({ documentId: params[0], action: params[1] });
        return { rows: [] };
      }
      // ── audit_events INSERT (emitInvoiceAuditEvent) ──
      if (/INSERT INTO audit_events/.test(sql)) {
        const row = {
          id: params[0], type: params[1], timestamp: params[2] || new Date(),
          actor_user_id: params[3], actor_name: params[4], actor_role: params[5],
          target_type: params[6], target_id: params[7], target_label: params[8],
          changes: params[9] ? JSON.parse(params[9]) : null,
          before_state: params[10] ? JSON.parse(params[10]) : null,
          after_state: params[11] ? JSON.parse(params[11]) : null,
          undoable: params[12], undone_at: null, undone_by: null,
          summary: params[13], module: params[14], severity: params[15], created_at: new Date(),
        };
        auditEvents.push(row);
        return { rows: [row] };
      }
      // ── findUndoableAction SELECT ──
      if (/FROM audit_events\s+WHERE target_id = \$1/.test(sql)) {
        const [targetId, type] = params;
        const matches = auditEvents.filter(
          (r) => r.target_id === targetId && r.type === type && r.undoable === true && r.undone_at === null,
        );
        return { rows: matches };
      }
      // ── markActionUndone UPDATE ──
      if (/UPDATE audit_events\s+SET undone_at/.test(sql)) {
        const [undoneBy, actionId] = params;
        const evt = auditEvents.find((r) => r.id === actionId);
        if (evt) { evt.undone_at = new Date(); evt.undone_by = undoneBy; }
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

// Inject the fake pool into lib/db and reload the service chain against it, so the
// delegation runs through the REAL invoiceDeletionService + invoiceStatusService +
// auditEvents (no handler mocked).
async function withDelegationEnv(pool, fn) {
  const paths = {
    db: resolved('lib/db.js'),
    audit: resolved('lib/auditEvents.js'),
    supabase: resolved('modules/invoices/services/supabase.js'),
    status: resolved('modules/invoices/services/invoiceStatusService.js'),
    deletion: resolved('modules/invoices/services/invoiceDeletionService.js'),
  };
  const before = {};
  for (const [k, p] of Object.entries(paths)) before[k] = require.cache[p];
  require.cache[paths.db] = { id: paths.db, filename: paths.db, loaded: true, exports: pool };
  for (const k of ['audit', 'supabase', 'status', 'deletion']) delete require.cache[paths[k]];
  try {
    const deletion = require(paths.deletion);
    return await fn(deletion);
  } finally {
    for (const [k, p] of Object.entries(paths)) {
      if (before[k]) require.cache[p] = before[k]; else delete require.cache[p];
    }
  }
}

// (a) Restore on a discarded row WITH an undoable event → real undiscard round-trip.
test('restore on a discarded row with an undoable event delegates to a REAL undiscard (round-trip)', async () => {
  const doc = {
    id: 'doc-undoable', status: 'discarded', deleted_at: null,
    discarded_at: new Date(), discarded_by: 'dana@example.com',
    invoice_number: '128100', file_name: '128100.pdf', classification: 'invoice',
  };
  const pool = makeDelegationPool(doc, { seedDiscardEvent: true });
  const res = makeRes();

  await withDelegationEnv(pool, async ({ restoreInvoice }) => {
    await restoreInvoice(makeReq('doc-undoable'), res);
  });

  // Delegated to undiscard: real findUndoableAction located the seeded event and
  // the row was undiscarded back to its pre-discard status (not a 409, not a 422).
  assert.equal(res.statusCode, 200);
  assert.equal(doc.status, 'pending');
  assert.equal(doc.discarded_at, null);
  assert.ok(res.body.invoice, 'response carries the undiscarded invoice');
  // The undo event was consumed (marked undone) — proves the real round-trip ran.
  assert.equal(pool.auditEvents.find((e) => e.id === 'evt-discard-1').undone_at !== null, true);
});

test('undiscard restores a still-linked lien waiver to the document shelf', async () => {
  const doc = {
    id: 'waiver-undoable', status: 'discarded', deleted_at: null,
    discarded_at: new Date(), discarded_by: 'reviewer@example.com',
    invoice_number: null, file_name: 'waiver.pdf', classification: 'lien-waiver',
    linked_lien_waiver_id: 'invoice-1', filed: false, filed_at: null,
  };
  const pool = makeDelegationPool(doc, { seedDiscardEvent: true, linkedWaiverShelf: true });
  const res = makeRes();

  await withDelegationEnv(pool, async ({ restoreInvoice }) => {
    await restoreInvoice(makeReq(doc.id), res);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(doc.status, 'pending');
  assert.equal(doc.filed, true);
  assert.equal(doc.filed_at.toISOString(), '2026-08-14T12:00:00.000Z');
});

test('undiscard cannot re-shelf a waiver after its link changed concurrently', async () => {
  const doc = {
    id: 'waiver-raced', status: 'discarded', deleted_at: null,
    discarded_at: new Date(), discarded_by: 'reviewer@example.com',
    invoice_number: null, file_name: 'waiver.pdf', classification: 'lien-waiver',
    linked_lien_waiver_id: 'invoice-new', filed: false, filed_at: null,
  };
  const pool = makeDelegationPool(doc, { seedDiscardEvent: true, linkedWaiverShelf: true });
  const originalQuery = pool.query.bind(pool);
  let selected = false;
  pool.query = async (sql, params) => {
    if (/SELECT \* FROM documents WHERE id = \$1/.test(sql) && !selected) {
      selected = true;
      const snapshot = { ...doc };
      queueMicrotask(() => { doc.linked_lien_waiver_id = null; });
      return { rows: [snapshot], rowCount: 1 };
    }
    await Promise.resolve();
    return originalQuery(sql, params);
  };
  const res = makeRes();

  await withDelegationEnv(pool, async ({ restoreInvoice }) => {
    await restoreInvoice(makeReq(doc.id), res);
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'WAIVER_LINK_CHANGED');
  assert.equal(doc.status, 'discarded');
  assert.equal(doc.filed, false);
});

// (b) Restore on a legacy event-less discarded row → 422 DISCARD_NOT_UNDOABLE, unchanged.
test('restore on a legacy event-less discarded row returns 422 DISCARD_NOT_UNDOABLE, row unchanged', async () => {
  const doc = {
    id: 'doc-legacy', status: 'discarded', deleted_at: null,
    discarded_at: new Date(), discarded_by: 'raw-sql',
    invoice_number: '128100', file_name: '128100.pdf', classification: 'invoice',
  };
  const pool = makeDelegationPool(doc, { seedDiscardEvent: false }); // no undoable event
  const res = makeRes();

  await withDelegationEnv(pool, async ({ restoreInvoice }) => {
    await restoreInvoice(makeReq('doc-legacy'), res);
  });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'DISCARD_NOT_UNDOABLE');
  assert.match(res.body.error, /discarded outside the app/);
  // Row unchanged: still discarded, no undiscard UPDATE ran.
  assert.equal(doc.status, 'discarded');
});

// (c) Genuinely soft-deleted row → existing restore behavior unchanged.
test('restore on a genuinely soft-deleted row still restores (behavior unchanged)', async () => {
  const doc = {
    id: 'doc-deleted', status: 'pending', deleted_at: new Date(), deleted_by: 'reviewer@example.com',
    invoice_number: '200', file_name: '200.pdf', classification: 'invoice',
  };
  const pool = makeDelegationPool(doc);
  const res = makeRes();

  await withDelegationEnv(pool, async ({ restoreInvoice }) => {
    await restoreInvoice(makeReq('doc-deleted'), res);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.restored, true);
  assert.equal(res.body.id, 'doc-deleted');
  assert.equal(doc.deleted_at, null); // soft-delete cleared
});

// (d) Active (not deleted, not discarded) row → 409 unchanged.
test('restore on an active row still returns 409 "Invoice is not deleted"', async () => {
  const doc = {
    id: 'doc-active', status: 'pending', deleted_at: null,
    invoice_number: '300', file_name: '300.pdf', classification: 'invoice',
  };
  const pool = makeDelegationPool(doc);
  const res = makeRes();

  await withDelegationEnv(pool, async ({ restoreInvoice }) => {
    await restoreInvoice(makeReq('doc-active'), res);
  });

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /Invoice is not deleted/);
  assert.equal(doc.status, 'pending'); // unchanged
});
