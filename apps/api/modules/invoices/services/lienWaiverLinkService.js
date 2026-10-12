'use strict';

const { fail, failFromBody, safeError } = require('../../../middleware/errorResponse');
const {
  emitInvoiceAuditEvent,
  emitLegacyInvoiceAuditEvent,
} = require('../../../lib/auditEvents');
const {
  deleteMergedPdf,
} = require('./pdfMergeService');
const { pool } = require('./supabase');
const { withTransaction } = require('./transaction');
const {
  restoreLinkedWaiverPending,
} = require('./waiverLinkedStatusService');

async function linkWaiver(req, res) {
  try {
    const invoiceId = req.params.id;
    const { waiverId } = req.body || {};
    if (!waiverId) return fail(res, 400, 'waiverId is required');

    const linkSource = 'manual';
    const outcome = await withTransaction(pool, async (db) => {
      // Lock in a stable order, so concurrent links cannot observe a stale
      // classification or create reciprocal links on the same two documents.
      const documentsResult = await db.query(
        'SELECT * FROM documents WHERE id IN ($1, $2) AND deleted_at IS NULL ORDER BY id FOR UPDATE',
        [invoiceId, waiverId]
      );
      const invoice = documentsResult.rows.find((row) => row.id === invoiceId);
      const waiver = documentsResult.rows.find((row) => row.id === waiverId);
      if (!invoice) return { body: { error: 'Invoice not found' }, statusCode: 404 };
      if (!waiver) return { body: { error: 'Waiver not found' }, statusCode: 404 };
      if (!['invoice', 'pay-application'].includes(invoice.classification)) {
        return {
          body: { error: 'Only invoices and pay applications can be linked to lien waivers', code: 'WAIVER_PARENT_CLASSIFICATION' },
          statusCode: 422,
        };
      }
      if (['approved', 'submitted', 'submitting', 'split-processing', 'discarded'].includes(invoice.status)) {
        return {
          body: {
            error: `Cannot link a lien waiver while the invoice status is "${invoice.status}".`,
            code: 'WAIVER_PARENT_STATUS_PROTECTED',
          },
          statusCode: 409,
        };
      }
      if (invoiceId === waiverId) {
        return {
          body: { error: 'An invoice cannot be linked to itself as a lien waiver', code: 'WAIVER_SAME_DOCUMENT' },
          statusCode: 422,
        };
      }
      if (waiver.classification !== 'lien-waiver') {
        return {
          body: {
            error: 'Selected document is not classified as a lien waiver',
            code: 'WAIVER_CLASSIFICATION_MISMATCH',
          },
          statusCode: 422,
        };
      }
      if (['submitted', 'submitting', 'split-processing', 'discarded'].includes(waiver.status)) {
        return {
          body: {
            error: `Cannot link a lien waiver while the waiver status is "${waiver.status}".`,
            code: 'WAIVER_STATUS_PROTECTED',
          },
          statusCode: 409,
        };
      }
      if (waiver.linked_lien_waiver_id) {
        return { body: { error: 'Waiver is already linked to another invoice' }, statusCode: 409 };
      }
      if (invoice.linked_lien_waiver_id) {
        return { body: { error: 'Invoice already has a linked waiver' }, statusCode: 409 };
      }

      const now = new Date().toISOString();
      await db.query(
        'UPDATE documents SET linked_lien_waiver_id = $1, waiver_link_source = $2, updated_at = $3 WHERE id = $4',
        [waiverId, linkSource, now, invoiceId]
      );
      await db.query(
        `UPDATE documents
         SET linked_lien_waiver_id = $1,
             filed = true,
             filed_at = COALESCE(filed_at, $2),
             updated_at = $2
         WHERE id = $3`,
        [invoiceId, now, waiverId]
      );

      const shelvedAt = waiver.filed_at || now;
      await emitLegacyInvoiceAuditEvent(
        invoiceId,
        'waiver-linked',
        { waiverId, linkedAt: now, source: linkSource },
        'dashboard',
        db
      );
      await emitLegacyInvoiceAuditEvent(
        waiverId,
        'waiver-linked',
        { invoiceId, linkedAt: now, source: linkSource, filed: true, filedAt: shelvedAt },
        'dashboard',
        db
      );
      await emitInvoiceAuditEvent(req, res, {
        type: 'invoice.waiver_linked',
        invoiceId,
        row: invoice,
        changes: { waiverId, linkedAt: now, source: linkSource },
        beforeState: { linked_lien_waiver_id: invoice.linked_lien_waiver_id || null },
        afterState: { linked_lien_waiver_id: waiverId },
        undoable: false,
        summary: 'Lien waiver linked',
        severity: 'info',
        client: db,
      });
      await emitInvoiceAuditEvent(req, res, {
        type: 'invoice.waiver_linked',
        invoiceId: waiverId,
        row: waiver,
        changes: { invoiceId, linkedAt: now, source: linkSource, filed: true, filedAt: shelvedAt },
        beforeState: {
          linked_lien_waiver_id: waiver.linked_lien_waiver_id || null,
          filed: Boolean(waiver.filed),
          filed_at: waiver.filed_at || null,
        },
        afterState: {
          linked_lien_waiver_id: invoiceId,
          filed: true,
          filed_at: shelvedAt,
        },
        undoable: false,
        summary: 'Lien waiver linked to invoice',
        severity: 'info',
        client: db,
      });

      return { invoice, waiver, now };
    });

    if (outcome.body) return failFromBody(res, outcome.statusCode, outcome.body);

    res.json({ success: true, invoiceId, waiverId, linkedAt: outcome.now });
  } catch (err) {
    return safeError(res, err, 'POST /api/invoices/:id/link-waiver');
  }
}

