'use strict';

const {
  finalizeSubmittedInvoice,
  logSubmitError,
  normalizeSubmitError,
  revertClaimedInvoices,
} = require('./submitState');
const { emitInvoiceAuditEvent } = require('../../../lib/auditEvents');
const { withTransaction } = require('./transaction');
const { discardLinkedLienWaiverForSubmittedInvoice } = require('./documentDiscardService');

function isSpectrumSuccess(specResult) {
  const errMsg = specResult ? (specResult.Error_Message || '').trim() : '';
  return specResult
    ? (specResult.Success === true || specResult.Success === 1 ||
       specResult.Success === 'true' || errMsg === '')
    : false;
}

// B3 (2026-07-24): Spectrum's closed-A/P-period rejection ("G/L date is
// outside of min/max range...") is opaque to users. Translate it into an
// actionable message worded around the INVOICE DATE — that's the field label
// the frontend shows, and the GL date defaults from it. Notification only:
// nothing is auto-corrected (owner ruling).
const CLOSED_PERIOD_REGEX = /G\/?L date is outside of (?:the )?min\/?max range/i;

function explainSpectrumRejection(rawMessage, invoice) {
  const message = String(rawMessage || '').trim();
  if (CLOSED_PERIOD_REGEX.test(message)) {
    const glDate = invoice && invoice.GL_Date ? ` (${invoice.GL_Date})` : '';
    return `The invoice date${glDate} falls in a closed A/P period — Spectrum only accepts dates in the current open month. Edit the invoice date to a day in the current month, then resubmit. [Spectrum: ${message}]`;
  }
  return message;
}

function spectrumInvoiceIdentity(value) {
  const vendorCode = value && (value.Vendor_Code ?? value.vendor_code);
  const invoiceNumber = value && (value.Invoice_Number ?? value.invoice_number);
  if (vendorCode === undefined || vendorCode === null || invoiceNumber === undefined || invoiceNumber === null) {
    return null;
  }

  const normalizedVendorCode = String(vendorCode).trim().toUpperCase();
  const normalizedInvoiceNumber = String(invoiceNumber).trim().toUpperCase();
  if (!normalizedVendorCode || !normalizedInvoiceNumber) return null;

  return JSON.stringify([normalizedVendorCode, normalizedInvoiceNumber]);
}

function indexSpectrumResults(spectrumInvoices) {
  const resultsByIdentity = new Map();
  const ambiguousIdentities = new Set();
  const unidentifiableResults = [];

  for (const result of spectrumInvoices) {
    const identity = spectrumInvoiceIdentity(result);
    if (!identity) {
      unidentifiableResults.push(result);
      continue;
    }

    if (resultsByIdentity.has(identity)) {
      ambiguousIdentities.add(identity);
      continue;
    }

    resultsByIdentity.set(identity, result);
  }

  return { ambiguousIdentities, resultsByIdentity, unidentifiableResults };
}

function takeSpectrumResult(index, entry) {
  const identity = spectrumInvoiceIdentity(entry.invoice || entry.row);
  if (!identity || !index.resultsByIdentity.has(identity)) {
    return { result: null, reason: 'missing_spectrum_result' };
  }
  if (index.ambiguousIdentities.has(identity)) {
    return { result: null, reason: 'ambiguous_spectrum_result' };
  }

  const result = index.resultsByIdentity.get(identity);
  index.resultsByIdentity.delete(identity);
  return { result, reason: null };
}

function spectrumInvoiceResults(spectrumResp) {
  const resultList = spectrumResp && spectrumResp.body && spectrumResp.body.APInvoices;
  if (resultList === undefined || resultList === null) {
    return { invoices: [], malformed: false };
  }
  if (!Array.isArray(resultList)) {
    return { invoices: [], malformed: true };
  }
  return { invoices: resultList, malformed: false };
}

async function revertEntry({ pool, docId, message, requestLog, context }) {
  try {
    await revertClaimedInvoices(pool, [docId], message, requestLog, context);
    return true;
  } catch (revertErr) {
    logSubmitError(
      requestLog,
      'invoice.submit.revert_result_entry',
      { docId, ...context },
      'Failed to revert invoice after Spectrum result handling failure',
      revertErr
    );
    return false;
  }
}

async function markLinkedDocumentsSubmitted({ pool, audit, docId, now }) {
  await pool.query(
    'UPDATE documents SET status = $1, updated_at = $2 WHERE linked_to = $3',
    ['submitted', now, docId]
  );

  const linkedResult = await pool.query('SELECT id FROM documents WHERE linked_to = $1', [docId]);
  for (const linked of linkedResult.rows) {
    await audit(linked.id, 'submitted', { reason: `linked to ${docId}` });
  }

  return linkedResult.rows.length;
}

async function finalizeSubmissionAndDiscardLinkedWaiver({ pool, docId, now }) {
  return withTransaction(pool, async (db) => {
    await finalizeSubmittedInvoice(db, docId, now);
    const finalized = await db.query(
      'SELECT linked_lien_waiver_id FROM documents WHERE id = $1 FOR UPDATE',
      [docId]
    );
    return discardLinkedLienWaiverForSubmittedInvoice({
      db,
      invoiceId: docId,
      waiverId: finalized.rows[0]?.linked_lien_waiver_id || null,
    });
  });
}

