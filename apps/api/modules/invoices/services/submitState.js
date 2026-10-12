'use strict';

const SUBMIT_INVOICE_FIELDS = `
  id, vendor_code, invoice_number, amount, job_number, job_match_number,
  subcontract_number, invoice_date, file_path, merged_file_path,
  gl_account, phase_code, cost_type, routing_code,
  multi_phase_candidate, phase_allocations, linked_lien_waiver_id
`;

// Lien waiver gate (2026-07-14): an invoice that requires a waiver may only be
// submitted when a waiver is explicitly linked, the pipeline detected a waiver
// page embedded in the same PDF, or the manual waiver-on-document override is
// set. Enforced in the claim SQL so gated invoices never enter the 'submitting'
// state — covers detail submit, queue submit, and any future callers of
// claimInvoicesForSubmit. Unlinking a waiver after approval re-blocks
// submission automatically because this is evaluated at claim time.
const WAIVER_GATE_SQL = `(
  lien_waiver_required IS NOT TRUE
  OR waiver_bypassed IS TRUE
  OR linked_lien_waiver_id IS NOT NULL
  OR lien_waiver_status IS NOT DISTINCT FROM 'attached'
  OR waiver_on_document IS TRUE
)`;

const SUBMIT_ERROR_MAX_LENGTH = 500;

function normalizeSubmitError(message, fallback) {
  const source = message || fallback || 'Submission failed';
  return String(source).replace(/\s+/g, ' ').trim().slice(0, SUBMIT_ERROR_MAX_LENGTH);
}

function placeholders(values, offset = 1) {
  return values.map((_, index) => `$${index + offset}`).join(',');
}

function logSubmitError(requestLog, operation, context, message, error) {
  requestLog.error({
    operation,
    context: context || {},
    error: error && error.message ? error.message : String(error || message),
    err: error,
  }, message);
}

async function claimInvoicesForSubmit(queryable, ids, now) {
  if (Array.isArray(ids) && ids.length > 0) {
    const idPlaceholders = placeholders(ids);
    const nowParam = ids.length + 1;
    const result = await queryable.query(
      `UPDATE documents
       SET status = 'submitting', submit_error = NULL, updated_at = $${nowParam}
       WHERE id IN (${idPlaceholders})
         AND status = 'approved'
         AND classification IN ('invoice', 'pay-application')
         AND ${WAIVER_GATE_SQL}
       RETURNING ${SUBMIT_INVOICE_FIELDS}`,
      [...ids, now]
    );

    const order = new Map(ids.map((id, index) => [id, index]));
    return result.rows.sort((left, right) => (
      (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    ));
  }

  const result = await queryable.query(
    `UPDATE documents
     SET status = 'submitting', submit_error = NULL, updated_at = $1
     WHERE status = 'approved'
       AND classification IN ('invoice', 'pay-application')
       AND ${WAIVER_GATE_SQL}
       AND submit_error IS NULL
     RETURNING ${SUBMIT_INVOICE_FIELDS}`,
    [now]
  );
  return result.rows;
}

async function revertClaimedInvoices(queryable, docIds, submitError, requestLog, context = {}) {
  const uniqueDocIds = Array.from(new Set(docIds.filter(Boolean)));
  if (uniqueDocIds.length === 0) return 0;

  try {
    const idPlaceholders = placeholders(uniqueDocIds, 3);
    const result = await queryable.query(
      `UPDATE documents
       SET status = 'approved', submit_error = $1, updated_at = $2
       WHERE id IN (${idPlaceholders})
         AND status = 'submitting'`,
      [
        normalizeSubmitError(submitError, 'Submission failed'),
        new Date().toISOString(),
        ...uniqueDocIds,
      ]
    );
    return result.rowCount || 0;
  } catch (revertErr) {
    logSubmitError(
      requestLog,
      'invoice.submit.revert_claimed',
      { ...context, claimCount: uniqueDocIds.length },
      'Failed to revert claimed invoices after submit failure',
      revertErr
    );
    throw revertErr;
  }
}

async function finalizeSubmittedInvoice(queryable, docId, now) {
  const result = await queryable.query(
    'UPDATE documents SET status = $1, submit_error = NULL, updated_at = $2 WHERE id = $3 AND status = $4',
    ['submitted', now, docId, 'submitting']
  );

  if (result.rowCount !== 1) {
    throw new Error('Claimed invoice was no longer submitting during submit finalization');
  }

  return 1;
}

module.exports = {
  SUBMIT_INVOICE_FIELDS,
  claimInvoicesForSubmit,
  finalizeSubmittedInvoice,
  logSubmitError,
  normalizeSubmitError,
  placeholders,
  revertClaimedInvoices,
};
