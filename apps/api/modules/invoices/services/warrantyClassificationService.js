'use strict';

const { emitInvoiceAuditEvent, getRequestAuditActor } = require('../../../lib/auditEvents');
const { errorBody } = require('../../../lib/response');
const { safeError } = require('../../../middleware/errorResponse');
const { pool, rowToDoc } = require('./supabase');
const { resolveFilingValues, warrantyManualValues } = require('./filingValueResolver');
const { withTransaction } = require('./transaction');

const WARRANTY_FIELDS = ['providerKind', 'warrantyType'];

function outcome(status, message, code) {
  return { status, body: errorBody(message, code) };
}

function validPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  if (!keys.length || keys.some((key) => !WARRANTY_FIELDS.includes(key))) return false;
  return keys.every((key) => body[key] === null
    || (typeof body[key] === 'string' && body[key].trim().length > 0 && body[key].length <= 200));
}

function auditState(row, manualValues) {
  const resolved = resolveFilingValues({ ...row, warranty_manual_values: manualValues });
  return {
    manual: manualValues,
    resolved: {
      providerKind: resolved.providerKind,
      warrantyType: resolved.warrantyType,
    },
  };
}

async function updateWarrantyClassification(req, res) {
  try {
    if (!validPatch(req.body)) {
      return res.status(422).json(errorBody('Provide providerKind and/or warrantyType as non-empty strings or null', 'INVALID_WARRANTY_CLASSIFICATION'));
    }

    const result = await withTransaction(pool, async (db) => {
      const found = await db.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [req.params.id]);
      const document = found.rows[0];
      if (!document) return outcome(404, 'Invoice not found', 'INVOICE_NOT_FOUND');
      if (String(document.classification || '').replace(/ /g, '-') !== 'warranty') {
        return outcome(409, 'Document is not classified as warranty', 'CLASSIFICATION_MISMATCH');
      }

      const existing = warrantyManualValues(document);
      const next = { ...existing };
      const actor = getRequestAuditActor(req, res);
      for (const key of WARRANTY_FIELDS) {
        if (!Object.hasOwn(req.body, key)) continue;
        if (req.body[key] === null) delete next[key];
        else next[key] = { value: req.body[key], setBy: actor.name || actor.userId || 'system', setAt: new Date().toISOString() };
      }

      const before = auditState(document, existing);
      const updated = await db.query(
        'UPDATE documents SET warranty_manual_values = $2 WHERE id = $1 RETURNING *',
        [document.id, next],
      );
      const after = auditState(updated.rows[0], next);
      await emitInvoiceAuditEvent(req, res, {
        client: db,
        type: 'document.warranty_classification_updated',
        invoiceId: document.id,
        row: updated.rows[0],
        changes: { warrantyManualValues: [before, after] },
        beforeState: { warrantyManualValues: before },
        afterState: { warrantyManualValues: after },
        summary: 'Warranty classification updated',
      });
      return { status: 200, body: { invoice: rowToDoc(updated.rows[0]) } };
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return safeError(res, error, 'PATCH /api/invoices/:id/warranty-classification');
  }
}

module.exports = {
  WARRANTY_FIELDS,
  auditState,
  updateWarrantyClassification,
};