async function unlinkWaiver(req, res) {
  try {
    const invoiceId = req.params.id;
    const outcome = await withTransaction(pool, async (db) => {
      const hintResult = await db.query(
        'SELECT linked_lien_waiver_id FROM documents WHERE id = $1',
        [invoiceId]
      );
      if (hintResult.rows.length === 0) return { body: { error: 'Invoice not found' }, statusCode: 404 };
      const hintedWaiverId = hintResult.rows[0].linked_lien_waiver_id;
      if (!hintedWaiverId) {
        return { body: { error: 'Invoice does not have a linked waiver' }, statusCode: 400 };
      }

      const documentsResult = await db.query(
        'SELECT * FROM documents WHERE id IN ($1, $2) ORDER BY id FOR UPDATE',
        [invoiceId, hintedWaiverId]
      );
      const invoice = documentsResult.rows.find((row) => row.id === invoiceId);
      const waiver = documentsResult.rows.find((row) => row.id === hintedWaiverId);
      if (!invoice) return { body: { error: 'Invoice not found' }, statusCode: 404 };
      if (invoice.status === 'submitted') {
        return { body: { error: 'Cannot unlink — already submitted to Spectrum' }, statusCode: 400 };
      }
      if (invoice.status === 'approved') {
        return {
          body: {
            error: 'Cannot unlink — invoice is approved. Unapprove the invoice first to change its waiver.',
            code: 'WAIVER_PARENT_STATUS_PROTECTED',
          },
          statusCode: 409,
        };
      }
      if (invoice.linked_lien_waiver_id !== hintedWaiverId) {
        return {
          body: { error: 'Lien waiver link changed before it could be removed', code: 'WAIVER_LINK_CHANGED' },
          statusCode: 409,
        };
      }

      const now = new Date().toISOString();
      // Restore legacy status='linked' rows before clearing the reciprocal
      // relationship. Current link writers use the filed shelf state instead.
      if (waiver) {
        await restoreLinkedWaiverPending({
          db,
          invoiceId,
          waiverId: hintedWaiverId,
          req,
          res,
          summary: 'Lien waiver returned to pending after unlink',
        });
      }
      await db.query(
        'UPDATE documents SET linked_lien_waiver_id = NULL, waiver_link_source = NULL, merged_file_path = NULL, updated_at = $1 WHERE id = $2',
        [now, invoiceId]
      );
      if (waiver) {
        await db.query(
          `UPDATE documents
           SET linked_lien_waiver_id = NULL,
               filed = false,
               filed_at = NULL,
               updated_at = $1
           WHERE id = $2`,
          [now, hintedWaiverId]
        );
      }
      await emitLegacyInvoiceAuditEvent(
        invoiceId,
        'waiver-unlinked',
        { waiverId: hintedWaiverId, unlinkedAt: now },
        'dashboard',
        db
      );
      await emitLegacyInvoiceAuditEvent(
        hintedWaiverId,
        'waiver-unlinked',
        { invoiceId, unlinkedAt: now, filed: false, filedAt: null },
        'dashboard',
        db
      );
      await emitInvoiceAuditEvent(req, res, {
        type: 'invoice.waiver_unlinked',
        invoiceId,
        row: invoice,
        changes: { waiverId: hintedWaiverId, unlinkedAt: now },
        beforeState: {
          linked_lien_waiver_id: hintedWaiverId,
          merged_file_path: invoice.merged_file_path || null,
        },
        afterState: {
          linked_lien_waiver_id: null,
          merged_file_path: null,
        },
        undoable: false,
        summary: 'Lien waiver unlinked',
        severity: 'info',
        client: db,
      });
      await emitInvoiceAuditEvent(req, res, {
        type: 'invoice.waiver_unlinked',
        invoiceId: hintedWaiverId,
        row: waiver || { id: hintedWaiverId },
        changes: { invoiceId, unlinkedAt: now, filed: false, filedAt: null },
        beforeState: {
          linked_lien_waiver_id: invoiceId,
          filed: Boolean(waiver?.filed),
          filed_at: waiver?.filed_at || null,
        },
        afterState: {
          linked_lien_waiver_id: null,
          filed: false,
          filed_at: null,
        },
        undoable: false,
        summary: 'Lien waiver unlinked from invoice',
        severity: 'info',
        client: db,
      });
      return { invoice, waiverId: hintedWaiverId, now };
    });

    if (outcome.body) return failFromBody(res, outcome.statusCode, outcome.body);

    const { invoice, waiverId, now } = outcome;
    deleteMergedPdf(invoice.merged_file_path, { invoiceId }, req.log);

    res.json({ success: true, invoiceId, unlinkedAt: now });
  } catch (err) {
    return safeError(res, err, 'DELETE /api/invoices/:id/link-waiver');
  }
}

module.exports = {
  linkWaiver,
  unlinkWaiver,
};
