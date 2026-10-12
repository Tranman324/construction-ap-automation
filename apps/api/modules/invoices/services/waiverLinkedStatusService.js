'use strict';

/**
 * Linked-waiver lifecycle (agreed 2026-08-05).
 *
 * When an invoice with a LINKED lien-waiver document is approved, the waiver
 * document moves to status 'linked' — a parked (non-junk) state that removes
 * it from the pending queue. It is NOT 'discarded': submit-time terminal
 * discard (documentDiscardService.discardLinkedLienWaiverForSubmittedInvoice)
 * still happens later and operates on 'linked' rows exactly as it did on
 * 'pending' ones.
 *
 * Unlinking the waiver returns a legacy parked row to 'pending'. Unapproving
 * the invoice does not alter the waiver because the reciprocal link remains.
 *
 * Where 'linked' is (and is not) visible:
 *  - Dashboard queue lists filter status IN (pending/modified/approved/
 *    submitted) → 'linked' naturally excluded.
 *  - Orphan-waiver candidate queries require linked_lien_waiver_id IS NULL →
 *    excluded by linkage regardless of status.
 *  - Trash membership explicitly excludes 'linked' (a parked waiver is not
 *    junk) — see invoiceCollectionService.
 *  - purge.js is retention_settings-driven by status; 'linked' has no
 *    retention rule, so parked waivers are never purged.
 *
 * documents.status has no CHECK constraint (free text), so no migration is
 * required for the new value.
 */

const {
  emitInvoiceAuditEvent,
  emitLegacyInvoiceAuditEvent,
} = require('../../../lib/auditEvents');

// Waiver statuses eligible to be parked as 'linked'. Terminal/transient
// states (discarded, split, submitting, ...) are left untouched.
const PARKABLE_WAIVER_STATUSES = ['pending', 'modified'];

function auditRequestForActor(actor) {
  return {
    user: {
      email: actor,
      userId: actor,
      role: 'system',
    },
  };
}

/**
 * Park a linked lien-waiver document as status 'linked' after its invoice was
 * approved (or after it was linked to an already-approved invoice).
 * Runs on the caller's client/transaction; audits enlist in it.
 */
async function markLinkedWaiverLinked({ db, invoiceId, waiverId, actor = 'system', req, res }) {
  if (!waiverId) return { outcome: 'no_link' };

  const waiver = (await db.query(
    'SELECT * FROM documents WHERE id = $1 FOR UPDATE',
    [waiverId]
  )).rows[0];
  if (!waiver) return { id: waiverId, outcome: 'not_found' };
  if (waiver.classification !== 'lien-waiver') return { id: waiverId, outcome: 'not_lien_waiver' };
  if (waiver.linked_lien_waiver_id !== invoiceId) return { id: waiverId, outcome: 'link_changed' };
  if (waiver.status === 'linked') return { id: waiverId, outcome: 'already_linked' };
  // Filed (shelved) waivers are not in the pending queue — leave them alone.
  if (waiver.filed === true) return { id: waiverId, outcome: 'filed_waiver_left_as_is' };
  if (!PARKABLE_WAIVER_STATUSES.includes(waiver.status)) {
    return { id: waiverId, outcome: 'status_ineligible', status: waiver.status };
  }

  await db.query(
    `UPDATE documents SET status = 'linked', updated_at = NOW() WHERE id = $1`,
    [waiverId]
  );

  const changes = { status: [waiver.status, 'linked'], invoiceId };
  await emitLegacyInvoiceAuditEvent(waiverId, 'waiver-marked-linked', changes, actor, db);
  await emitInvoiceAuditEvent(req || auditRequestForActor(actor), res || {}, {
    type: 'document.waiver_marked_linked',
    invoiceId: waiverId,
    targetType: 'document',
    targetId: waiverId,
    row: waiver,
    changes,
    beforeState: { status: waiver.status },
    afterState: { status: 'linked' },
    // Undo travels through the INVOICE action (unapprove / unlink), which
    // restores the waiver as part of its own flow.
    undoable: false,
    summary: 'Lien waiver parked after linked invoice approval',
    severity: 'info',
    client: db,
  });

  return { id: waiverId, outcome: 'linked', previousStatus: waiver.status };
}

/**
 * Return a legacy parked ('linked') waiver to 'pending' when the reciprocal
 * invoice/waiver link is explicitly removed.
 */
async function restoreLinkedWaiverPending({ db, invoiceId, waiverId, actor = 'system', req, res, summary }) {
  if (!waiverId) return { outcome: 'no_link' };

  const waiver = (await db.query(
    'SELECT * FROM documents WHERE id = $1 FOR UPDATE',
    [waiverId]
  )).rows[0];
  if (!waiver) return { id: waiverId, outcome: 'not_found' };
  if (waiver.classification !== 'lien-waiver') return { id: waiverId, outcome: 'not_lien_waiver' };
  if (waiver.linked_lien_waiver_id !== invoiceId) return { id: waiverId, outcome: 'link_changed' };
  if (waiver.status !== 'linked') return { id: waiverId, outcome: 'not_parked', status: waiver.status };

  await db.query(
    `UPDATE documents SET status = 'pending', updated_at = NOW() WHERE id = $1 AND status = 'linked'`,
    [waiverId]
  );

  const changes = { status: ['linked', 'pending'], invoiceId };
  await emitLegacyInvoiceAuditEvent(waiverId, 'waiver-returned-pending', changes, actor, db);
  await emitInvoiceAuditEvent(req || auditRequestForActor(actor), res || {}, {
    type: 'document.waiver_returned_pending',
    invoiceId: waiverId,
    targetType: 'document',
    targetId: waiverId,
    row: waiver,
    changes,
    beforeState: { status: 'linked' },
    afterState: { status: 'pending' },
    undoable: false,
    summary: summary || 'Lien waiver returned to pending',
    severity: 'info',
    client: db,
  });

  return { id: waiverId, outcome: 'restored' };
}

module.exports = {
  PARKABLE_WAIVER_STATUSES,
  markLinkedWaiverLinked,
  restoreLinkedWaiverPending,
};
