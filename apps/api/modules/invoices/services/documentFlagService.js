'use strict';

/**
 * Document flagging ("needs attention") — server-side flag state with actor,
 * timestamp, and optional reason. Flag state is defined as `flagged_at IS NOT
 * NULL`; there is no separate boolean for this flag (the pre-existing `flagged`
 * boolean column is an unrelated ingestion/manual-split marker and is left
 * untouched here).
 *
 * Flagging is workflow-neutral: it never changes status and no approve/submit/
 * file eligibility predicate reads these columns. Unflag authorization is
 * enforced at THIS service layer — not only at the route — so any second caller
 * of the service hits the same policy: only the original flagger or a holder of
 * `accounting.invoices.manage_rules` may remove a flag.
 */

const { emitInvoiceAuditEvent, getRequestAuditActor } = require('../../../lib/auditEvents');
const { checkPermission } = require('../../../middleware/permissions');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { pool, rowToDoc } = require('./supabase');
const { withTransaction } = require('./transaction');

const UNFLAG_MANAGE_PERMISSION = 'accounting.invoices.manage_rules';

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function pickFlagState(row) {
  return {
    flagged_at: toIso(row.flagged_at),
    flagged_by: row.flagged_by || null,
    flag_reason: row.flag_reason || null,
  };
}

async function selectDocumentForUpdate(db, id) {
  return db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [id]);
}

async function flagDocument(req, res) {
  try {
    const actor = getRequestAuditActor(req, res);
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : null;

    const outcome = await withTransaction(pool, async (db) => {
      const result = await selectDocumentForUpdate(db, req.params.id);
      if (result.rows.length === 0) return { notFound: true };

      const row = result.rows[0];
      const beforeState = pickFlagState(row);
      await db.query(
        `UPDATE documents
         SET flagged_at = NOW(), flagged_by = $1, flag_reason = $2, updated_at = NOW()
         WHERE id = $3`,
        [actor.name, reason, req.params.id]
      );

      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return { row, updatedRow: updated.rows[0], beforeState };
    });

    if (outcome.notFound) return fail(res, 404, 'Invoice not found');

    const { row, updatedRow, beforeState } = outcome;
    const afterState = pickFlagState(updatedRow);
    const event = await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.flagged',
      invoiceId: req.params.id,
      row,
      changes: {
        flagged_at: [beforeState.flagged_at, afterState.flagged_at],
        flag_reason: [beforeState.flag_reason, afterState.flag_reason],
      },
      beforeState,
      afterState,
      undoable: true,
      summary: reason ? `Flagged for review: ${reason}` : 'Flagged for review',
      severity: 'info',
    });

    return res.json({ invoice: rowToDoc(updatedRow), auditId: event?.id || null });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/flag');
  }
}

async function unflagDocument(req, res) {
  try {
    const actor = getRequestAuditActor(req, res);

    const outcome = await withTransaction(pool, async (db) => {
      const result = await selectDocumentForUpdate(db, req.params.id);
      if (result.rows.length === 0) return { notFound: true };

      const row = result.rows[0];

      // SERVICE-LEVEL authorization: only the original flagger or a
      // manage_rules holder may unflag. Enforced before any write so a refused
      // request leaves the row unchanged.
      const isFlagger = Boolean(row.flagged_by) && Boolean(actor.name) && row.flagged_by === actor.name;
      const canManage = checkPermission(req, UNFLAG_MANAGE_PERMISSION);
      if (!isFlagger && !canManage) {
        return { forbidden: true };
      }

      // Idempotent: nothing to remove.
      if (!row.flagged_at) {
        return { row, updatedRow: row, beforeState: pickFlagState(row), noop: true };
      }

      const beforeState = pickFlagState(row);
      await db.query(
        `UPDATE documents
         SET flagged_at = NULL, flagged_by = NULL, flag_reason = NULL, updated_at = NOW()
         WHERE id = $1`,
        [req.params.id]
      );

      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return { row, updatedRow: updated.rows[0], beforeState };
    });

    if (outcome.notFound) return fail(res, 404, 'Invoice not found');
    if (outcome.forbidden) {
      return fail(
        res,
        403,
        'Only the user who flagged this document or a rules manager can remove the flag',
        { code: 'FLAG_UNFLAG_FORBIDDEN' }
      );
    }

    const { row, updatedRow, beforeState, noop } = outcome;
    const afterState = pickFlagState(updatedRow);

    if (!noop) {
      await emitInvoiceAuditEvent(req, res, {
        type: 'invoice.unflagged',
        invoiceId: req.params.id,
        row,
        changes: {
          flagged_at: [beforeState.flagged_at, afterState.flagged_at],
          flag_reason: [beforeState.flag_reason, afterState.flag_reason],
        },
        beforeState,
        afterState,
        undoable: true,
        summary: 'Flag removed',
        severity: 'info',
      });
    }

    return res.json({ invoice: rowToDoc(updatedRow) });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/unflag');
  }
}

module.exports = { flagDocument, unflagDocument };
