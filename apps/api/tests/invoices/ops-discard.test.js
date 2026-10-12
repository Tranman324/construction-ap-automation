'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
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
    status(code) { this.statusCode = code; return this; },
    json(body) {
      if (this.statusCode >= 400) assertCanonicalErrorBody(body);
      this.body = body;
      return this;
    },
  };
}

// ── Fake pool with a real in-memory audit_events store, so the INSERT emitted by
// the ops script and the SELECT run by findUndoableAction round-trip for real. ──
function makeAuditStorePool(doc) {
  const auditRows = [];
  return {
    auditRows,
    async query(sql, params = []) {
      if (/FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) {
        return { rows: doc ? [doc] : [], rowCount: doc ? 1 : 0 };
      }
      if (/UPDATE documents\s+SET status = 'discarded'/.test(sql)) {
        doc.status = 'discarded';
        doc.discarded_by = params[0];
        doc.discarded_at = new Date();
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) {
        return { rows: [doc], rowCount: 1 };
      }
      if (/INSERT INTO audit_events/.test(sql)) {
        const row = {
          id: params[0],
          type: params[1],
          timestamp: params[2] || new Date(),
          actor_user_id: params[3],
          actor_name: params[4],
          actor_role: params[5],
          target_type: params[6],
          target_id: params[7],
          target_label: params[8],
          changes: params[9] ? JSON.parse(params[9]) : null,
          before_state: params[10] ? JSON.parse(params[10]) : null,
          after_state: params[11] ? JSON.parse(params[11]) : null,
          undoable: params[12],
          undone_at: null,
          undone_by: null,
          summary: params[13],
          module: params[14],
          severity: params[15],
          created_at: new Date(),
        };
        auditRows.push(row);
        return { rows: [row] };
      }
      if (/FROM audit_events\s+WHERE target_id = \$1/.test(sql)) {
        const [targetId, type] = params;
        const matches = auditRows.filter(
          (r) => r.target_id === targetId && r.type === type && r.undoable === true && r.undone_at === null,
        );
        return { rows: matches };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

// Inject the fake pool into lib/db (so the REAL auditEvents emitter + lookup use
// it), then fresh-require auditEvents and the ops script against it.
async function withAuditRoundTripEnv(pool, fn) {
  const dbPath = resolved('lib/db.js');
  const auditPath = resolved('lib/auditEvents.js');
  const opsPath = resolved('modules/invoices/scripts/ops-discard.js');
  const before = {
    db: require.cache[dbPath],
    audit: require.cache[auditPath],
    ops: require.cache[opsPath],
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
  delete require.cache[auditPath];
  delete require.cache[opsPath];
  try {
    const audit = require(auditPath);
    const ops = require(opsPath);
    return await fn({ audit, ops });
  } finally {
    if (before.db) require.cache[dbPath] = before.db; else delete require.cache[dbPath];
    if (before.audit) require.cache[auditPath] = before.audit; else delete require.cache[auditPath];
    if (before.ops) require.cache[opsPath] = before.ops; else delete require.cache[opsPath];
  }
}

test('an ops-discarded document emits an undoable event that findUndoableAction locates and undo accepts', async () => {
  const doc = { id: 'doc-ops', status: 'pending', discarded_at: null, discarded_by: null, classification: 'invoice', file_name: 'x.pdf' };
  const pool = makeAuditStorePool(doc);

  await withAuditRoundTripEnv(pool, async ({ audit, ops }) => {
    const result = await ops.opsDiscardDocument(pool, { id: 'doc-ops', actor: 'dana@example.com', reason: 'dedup' });
    assert.equal(result.outcome, 'discarded');
    assert.equal(doc.status, 'discarded');
    assert.equal(doc.discarded_by, 'dana@example.com');

    // Drive the REAL undo lookup against the REAL emitted event (round-trip proof).
    const action = await audit.findUndoableAction('doc-ops', 'invoice.discarded');
    assert.ok(action, 'findUndoableAction located the ops-discard event');
    assert.equal(action.type, 'invoice.discarded');
    assert.equal(action.undoable, true);
    assert.equal(action.beforeState.status, 'pending'); // undo restores to pending
    assert.equal(action.afterState.status, 'discarded');
    assert.equal(action.actor.name, 'dana@example.com');

    // The undo-safety state check accepts the current discarded row → undo is safe.
    const stateCheck = audit.checkStateMatch(doc, action.afterState);
    assert.equal(stateCheck.match, true);
  });
});

test('a raw discard with no emitted event is NOT undoable (control: the stranded class the script fixes)', async () => {
  const doc = { id: 'doc-raw', status: 'discarded', discarded_at: new Date(), discarded_by: 'raw-sql' };
  const pool = makeAuditStorePool(doc); // empty audit store — nothing emitted

  await withAuditRoundTripEnv(pool, async ({ audit }) => {
    const action = await audit.findUndoableAction('doc-raw', 'invoice.discarded');
    assert.equal(action, null, 'no undoable event exists for a raw-SQL discard');
  });
});

// ── Graceful degradation: undiscard of a discarded, event-less row. ──
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
  const resolvedPath = require.resolve(path.join(root, relativePath));
  delete require.cache[resolvedPath];
  return require(resolvedPath);
}

test('undiscard of a discarded row with no undo record returns 422 DISCARD_NOT_UNDOABLE, row unchanged', async () => {
  const row = { id: 'doc-legacy', status: 'discarded', discarded_at: new Date(), discarded_by: 'raw-sql', classification: 'invoice' };
  const calls = [];
  const res = makeRes();
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row] };
      return { rows: [], rowCount: 0 };
    },
  };

  await withMockedModules({
    './supabase': { pool, audit: async () => {}, rowToDoc: (value) => value },
    './sharepointUndoService': {},
    '../../../lib/auditEvents': {
      // No undoable event exists for this discarded row.
      findUndoableAction: async () => null,
      checkStateMatch: () => ({ match: true }),
      getRequestAuditActor: () => ({ name: 'reviewer@example.com', userId: 'reviewer', role: null }),
      emitInvoiceAuditEvent: async () => ({ id: 'event-1' }),
      markActionUndone: async () => {},
    },
    '../../../middleware/errorResponse': require('../../middleware/errorResponse'),
  }, async () => {
    const { undiscardInvoice } = freshRequire('modules/invoices/services/invoiceStatusService.js');
    await undiscardInvoice({ params: { id: 'doc-legacy' }, body: {} }, res);
  });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'DISCARD_NOT_UNDOABLE');
  assert.match(res.body.error, /discarded outside the app/);
  // Row untouched: no UPDATE ran.
  assert.equal(row.status, 'discarded');
  assert.equal(calls.filter((c) => /UPDATE documents/.test(c.sql)).length, 0);
});
