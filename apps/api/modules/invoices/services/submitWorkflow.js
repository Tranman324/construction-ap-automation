'use strict';

const logger = require('../../../lib/logger');
const { pool, audit } = require('./supabase');
const { findSpectrumInvoice, postToSpectrum } = require('./spectrum');
const {
  UNRESOLVABLE_GL_CODE,
  buildSpectrumSubmission,
  validateSubmissionGlAccounts,
} = require('./submitPayload');
const { applySpectrumResults, spectrumInvoiceIdentity } = require('./submitResult');
const {
  claimInvoicesForSubmit,
  logSubmitError,
  revertClaimedInvoices,
} = require('./submitState');
const { getClosedPeriodInfo } = require('./approvalValidator');
const { fail } = require('../../../middleware/errorResponse');

function formatMissingAllocations(missingAllocations) {
  return missingAllocations.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    vendorCode: row.vendor_code,
    subcontractNumber: row.subcontract_number,
    amount: row.amount != null ? parseFloat(row.amount) : null,
  }));
}

async function rejectMissingAllocations({ pool, res, requestLog, claimedIds, missingAllocations }) {
  const detail = `${missingAllocations.length} invoice${missingAllocations.length === 1 ? '' : 's'} must have phase allocations assigned before submission`;
  const formatted = formatMissingAllocations(missingAllocations);

  await revertClaimedInvoices(
    pool,
    claimedIds,
    'Submission validation failed: missing phase allocations',
    requestLog,
    { reason: 'missing_phase_allocations' }
  );

  return fail(res, 400, 'Cannot submit: invoices on multi-phase subcontracts require phase allocation first', {
    detail,
    missingAllocations: formatted,
  });
}

function summarizeSubmitResults(results) {
  const submittedCount = results.filter((result) => result.success).length;
  const failedCount = results.length - submittedCount;
  const message = failedCount > 0
    ? `${submittedCount} submitted, ${failedCount} failed`
    : `${submittedCount} invoice${submittedCount !== 1 ? 's' : ''} submitted to Spectrum`;

  return { submittedCount, message };
}

function formatDuplicateSubmissionIdentities(rows, requestedIds) {
  const duplicatesByIdentity = new Map();
  const requestedIdSet = requestedIds ? new Set(requestedIds) : null;

  for (const row of rows) {
    const identity = spectrumInvoiceIdentity(row);
    if (!identity) continue;

    const matches = duplicatesByIdentity.get(identity) || [];
    matches.push(row);
    duplicatesByIdentity.set(identity, matches);
  }

  return Array.from(duplicatesByIdentity.values())
    .filter((matches) => (
      matches.length > 1
      && (!requestedIdSet || matches.some((row) => requestedIdSet.has(row.id)))
    ))
    .map((matches) => {
      const alreadySubmitted = matches.find((row) => row.status === 'submitted');
      const reason = alreadySubmitted
        ? 'already_submitted'
        : 'batch_duplicate';
      return {
        vendorCode: String(matches[0].vendor_code).trim(),
        invoiceNumber: String(matches[0].invoice_number).trim(),
        documentIds: matches.map((row) => row.id),
        reason,
        documents: matches.map((row) => ({
          id: row.id,
          status: row.status,
          jobNumber: row.job_match_number || row.job_number || null,
          amount: row.amount != null ? Number(row.amount) : null,
        })),
      };
    });
}

async function findSubmissionPreflight(queryable, ids) {
  const requestedIds = Array.isArray(ids) && ids.length > 0 ? ids : null;
  const selectedIdentityFilter = requestedIds
    ? `AND (
         documents.id = ANY($1)
         OR EXISTS (
           SELECT 1
           FROM documents AS selected
           WHERE selected.id = ANY($1)
             AND selected.status = 'approved'
             AND selected.classification IN ('invoice', 'pay-application')
             AND (selected.lien_waiver_required IS NOT TRUE
                  OR selected.waiver_bypassed IS TRUE
                  OR selected.linked_lien_waiver_id IS NOT NULL
                  OR selected.lien_waiver_status IS NOT DISTINCT FROM 'attached'
                  OR selected.waiver_on_document IS TRUE)
             AND TRIM(selected.vendor_code) = TRIM(documents.vendor_code)
             AND TRIM(selected.invoice_number) = TRIM(documents.invoice_number)
         )
       )`
    : 'AND submit_error IS NULL';
  const result = await queryable.query(
    `SELECT id, vendor_code, invoice_number, status, submit_error,
            amount, job_number, job_match_number, subcontract_number,
            invoice_date, file_path, merged_file_path,
            gl_account, phase_code, cost_type, routing_code,
            multi_phase_candidate, phase_allocations
     FROM documents
     WHERE status IN ('approved', 'submitting', 'submitted')
       AND classification IN ('invoice', 'pay-application')
       AND (lien_waiver_required IS NOT TRUE
            OR waiver_bypassed IS TRUE
            OR linked_lien_waiver_id IS NOT NULL
            OR lien_waiver_status IS NOT DISTINCT FROM 'attached'
            OR waiver_on_document IS TRUE)
       ${selectedIdentityFilter}`,
    requestedIds ? [requestedIds] : []
  );

  const requestedIdSet = requestedIds ? new Set(requestedIds) : null;
  const candidateRows = result.rows.filter((row) => (
    row.status === 'approved'
    && (!requestedIdSet || requestedIdSet.has(row.id))
  ));

  return {
    candidateRows,
    duplicateIdentities: formatDuplicateSubmissionIdentities(result.rows, requestedIds),
  };
}

