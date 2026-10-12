'use strict';

const fs = require('fs');

const { emitInvoiceAuditEvent } = require('../../../lib/auditEvents');
const { fail, safeError } = require('../../../middleware/errorResponse');
const { pool, audit } = require('./supabase');

function getActor(req, res) {
  return res.locals.userEmail || req.user?.email || 'unknown';
}

async function softDeleteInvoice(req, res) {
  try {
    const { reason } = req.body || {};
    const actor = getActor(req, res);
    const result = await pool.query('SELECT id, file_name, deleted_at FROM documents WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const row = result.rows[0];
    if (row.deleted_at) return res.json({ deleted: true, id: req.params.id });

    await pool.query(
      `UPDATE documents
       SET deleted_at = NOW(),
           deleted_by = $1,
           deletion_reason = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [actor, reason || null, req.params.id]
    );

    const changes = { deletedBy: actor, reason: reason || null, fileName: row.file_name || null };
    await audit(req.params.id, 'soft-deleted', changes);
    await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.deleted',
      invoiceId: req.params.id,
      row,
      changes,
      summary: 'Invoice deleted',
      severity: 'warning',
    });

    req.log.info({ invoiceId: req.params.id, actor }, 'Invoice soft-deleted');
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    return safeError(res, err, 'DELETE /api/invoices/:id');
  }
}

async function restoreInvoice(req, res) {
  try {
    const actor = getActor(req, res);
    const result = await pool.query(
      'SELECT id, status, deleted_at, invoice_number, file_name FROM documents WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const row = result.rows[0];
    if (!row.deleted_at) {
      // Not soft-deleted. When the row is instead `status='discarded'` (a stranded
      // ops/legacy discard that still surfaces in the trash view), the trash
      // "Restore" button is the control users actually press — so route it through
      // the undiscard semantics rather than returning a bare 409. Delegates to
      // invoiceStatusService.undiscardInvoice (reused, not duplicated): it performs
      // the real undo when an undoable `invoice.discarded` event exists, or returns
      // the explanatory 422 DISCARD_NOT_UNDOABLE with the row unchanged otherwise.
      // Lazy require keeps the service load order acyclic.
      if (row.status === 'discarded') {
        const { undiscardInvoice } = require('./invoiceStatusService');
        return undiscardInvoice(req, res);
      }
      return fail(res, 409, 'Invoice is not deleted');
    }

    await pool.query(
      `UPDATE documents
       SET deleted_at = NULL,
           deleted_by = NULL,
           deletion_reason = NULL,
           restored_at = NOW(),
           restored_by = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [actor, req.params.id]
    );

    const changes = { restoredBy: actor, priorStatus: row.status };
    await audit(req.params.id, 'restored', changes);
    await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.restored',
      invoiceId: req.params.id,
      row,
      changes,
      summary: 'Invoice restored',
      severity: 'info',
    });

    req.log.info({ invoiceId: req.params.id, actor, priorStatus: row.status }, 'Invoice restored');
    res.json({ restored: true, id: req.params.id, status: row.status });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/restore');
  }
}

async function permanentlyDeleteInvoice(req, res) {
  try {
    const actor = getActor(req, res);
    const result = await pool.query(
      'SELECT file_path, file_name, invoice_number FROM documents WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return fail(res, 404, 'Invoice not found');

    const { file_path: filePath, file_name: fileName } = result.rows[0];
    await emitInvoiceAuditEvent(req, res, {
      type: 'invoice.permanently_deleted',
      invoiceId: req.params.id,
      row: result.rows[0],
      changes: { deletedBy: actor, fileName: fileName || null },
      summary: 'Invoice permanently deleted',
      severity: 'critical',
    });

    req.log.info({ invoiceId: req.params.id, actor, fileName }, 'Invoice hard-deleted');
    await pool.query('DELETE FROM documents WHERE id = $1', [req.params.id]);

    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr) {
        req.log.warn({
          operation: 'invoice.delete.unlink_file',
          context: { invoiceId: req.params.id, filePath },
          error: unlinkErr && unlinkErr.message ? unlinkErr.message : String(unlinkErr),
          err: unlinkErr,
        }, 'File unlink failed during hard-delete');
      }
    }

    res.json({ deleted: true, permanent: true, id: req.params.id });
  } catch (err) {
    return safeError(res, err, 'DELETE /api/invoices/:id/permanent');
  }
}

module.exports = {
  permanentlyDeleteInvoice,
  restoreInvoice,
  softDeleteInvoice,
};
