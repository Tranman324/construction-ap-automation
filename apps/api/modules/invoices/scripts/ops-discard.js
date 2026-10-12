'use strict';

/**
 * Ops discard — a reusable, restorable way to discard documents from the
 * command line (e.g. dedup sweeps). Unlike a raw `UPDATE ... status='discarded'`
 * (which strands the row: both UI restore paths 409 because there is no undo
 * record), this emits the SAME structured, undoable `invoice.discarded` audit
 * event the app flow emits, so `POST /api/invoices/:id/undiscard` can restore it.
 *
 * Connection: lib/scriptDb.js (single client, guaranteed teardown) for the
 * document read/update. The audit event is emitted through the shared emitter
 * (`lib/auditEvents.js`) so its shape is identical to the app flow's — the same
 * `emitInvoiceAuditEvent` used by invoiceStatusService.discardInvoice. SQL is
 * not duplicated here: the document UPDATE mirrors the app flow's guarded update
 * and the audit INSERT is owned by the emitter.
 */

const { withScriptClient } = require('../../../lib/scriptDb');
const { emitInvoiceAuditEvent } = require('../../../lib/auditEvents');
const { DISCARD_PROTECTED_STATUSES } = require('../services/statusConstants');
const { maybeCacheJunkFromDiscard } = require('../services/junkFilterService');

function pickDiscardState(row) {
  return {
    status: row.status,
    discarded_at: row.discarded_at || null,
    discarded_by: row.discarded_by || null,
  };
}

/**
 * Discard one document via `db` (a scriptDb client or any {query}) and emit the
 * undoable event. Returns a per-document outcome; never throws for expected
 * skips (missing/protected/already-discarded/raced).
 */
async function opsDiscardDocument(db, { id, actor, reason = '' }) {
  const found = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [id]);
  if (found.rows.length === 0) return { id, outcome: 'not_found' };

  const row = found.rows[0];
  if (DISCARD_PROTECTED_STATUSES.has(row.status)) {
    return { id, outcome: 'protected', status: row.status };
  }
  if (row.status === 'discarded') return { id, outcome: 'already_discarded' };

  const beforeState = pickDiscardState(row);
  const updated = await db.query(
    `UPDATE documents
     SET status = 'discarded',
         discarded_at = NOW(),
         discarded_by = $1,
         discard_source = 'manual',
         updated_at = NOW()
     WHERE id = $2 AND status <> ALL($3::text[])`,
    [actor, id, [...DISCARD_PROTECTED_STATUSES]]
  );
  if (updated.rowCount === 0) return { id, outcome: 'raced' };

  // Junk-cache hook: same as the app discard flow (documentDiscardService) —
  // discarding an 'other'-classified image teaches the junk fingerprint cache.
  // Best-effort, pool-based (never enlists in this script's transaction).
  await maybeCacheJunkFromDiscard(row);

  const refetched = await db.query('SELECT * FROM documents WHERE id = $1', [id]);
  const updatedRow = refetched.rows[0];

  // Reuse the shared emitter so findUndoableAction('invoice.discarded') locates
  // this event and /undiscard can restore the row. Synthetic request carries the
  // ops actor into the same actor-derivation the app flow uses.
  const syntheticReq = { user: { email: actor, userId: actor, role: 'ops-script' } };
  const event = await emitInvoiceAuditEvent(syntheticReq, {}, {
    type: 'invoice.discarded',
    invoiceId: id,
    row,
    changes: { status: [row.status, 'discarded'], reason },
    beforeState,
    afterState: pickDiscardState(updatedRow),
    undoable: true,
    summary: reason ? `Invoice discarded (ops): ${reason}` : 'Invoice discarded (ops)',
    severity: 'warning',
  });

  return { id, outcome: 'discarded', auditId: event?.id || null, restoresTo: beforeState.status };
}

async function discardDocuments(db, { ids, actor, reason = '' }) {
  const results = [];
  for (const id of ids) {
    results.push(await opsDiscardDocument(db, { id, actor, reason }));
  }
  return results;
}

function parseArgs(argv) {
  const opts = { ids: [], actor: 'ops-script', reason: '', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--id') { opts.ids.push(argv[++i]); }
    else if (arg === '--ids') { opts.ids.push(...(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)); }
    else if (arg === '--actor') { opts.actor = argv[++i]; }
    else if (arg === '--reason') { opts.reason = argv[++i]; }
    else if (arg === '--dry-run') { opts.dryRun = true; }
  }
  return opts;
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.ids.length === 0) {
    console.error('Usage: node ops-discard.js --id <docId> [--id ...] [--ids a,b,c] [--actor <who>] [--reason <text>]');
    process.exitCode = 1;
    return;
  }
  if (opts.dryRun) {
    console.log(`[dry-run] would discard ${opts.ids.length} document(s) as "${opts.actor}": ${opts.ids.join(', ')}`);
    return;
  }
  const results = await withScriptClient((db) => discardDocuments(db, opts));
  for (const r of results) {
    console.log(JSON.stringify(r));
  }
  const discarded = results.filter((r) => r.outcome === 'discarded').length;
  console.log(`ops-discard: ${discarded}/${results.length} discarded (restorable via /undiscard)`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('ops-discard failed:', err && err.message ? err.message : err);
    process.exitCode = 1;
  });
}

module.exports = { opsDiscardDocument, discardDocuments, parseArgs };