async function findDuplicateSubmissionIdentities(queryable, ids) {
  const { duplicateIdentities } = await findSubmissionPreflight(queryable, ids);
  return duplicateIdentities;
}

// B4 (2026-07-24): pre-flight against Spectrum itself. Vendors reuse bare
// pay-app numbers across projects, so a vendor+invoice-number pair can already
// exist in Spectrum's AP tables (open items / in-approval / payment history —
// real case: HALD01 "3" paid on the Ledgerline job). Detect the collision BEFORE
// posting and tell the user to rename per the pay-app convention
// ({SUB} PA {n}, fallback {JOB} PA {n}). Fails open on Spectrum SQL downtime
// (findSpectrumInvoice returns null) — Spectrum remains the final arbiter.
async function findSpectrumInvoiceCollisions(claimedRows) {
  const collisions = [];
  for (const row of claimedRows) {
    const existing = await findSpectrumInvoice({
      invoiceNumber: row.invoice_number,
      vendorCode: row.vendor_code,
    });
    if (!existing) continue;
    const prefix = row.subcontract_number || row.job_match_number || row.job_number;
    const suggestion = prefix && /^\d{1,3}$/.test(String(row.invoice_number).trim())
      ? ` Suggested rename: "${prefix} PA ${String(row.invoice_number).trim()}".`
      : '';
    collisions.push({
      id: row.id,
      invoiceNumber: row.invoice_number,
      vendorCode: row.vendor_code,
      spectrumSource: existing.source,
      spectrumAmount: existing.amount,
      error: `Invoice number "${String(row.invoice_number).trim()}" already exists in Spectrum for vendor ${String(row.vendor_code).trim()} (${existing.source}). Rename this invoice number, then resubmit.${suggestion}`,
    });
  }
  return collisions;
}

async function rejectSpectrumInvoiceCollisions({ pool, res, requestLog, claimedIds, collisions }) {
  const collisionIds = new Set(collisions.map((c) => c.id));
  for (const collision of collisions) {
    await revertClaimedInvoices(pool, [collision.id], collision.error, requestLog, {
      reason: 'spectrum_invoice_number_collision',
    });
  }
  const otherIds = claimedIds.filter((id) => !collisionIds.has(id));
  if (otherIds.length > 0) {
    await revertClaimedInvoices(
      pool,
      otherIds,
      'Submission cancelled: the batch contained invoice numbers that already exist in Spectrum',
      requestLog,
      { reason: 'spectrum_invoice_number_collision_batch' }
    );
  }

  const detail = `${collisions.length} invoice number${collisions.length === 1 ? '' : 's'} already exist in Spectrum for the same vendor and must be renamed before submission`;
  return fail(res, 400, 'Cannot submit: invoice numbers already exist in Spectrum for the same vendor.', {
    detail,
    spectrumCollisions: collisions,
  });
}

function rejectDuplicateSubmissionIdentities(res, duplicates) {
  const alreadySubmittedCount = duplicates.filter((d) => d.reason === 'already_submitted').length;
  const batchDuplicateCount = duplicates.length - alreadySubmittedCount;
  const parts = [];
  if (alreadySubmittedCount > 0) parts.push(`${alreadySubmittedCount} already submitted to Spectrum`);
  if (batchDuplicateCount > 0) parts.push(`${batchDuplicateCount} duplicated within this batch`);
  const detail = `${parts.join('; ')} — resolve before resubmitting`;
  return fail(res, 400, 'Cannot submit: duplicate vendor and invoice-number combinations found.', {
    detail,
    duplicates,
  });
}