async function applySpectrumResults({
  pool,
  audit,
  req,
  res,
  now,
  spectrumResp,
  submissionEntries,
  requestLog,
}) {
  const { invoices: spectrumInvoices, malformed: malformedResults } = spectrumInvoiceResults(spectrumResp);
  requestLog.debug({
    statusCode: spectrumResp && spectrumResp.statusCode,
    invoiceResultCount: spectrumInvoices.length,
  }, 'Spectrum response summary');

  if (malformedResults) {
    requestLog.error({
      operation: 'invoice.submit.spectrum_result_response',
      context: { statusCode: spectrumResp && spectrumResp.statusCode },
      error: 'Spectrum response APInvoices must be an array',
    }, 'Spectrum returned an invalid invoice result list');
  }

  const results = [];
  const spectrumResultIndex = indexSpectrumResults(spectrumInvoices);
  for (const result of spectrumResultIndex.unidentifiableResults) {
    requestLog.error({
      operation: 'invoice.submit.spectrum_result_response',
      context: { result },
      error: 'Spectrum result omitted Vendor_Code or Invoice_Number',
    }, 'Ignoring an unidentifiable Spectrum invoice result');
  }

  for (const entry of submissionEntries) {
    const { docId, row } = entry;
    const { result: specResult, reason } = malformedResults
      ? { result: null, reason: 'malformed_spectrum_result_response' }
      : takeSpectrumResult(spectrumResultIndex, entry);

    if (!specResult) {
      const error = reason === 'malformed_spectrum_result_response'
        ? 'Spectrum returned an invalid invoice result list'
        : reason === 'ambiguous_spectrum_result'
          ? 'Spectrum returned multiple results for this invoice identity'
          : `No Spectrum result returned for invoice (${row.vendor_code}/${row.invoice_number}) — Spectrum may have silently rejected it. Check subcontract and phase setup in Spectrum.`;
      requestLog.error({
        operation: 'invoice.submit.spectrum_result',
        context: { docId, invoiceNumber: row.invoice_number },
        error,
      }, error);
      await revertEntry({
        pool,
        docId,
        message: error,
        requestLog,
        context: { docId, reason },
      });
      results.push({
        id: docId,
        success: false,
        error,
        invoiceNumber: row.invoice_number,
      });
      continue;
    }

    if (!isSpectrumSuccess(specResult)) {
      const errDetail = normalizeSubmitError(
        explainSpectrumRejection(specResult.Error_Message, entry.invoice),
        'Spectrum rejected invoice'
      );
      requestLog.error({
        operation: 'invoice.submit.spectrum_result',
        context: { docId, invoiceNumber: row.invoice_number },
        error: errDetail,
      }, 'Spectrum rejected invoice');
      await revertEntry({
        pool,
        docId,
        message: errDetail,
        requestLog,
        context: { docId, reason: 'spectrum_rejected' },
      });
      results.push({ id: docId, success: false, error: errDetail, invoiceNumber: row.invoice_number });
      continue;
    }

    try {
      const waiverDiscard = await finalizeSubmissionAndDiscardLinkedWaiver({ pool, docId, now });
      await audit(docId, 'submitted', { spectrumInvoiceNumber: row.invoice_number });
      await emitInvoiceAuditEvent(req, res, {
        type: 'invoice.submitted_spectrum',
        invoiceId: docId,
        row,
        changes: {
          status: ['submitting', 'submitted'],
          spectrumInvoiceNumber: row.invoice_number,
        },
        summary: 'Invoice submitted to Spectrum',
        severity: 'info',
      });

      const linkedDocs = await markLinkedDocumentsSubmitted({ pool, audit, docId, now });
      results.push({
        id: docId,
        success: true,
        invoiceNumber: row.invoice_number,
        linkedDocs,
        waiverDiscard: waiverDiscard.outcome,
      });
    } catch (bookkeepingErr) {
      logSubmitError(
        requestLog,
        'invoice.submit.result_bookkeeping',
        { docId },
        'Failed to record Spectrum submission result for invoice',
        bookkeepingErr
      );
      results.push({
        id: docId,
        success: false,
        error: 'Spectrum acknowledged this invoice, but local result bookkeeping failed',
        invoiceNumber: row.invoice_number,
      });
    }
  }

  for (const [identity] of spectrumResultIndex.resultsByIdentity) {
    requestLog.error({
      operation: 'invoice.submit.spectrum_result_response',
      context: { identity },
      error: 'Spectrum returned a result without a matching submitted invoice',
    }, 'Ignoring an unmatched Spectrum invoice result');
  }
  for (const identity of spectrumResultIndex.ambiguousIdentities) {
    requestLog.error({
      operation: 'invoice.submit.spectrum_result_response',
      context: { identity },
      error: 'Spectrum returned multiple results for one invoice identity',
    }, 'Ignoring ambiguous Spectrum invoice results');
  }

  return results;
}

module.exports = {
  applySpectrumResults,
  explainSpectrumRejection,
  finalizeSubmissionAndDiscardLinkedWaiver,
  isSpectrumSuccess,
  spectrumInvoiceIdentity,
};
