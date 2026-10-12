'use strict';

const {
  emitInvoiceAuditEvent,
  emitLegacyInvoiceAuditEvent,
} = require('../../../lib/auditEvents');
const { DISCARD_PROTECTED_STATUSES } = require('./statusConstants');
const { maybeCacheJunkFromDiscard } = require('./junkFilterService');

function pickDiscardState(row, { includeFilingState = false } = {}) {
  return {
    status: row.status,
    discarded_at: row.discarded_at || null,
    discarded_by: row.discarded_by || null,
    ...(includeFilingState ? {
      filed: row.filed === true,
      filed_at: row.filed_at || null,
    } : {}),
  };
}

function auditRequestForActor(actor) {
  return {
    user: {
      email: actor,
      userId: actor,
      role: 'system',
    },
  };
}

async function clearLinkedWaiverShelfState({
  db,
  id,
  row,
  actor,
  reason,
  req,
  res,
  outcome,
}) {
  const beforeState = pickDiscardState(row, { includeFilingState: true });
  await db.query(
    `UPDATE documents
     SET filed = false,
         filed_at = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [id]
  );
  const updatedRow = (await db.query('SELECT * FROM documents WHERE id = $1', [id])).rows[0];
  const changes = {
    filed: [true, false],
    filedAt: [row.filed_at || null, null],
    reason,
  };
  await emitLegacyInvoiceAuditEvent(id, 'waiver-shelf-cleared', changes, actor, db);
  const event = await emitInvoiceAuditEvent(req || auditRequestForActor(actor), res || {}, {
    type: 'invoice.unfiled',
    invoiceId: id,
    row,
    changes,
    beforeState,
    afterState: pickDiscardState(updatedRow, { includeFilingState: true }),
    undoable: false,
    summary: 'Linked lien waiver removed from document shelf',
    severity: 'info',
    client: db,
  });
  return {
    id,
    outcome,
    status: row.status,
    row,
    updatedRow,
    beforeState,
    event,
    repairedShelfState: true,
  };
}

/**
 * Discard a document using the caller's transaction client. The mutation and
 * both audit records enlist in that transaction, so a failed audit cannot
 * strand a discarded row without its undo record.
 */
async function discardDocumentInTransaction({
  db,
  id,
  actor = 'system',
  reason = '',
  req,
  res,
  lockedRow,
  legacyChanges,
  summary,
  clearFilingState = false,
}) {
  const row = lockedRow || (await db.query(
    'SELECT * FROM documents WHERE id = $1 FOR UPDATE',
    [id]
  )).rows[0];

  if (!row) return { id, outcome: 'not_found' };
  const shouldClearFilingState = clearFilingState
    || (row.classification === 'lien-waiver' && Boolean(row.linked_lien_waiver_id));
  if (row.status === 'discarded') {
    if (!clearFilingState || row.filed !== true) {
      return { id, outcome: 'already_discarded', row };
    }
    return clearLinkedWaiverShelfState({
      db, id, row, actor, reason, req, res, outcome: 'already_discarded',
    });
  }
  if (DISCARD_PROTECTED_STATUSES.has(row.status)) {
    // A protected waiver keeps both its terminal status and its shelf state.
    // Direct discard remains zero-write, and parent submission does not put a
    // previously submitted waiver back into the active queue.
    return { id, outcome: 'protected', status: row.status, row };
  }

  const beforeState = pickDiscardState(row, { includeFilingState: shouldClearFilingState });
  const updated = await db.query(
    `UPDATE documents
     SET status = 'discarded',
         discarded_at = NOW(),
         discarded_by = $1,
         discard_source = 'manual',
         ${shouldClearFilingState ? 'filed = false,\n         filed_at = NULL,' : ''}
         updated_at = NOW()
     WHERE id = $2 AND status <> ALL($3::text[])`,
    [actor, id, [...DISCARD_PROTECTED_STATUSES]]
  );
  if (updated.rowCount === 0) return { id, outcome: 'raced', row };

  // Junk-cache hook: discarding an 'other'-classified IMAGE teaches the
  // pipeline's junk fingerprint cache. Best-effort, pool-based (never enlists
  // in — or aborts — this transaction). See junkFilterService.
  await maybeCacheJunkFromDiscard(row);

  const updatedRow = (await db.query('SELECT * FROM documents WHERE id = $1', [id])).rows[0];
  const changes = {
    status: [row.status, 'discarded'],
    reason,
    ...(shouldClearFilingState ? {
      filed: [row.filed === true, false],
      filedAt: [row.filed_at || null, null],
    } : {}),
  };
  await emitLegacyInvoiceAuditEvent(id, 'discarded', legacyChanges || changes, actor, db);
  const event = await emitInvoiceAuditEvent(req || auditRequestForActor(actor), res || {}, {
    type: 'invoice.discarded',
    invoiceId: id,
    row,
    changes,
    beforeState,
    afterState: pickDiscardState(updatedRow, { includeFilingState: shouldClearFilingState }),
    undoable: true,
    summary: summary || 'Invoice discarded',
    severity: 'warning',
    client: db,
  });

  return {
    id,
    outcome: 'discarded',
    row,
    updatedRow,
    beforeState,
    event,
  };
}

async function discardLinkedLienWaiverForSubmittedInvoice({ db, invoiceId, waiverId }) {
  if (!waiverId) return { outcome: 'no_link' };

  const waiver = (await db.query(
    'SELECT * FROM documents WHERE id = $1 FOR UPDATE',
    [waiverId]
  )).rows[0];
  if (!waiver) return { id: waiverId, outcome: 'not_found' };
  if (waiver.classification !== 'lien-waiver') return { id: waiverId, outcome: 'not_lien_waiver' };
  if (waiver.linked_lien_waiver_id !== invoiceId) return { id: waiverId, outcome: 'link_changed' };

  return discardDocumentInTransaction({
    db,
    id: waiverId,
    actor: 'system',
    reason: `Linked invoice ${invoiceId} submitted to Spectrum`,
    lockedRow: waiver,
    summary: 'Lien waiver discarded after linked Spectrum submission',
    clearFilingState: true,
  });
}

module.exports = {
  discardDocumentInTransaction,
  discardLinkedLienWaiverForSubmittedInvoice,
  pickDiscardState,
};