function rejectUnresolvableGlAccounts(res, validation) {
  return fail(
    res,
    422,
    'Cannot submit: a GL account is required for every Spectrum distribution.',
    UNRESOLVABLE_GL_CODE,
    { unresolvedGlAccounts: validation.unresolvedGlAccounts }
  );
}

function findClosedPeriodInvoiceDate(candidateRows) {
  for (const row of candidateRows) {
    const closedPeriod = getClosedPeriodInfo(row.invoice_date);
    if (!closedPeriod) continue;

    return {
      error: `Cannot submit: invoice date falls in ${closedPeriod.monthKey}, a closed period. Only ${closedPeriod.currentMonthKey} is open.`,
      code: 'CLOSED_PERIOD_DATE',
      details: {
        invoiceDateMonth: closedPeriod.monthKey,
        currentMonth: closedPeriod.currentMonthKey,
        suggestedInvoiceDate: closedPeriod.suggestedInvoiceDate,
        // Compatibility aliases remain until every deployed frontend reads
        // the canonical invoice-date field names.
        glDateMonth: closedPeriod.monthKey,
        suggestedGlDate: closedPeriod.suggestedInvoiceDate,
        nextAction: `Update the invoice date to ${closedPeriod.suggestedInvoiceDate}, then retry Spectrum submission.`,
      },
    };
  }

  return null;
}

