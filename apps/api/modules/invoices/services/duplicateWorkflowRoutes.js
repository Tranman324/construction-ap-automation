'use strict';
/**
 * Duplicate-workflow route handlers (DUPLICATE-WORKFLOW-SPEC, ratified
 * 2026-09-08): live duplicate-status evaluation and the persistent, audited
 * bypass mutation (waiver-bypass pattern).
 */

const pool = require('../../../lib/db');
const { withTransaction } = require('./transaction');
const { emitLegacyInvoiceAuditEvent, emitInvoiceAuditEvent, getRequestAuditActor } = require('../../../lib/auditEvents');
const { safeError } = require('../../../middleware/errorResponse');
const { evaluateDuplicateStatus } = require('./duplicateStatusService');

const DUPLICATE_BYPASS_FIELDS = ['duplicate_of', 'duplicate_bypassed', 'duplicate_bypassed_at', 'duplicate_bypassed_by'];

function pickState(row, fields) {
  const state = {};
  for (const field of fields) state[field] = row[field];
  return state;
}

function getActorName(req, res) {
  return getRequestAuditActor(req, res).name || 'system';
}

/** GET /api/invoices/:id/duplicate-status */
async function getDuplicateStatus(req, res) {
  try {
    const result = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    const evaluation = await evaluateDuplicateStatus(result.rows[0]);
    return res.json(evaluation);
  } catch (err) {
    return safeError(res, err, 'GET /api/invoices/:id/duplicate-status');
  }
}

/** POST /api/invoices/:id/duplicate-bypass — persistent, audited, idempotent. */
async function setDuplicateBypass(req, res) {
  try {
    const actor = getActorName(req, res);
    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (result.rows.length === 0) return { status: 404, body: { error: 'Document not found' } };

      const row = result.rows[0];
      // Idempotent: an already-bypassed row returns current state unchanged.
      if (row.duplicate_bypassed === true) {
        return { row, updatedRow: row, alreadyBypassed: true };
      }

      // The bypass must cover a real, current signal; evaluate inside the
      // transaction so the audit snapshot matches what the user saw.
      const evaluation = await evaluateDuplicateStatus(row, { db });
      if (evaluation.state === 'none') {
        return { status: 409, body: { error: 'No unresolved duplicate signal to bypass.', code: 'NO_DUPLICATE_SIGNAL' } };
      }

      const beforeState = pickState(row, DUPLICATE_BYPASS_FIELDS);
      await db.query(
        `UPDATE documents
         SET duplicate_bypassed = true,
             duplicate_bypassed_at = NOW(),
             duplicate_bypassed_by = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [actor, req.params.id]
      );
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return { row, beforeState, updatedRow: updated.rows[0], evaluation };
    });

    if (outcome.status) return res.status(outcome.status).json(outcome.body);
    if (outcome.alreadyBypassed) {
      return res.json({ duplicateBypassed: true, at: outcome.row.duplicate_bypassed_at, by: outcome.row.duplicate_bypassed_by });
    }

    const { row, beforeState, updatedRow, evaluation } = outcome;
    // Evidence snapshot rides in the audit entry; re-detection of the SAME
    // match stays bypassed, a NEW distinct match resurrects the banner.
    await emitLegacyInvoiceAuditEvent(req.params.id, 'duplicate-bypass-set', {
      duplicateBypassed: [false, true],
      actor,
      state: evaluation.state,
      evidence: evaluation.evidence,
    }, actor);

    await emitInvoiceAuditEvent(req, res, {
      type: 'document.duplicate_bypass_set',
      invoiceId: req.params.id,
      targetType: 'document',
      targetId: req.params.id,
      row,
      changes: { duplicateBypassed: [false, true] },
      beforeState,
      afterState: pickState(updatedRow, DUPLICATE_BYPASS_FIELDS),
      undoable: true,
      summary: 'Duplicate flag bypassed',
      severity: evaluation.state === 'spectrum' ? 'warning' : 'info',
    });

    return res.json({
      duplicateBypassed: true,
      at: updatedRow.duplicate_bypassed_at,
      by: updatedRow.duplicate_bypassed_by,
      state: evaluation.state,
    });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/duplicate-bypass');
  }
}

/** POST /api/invoices/:id/duplicate-bypass/revert — audited, idempotent. */
async function revertDuplicateBypass(req, res) {
  try {
    const actor = getActorName(req, res);
    const outcome = await withTransaction(pool, async (db) => {
      const result = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (result.rows.length === 0) return { status: 404, body: { error: 'Document not found' } };

      const row = result.rows[0];
      if (row.duplicate_bypassed !== true) {
        return { row, updatedRow: row, notBypassed: true };
      }

      const beforeState = pickState(row, DUPLICATE_BYPASS_FIELDS);
      await db.query(
        `UPDATE documents
         SET duplicate_bypassed = false,
             duplicate_bypassed_at = NULL,
             duplicate_bypassed_by = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [req.params.id]
      );
      const updated = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
      return { row, beforeState, updatedRow: updated.rows[0] };
    });

    if (outcome.status) return res.status(outcome.status).json(outcome.body);
    if (outcome.notBypassed) return res.json({ duplicateBypassed: false });

    const { row, beforeState, updatedRow } = outcome;
    await emitLegacyInvoiceAuditEvent(req.params.id, 'duplicate-bypass-revert', {
      duplicateBypassed: [true, false],
      actor,
    }, actor);

    await emitInvoiceAuditEvent(req, res, {
      type: 'document.duplicate_bypass_revert',
      invoiceId: req.params.id,
      targetType: 'document',
      targetId: req.params.id,
      row,
      changes: { duplicateBypassed: [true, false] },
      beforeState,
      afterState: pickState(updatedRow, DUPLICATE_BYPASS_FIELDS),
      undoable: false,
      summary: 'Duplicate bypass reverted',
      severity: 'info',
    });

    return res.json({ duplicateBypassed: false });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/duplicate-bypass/revert');
  }
}

module.exports = {
  getDuplicateStatus,
  setDuplicateBypass,
  revertDuplicateBypass,
};
