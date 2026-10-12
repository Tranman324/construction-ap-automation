'use strict';

const { emitInvoiceAuditEvent, getRequestAuditActor } = require('../../../lib/auditEvents');
const { errorBody } = require('../../../lib/response');
const { safeError } = require('../../../middleware/errorResponse');
const { checkPermission } = require('../../../middleware/permissions');
const { pool, rowToDoc } = require('./supabase');
const { applyManualStatementAttributePatch, resolveStatementAttributes } = require('./statementAttributes');
const { withTransaction } = require('./transaction');

function outcome(status, message, code) {
  return { status, body: errorBody(message, code) };
}

function attributeAuditState(attributes) {
  return {
    manual: attributes?.manual || {},
    resolved: resolveStatementAttributes(attributes),
  };
}

async function updateStatementAttributes(req, res) {
  try {
    const result = await withTransaction(pool, async (db) => {
      const found = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      const document = found.rows[0];
      if (!document) return outcome(404, 'Invoice not found', 'INVOICE_NOT_FOUND');
      if (document.classification !== 'statement') {
        return outcome(409, 'Document is not classified as statement', 'CLASSIFICATION_MISMATCH');
      }

      const actor = getRequestAuditActor(req, res);
      const before = attributeAuditState(document.statement_attributes);
      const statementAttributes = applyManualStatementAttributePatch(
        document.statement_attributes,
        req.body,
        actor
      );
      const after = attributeAuditState(statementAttributes);
      const updated = await db.query(
        'UPDATE documents SET statement_attributes = $2 WHERE id = $1 RETURNING *',
        [document.id, statementAttributes]
      );
      await emitInvoiceAuditEvent(req, res, {
        client: db,
        type: 'document.statement_attributes_updated',
        invoiceId: document.id,
        row: updated.rows[0],
        changes: { statementAttributes: [before, after] },
        beforeState: { statementAttributes: before },
        afterState: { statementAttributes: after },
        summary: 'Statement attributes updated',
      });
      return {
        status: 200,
        body: {
          invoice: rowToDoc(updated.rows[0], {
            includeStatementReconcile: true,
            canReconcile: checkPermission(req, 'accounting.invoices.approve'),
          }),
        },
      };
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return safeError(res, error, 'PATCH /api/invoices/:id/statement-attributes');
  }
}

module.exports = { updateStatementAttributes };