async function submitInvoices(req, res) {
  const requestLog = req.log || logger;
  let claimedIds = [];

  try {
    const { ids, overrides = {} } = req.body || {};
    const now = new Date().toISOString();

    const {
      candidateRows,
      duplicateIdentities,
    } = await findSubmissionPreflight(pool, ids);

    const closedPeriodInvoiceDate = findClosedPeriodInvoiceDate(candidateRows);
    if (closedPeriodInvoiceDate) {
      return fail(
        res,
        400,
        closedPeriodInvoiceDate.error,
        closedPeriodInvoiceDate.code,
        closedPeriodInvoiceDate.details
      );
    }

    const preflightGlValidation = validateSubmissionGlAccounts({
      rows: candidateRows,
      overrides,
    });
    if (!preflightGlValidation.ok) {
      return rejectUnresolvableGlAccounts(res, preflightGlValidation);
    }

    if (duplicateIdentities.length > 0) {
      requestLog.error({
        operation: 'invoice.submit.validate_duplicate_identity',
        context: { duplicateCount: duplicateIdentities.length },
        error: 'Duplicate vendor and invoice-number combinations selected for Spectrum submission',
      }, 'Spectrum submit pre-flight validation failed');
      return rejectDuplicateSubmissionIdentities(res, duplicateIdentities);
    }

    const claimedRows = await claimInvoicesForSubmit(pool, ids, now);
    claimedIds = claimedRows.map((row) => row.id);

    if (claimedRows.length === 0) {
      // Look up the actual documents to explain WHY they weren't claimable
      const results = [];
      if (Array.isArray(ids) && ids.length > 0) {
        const lookupResult = await pool.query(
          `SELECT id, invoice_number, status, classification,
                  lien_waiver_required, linked_lien_waiver_id, lien_waiver_status, waiver_on_document
           FROM documents WHERE id = ANY($1)`,
          [ids]
        );
        for (const doc of lookupResult.rows) {
          let error;
          const waiverBlocked = doc.lien_waiver_required === true
            && !doc.linked_lien_waiver_id
            && doc.lien_waiver_status !== 'attached'
            && doc.waiver_on_document !== true;
          if (!['invoice', 'pay-application'].includes(doc.classification)) {
            error = `Document classified as "${doc.classification}" — only invoices and pay-applications can be submitted to Spectrum.`;
          } else if (doc.status !== 'approved') {
            error = `Invoice status is "${doc.status}" — must be "approved" to submit.`;
          } else if (waiverBlocked) {
            error = 'A lien waiver is required before this invoice can be submitted to Spectrum. Link a waiver or set the waiver-on-document override.';
          } else {
            error = 'Invoice could not be claimed for submission. It may already be submitting.';
          }
          results.push({ id: doc.id, success: false, error, invoiceNumber: doc.invoice_number });
        }
        // Any IDs not found in the database
        const foundIds = new Set(lookupResult.rows.map((r) => r.id));
        for (const id of ids) {
          if (!foundIds.has(id)) {
            results.push({ id, success: false, error: 'Invoice not found.', invoiceNumber: null });
          }
        }
      }
      return res.json({
        success: false,
        submitted: 0,
        total: results.length,
        message: results.length === 1 ? results[0].error : `${results.length} invoices could not be submitted.`,
        results,
      });
    }

    const claimedGlValidation = validateSubmissionGlAccounts({
      rows: claimedRows,
      overrides,
    });
    if (!claimedGlValidation.ok) {
      await revertClaimedInvoices(
        pool,
        claimedIds,
        'Submission validation failed: GL account could not be resolved',
        requestLog,
        { reason: 'unresolvable_gl_account_after_claim' }
      );
      return rejectUnresolvableGlAccounts(res, claimedGlValidation);
    }

    const missingAllocations = claimedRows.filter(
      (row) => row.multi_phase_candidate === true && !row.phase_allocations
    );
    if (missingAllocations.length > 0) {
      return rejectMissingAllocations({ pool, res, requestLog, claimedIds, missingAllocations });
    }

    const spectrumCollisions = await findSpectrumInvoiceCollisions(claimedRows);
    if (spectrumCollisions.length > 0) {
      requestLog.error({
        operation: 'invoice.submit.validate_spectrum_collision',
        context: { collisionCount: spectrumCollisions.length },
        error: 'Vendor and invoice-number combinations already exist in Spectrum',
      }, 'Spectrum submit pre-flight validation failed');
      return rejectSpectrumInvoiceCollisions({ pool, res, requestLog, claimedIds, collisions: spectrumCollisions });
    }

    const { APInvoices, submissionEntries, validation } = await buildSpectrumSubmission({
      rows: claimedRows,
      overrides,
      requestLog,
    });

    if (!validation.ok) {
      requestLog.error({
        operation: 'invoice.submit.validate_payload',
        context: { invoiceCount: APInvoices.length, errorCount: validation.errors.length },
        error: 'Spectrum pre-flight validation failed',
      }, 'Spectrum pre-flight validation failed');
      await revertClaimedInvoices(
        pool,
        claimedIds,
        'Submission validation failed before Spectrum request',
        requestLog,
        { reason: 'payload_validation_failed' }
      );
      if (validation.code === UNRESOLVABLE_GL_CODE) {
        return rejectUnresolvableGlAccounts(res, validation);
      }
      return fail(res, 400, 'Spectrum submission payload failed validation — no invoices were submitted.', {
        errors: validation.errors,
        invoiceCount: APInvoices.length,
      });
    }
    requestLog.info({ invoiceCount: APInvoices.length }, 'Spectrum pre-flight validation passed');

    let spectrumResp;
    try {
      spectrumResp = await postToSpectrum({ APInvoices });
    } catch (connErr) {
      logSubmitError(
        requestLog,
        'invoice.submit.post_to_spectrum',
        { claimCount: claimedIds.length },
        'Spectrum unreachable during invoice submit',
        connErr
      );
      await revertClaimedInvoices(
        pool,
        claimedIds,
        'Spectrum API unreachable before submission completed',
        requestLog,
        { reason: 'spectrum_unreachable' }
      );
      return fail(res, 502, 'Spectrum API unreachable — no invoices were submitted.');
    }

    requestLog.info({ statusCode: spectrumResp.statusCode }, 'Spectrum response received');
    const results = await applySpectrumResults({
      pool,
      audit,
      req,
      res,
      now,
      spectrumResp,
      submissionEntries,
      requestLog,
    });
    const { submittedCount, message } = summarizeSubmitResults(results);

    return res.json({
      success: submittedCount > 0,
      submitted: submittedCount,
      total: results.length,
      message,
      results,
      spectrumStatus: spectrumResp.statusCode,
    });
  } catch (err) {
    if (claimedIds.length > 0) {
      try {
        await revertClaimedInvoices(
          pool,
          claimedIds,
          'Submission failed after claim; verify Spectrum before retrying',
          requestLog,
          { reason: 'unexpected_submit_failure' }
        );
      } catch (_) {
        return fail(res, 500, 'Internal server error');
      }
    }

    logSubmitError(
      requestLog,
      'invoice.submit',
      { claimCount: claimedIds.length },
      'Invoice submit route failed',
      err
    );
    return fail(res, 500, 'Internal server error');
  }
}

module.exports = {
  findDuplicateSubmissionIdentities,
  findSubmissionPreflight,
  findSpectrumInvoiceCollisions,
  formatDuplicateSubmissionIdentities,
  rejectDuplicateSubmissionIdentities,
  submitInvoices,
  summarizeSubmitResults,
};
