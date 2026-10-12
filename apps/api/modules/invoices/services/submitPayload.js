'use strict';

const fs = require('fs');

const { ensurePdf } = require('./pdf');
const { glAccountForCostType } = require('./approvalValidator');
const { lookupPhaseCode } = require('./spectrum');
const { validatePayload } = require('./spectrumValidation');
const { getSubcontractsMap } = require('./matching');
const { loadJobPmMap } = require('./submitRouting');
const { formatDate } = require('./utils');

const UNRESOLVABLE_GL_CODE = 'SPECTRUM_GL_ACCOUNT_UNRESOLVED';

async function loadPhaseCache(rows) {
  const phaseCache = {};
  for (const row of rows) {
    const sub = row.subcontract_number;
    if (sub && !Object.prototype.hasOwnProperty.call(phaseCache, sub)) {
      phaseCache[sub] = await lookupPhaseCode(sub);
    }
  }
  return phaseCache;
}

function resolveField(overrideVal, dbVal, autoDefault) {
  if (overrideVal !== undefined && overrideVal !== null) return overrideVal;
  if (dbVal !== undefined && dbVal !== null) return dbVal;
  return autoDefault;
}

async function readSubmissionImages(row, requestLog) {
  let images = [];
  let pdfToUse = (row.merged_file_path && fs.existsSync(row.merged_file_path))
    ? row.merged_file_path
    : row.file_path;

  if (!pdfToUse || !fs.existsSync(pdfToUse)) {
    requestLog.info({ docId: row.id }, 'Submission PDF missing; attempting recovery');
    pdfToUse = await ensurePdf(row);
  }

  if (!pdfToUse) return images;

  try {
    const pdfBuf = fs.readFileSync(pdfToUse);
    images = [{ Image_File: pdfBuf.toString('base64'), Image_Type: 'PDF' }];
    if (pdfToUse === row.merged_file_path) {
      requestLog.info({ docId: row.id, pdfPath: pdfToUse }, 'Using merged PDF for submission');
    }
  } catch (err) {
    requestLog.error({ err, docId: row.id, pdfPath: pdfToUse }, 'Could not read submission PDF');
  }

  return images;
}

function parsePhaseAllocations(row) {
  if (!row.phase_allocations) return null;
  try {
    return typeof row.phase_allocations === 'string'
      ? JSON.parse(row.phase_allocations)
      : row.phase_allocations;
  } catch {
    return null;
  }
}

// Only the MATCHED job (job_match_number: auto-match or explicit UI selection)
// may reach the Spectrum payload. The raw extracted job_number is untrusted —
// extraction can capture vendor-internal references (e.g. a law firm's matter
// number) that look job-shaped but do not exist in Spectrum, producing a Job
// block the UI never showed and a guaranteed pre-flight rejection.
function resolveSubmissionJobNumber(row) {
  const matched = row.job_match_number === undefined || row.job_match_number === null
    ? ''
    : String(row.job_match_number).trim();
  return matched || null;
}

function normalizeGlAccount(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function servedGlAccountForCostType(costType) {
  return normalizeGlAccount(glAccountForCostType(costType));
}

function resolveSubmissionGlAccount(overrideValue, rowValue, costType) {
  return normalizeGlAccount(overrideValue)
    || normalizeGlAccount(rowValue)
    || servedGlAccountForCostType(costType);
}

function unresolvedGlIssue(row, costType, allocationIndex) {
  const issue = {
    id: row.id,
    invoiceNumber: row.invoice_number || row.id,
    costType: costType ? String(costType).trim().toUpperCase() : null,
  };
  if (allocationIndex !== undefined) issue.allocationIndex = allocationIndex;
  return issue;
}

function validateSubmissionGlAccounts({ rows, overrides = {} }) {
  const unresolvedGlAccounts = [];

  for (const row of rows) {
    const docOverrides = overrides[row.id] || {};
    const phaseAllocations = parsePhaseAllocations(row);

    if (Array.isArray(phaseAllocations) && phaseAllocations.length > 0) {
      phaseAllocations.forEach((allocation, allocationIndex) => {
        const allocationCostType = allocation.cost_type || 'S';
        if (!servedGlAccountForCostType(allocationCostType)) {
          unresolvedGlAccounts.push(unresolvedGlIssue(
            row,
            allocationCostType,
            allocationIndex
          ));
        }
      });
      continue;
    }

    const jobNumber = resolveSubmissionJobNumber(row);
    const finalCostType = resolveField(
      docOverrides.cost_type,
      row.cost_type,
      jobNumber ? 'S' : ''
    );
    if (!resolveSubmissionGlAccount(docOverrides.gl_account, row.gl_account, finalCostType)) {
      unresolvedGlAccounts.push(unresolvedGlIssue(row, finalCostType));
    }
  }

  const errors = unresolvedGlAccounts.map((issue) => {
    const allocation = issue.allocationIndex === undefined
      ? ''
      : ` allocation ${issue.allocationIndex + 1}`;
    const costType = issue.costType ? ` for cost type ${issue.costType}` : '';
    return `Invoice ${issue.invoiceNumber}${allocation}: GL account is required${costType} and no served mapping is available`;
  });

  return {
    ok: unresolvedGlAccounts.length === 0,
    code: unresolvedGlAccounts.length > 0 ? UNRESOLVABLE_GL_CODE : undefined,
    errors,
    unresolvedGlAccounts,
  };
}

function buildInvoiceDetails({ row, jobNumber, invoiceAmount, docOverrides, phaseCode, requestLog, buildErrors }) {
  const finalPhaseCode = resolveField(docOverrides.phase_code, row.phase_code, phaseCode || '');
  const finalCostType = resolveField(docOverrides.cost_type, row.cost_type, jobNumber ? 'S' : '');
  const finalGlAccount = resolveSubmissionGlAccount(
    docOverrides.gl_account,
    row.gl_account,
    finalCostType
  );
  const phaseAllocations = parsePhaseAllocations(row);

  if (Array.isArray(phaseAllocations) && phaseAllocations.length > 0) {
    if (!jobNumber) {
      const buildError = 'phase_allocations set but job_number is missing';
      requestLog.error({
        operation: 'invoice.submit.build_payload',
        context: { docId: row.id },
        error: buildError,
      }, 'Could not build Spectrum payload for invoice');
      buildErrors.push(`Invoice ${row.invoice_number || row.id}: ${buildError}`);
      return null;
    }

    const details = phaseAllocations.map((alloc) => {
      const allocCostType = alloc.cost_type || 'S';
      return {
        Distribution: { GL_Account: servedGlAccountForCostType(allocCostType) },
        Amount: Number(alloc.amount),
        Job: {
          Job_Number: jobNumber,
          Phase_Code: alloc.phase_code,
          Cost_Type: allocCostType,
        },
        Remark: (alloc.description || '').slice(0, 30),
      };
    });
    requestLog.info({ docId: row.id, detailLineCount: details.length }, 'Built multi-phase submission details');
    return details;
  }

  return [{
    Distribution: { GL_Account: finalGlAccount },
    Amount: invoiceAmount,
    ...(jobNumber ? {
      Job: {
        Job_Number: jobNumber,
        Phase_Code: finalPhaseCode,
        Cost_Type: finalCostType,
      },
    } : {}),
  }];
}

async function buildSpectrumSubmission({ rows, overrides, requestLog }) {
  const glValidation = validateSubmissionGlAccounts({ rows, overrides });
  if (!glValidation.ok) {
    return {
      APInvoices: [],
      submissionEntries: [],
      validation: glValidation,
    };
  }

  const phaseCache = await loadPhaseCache(rows);
  const { pmToRouting, jobPmMap } = loadJobPmMap();
  const subMap = getSubcontractsMap();
  const buildErrors = [];
  const submissionEntries = [];
  const APInvoices = [];

  for (const row of rows) {
    const jobNumber = resolveSubmissionJobNumber(row);
    const docOverrides = overrides[row.id] || {};
    const invoiceDateFmt = formatDate(row.invoice_date);
    const glDateFmt = formatDate(resolveField(docOverrides.gl_date, row.gl_date, row.invoice_date));
    const phaseCode = row.subcontract_number ? phaseCache[row.subcontract_number] : null;
    const invoiceAmount = parseFloat(row.amount) || 0;
    // Spectrum convention (verified against VN_OPEN_ITEMS_MC/VN_PAYMENT_HISTORY_MC):
    // credit memos carry Invoice_Type_Code 'C' with a POSITIVE amount, never a
    // negative invoice. Budget math below still uses the signed amount.
    const isCreditMemo = invoiceAmount < 0;
    const submissionAmount = Math.abs(invoiceAmount);
    const sub = row.subcontract_number ? subMap[row.subcontract_number] : null;
    const hasSubMatch = !!sub;
    const unbilled = hasSubMatch ? (parseFloat(sub.unbilled) || 0) : 0;
    const withinBudget = hasSubMatch && invoiceAmount <= unbilled;

    let approvalStatus;
    let routingCode;
    if (docOverrides.approval_status) {
      approvalStatus = docOverrides.approval_status;
      routingCode = docOverrides.routing_code || row.routing_code || 'D';
    } else if (withinBudget) {
      approvalStatus = 'A';
      routingCode = docOverrides.routing_code || row.routing_code || 'D';
    } else {
      approvalStatus = 'U';
      routingCode = docOverrides.routing_code || row.routing_code || 'D';
      if (!docOverrides.routing_code && !row.routing_code && jobNumber && jobPmMap[jobNumber]) {
        const pm = jobPmMap[jobNumber];
        routingCode = pmToRouting[pm] || 'D';
      }
    }

    requestLog.info({
      docId: row.id,
      subcontractNumber: row.subcontract_number || null,
      amount: invoiceAmount,
      unbilled,
      withinBudget,
      approvalStatus,
      routingCode,
    }, 'Prepared Spectrum submission details');

    const apInvoiceDetails = buildInvoiceDetails({
      row,
      jobNumber,
      invoiceAmount: submissionAmount,
      docOverrides,
      phaseCode,
      requestLog,
      buildErrors,
    });
    if (!apInvoiceDetails) continue;

    const images = await readSubmissionImages(row, requestLog);
    const invoice = {
      Company_Code: 'NCG',
      Vendor_Code: row.vendor_code,
      Invoice_Number: row.invoice_number,
      Invoice_Date: invoiceDateFmt || '',
      GL_Date: glDateFmt || '',
      Approval_Status: approvalStatus,
      Batch_Code: 'A.I',
      Remarks: 'Imported via Toolbox pipeline',
      Routing_Code: routingCode,
      Invoice_Amount: submissionAmount,
      ...(isCreditMemo ? { Invoice_Type_Code: 'C' } : {}),
      APInvoiceDetails: apInvoiceDetails,
      ...(row.subcontract_number ? { Contract_Number: row.subcontract_number } : {}),
      ...(images.length ? { Images: images } : {}),
    };

    submissionEntries.push({ docId: row.id, invoice, row });
    APInvoices.push(invoice);
  }

  const validation = buildErrors.length > 0
    ? { ok: false, errors: buildErrors }
    : validatePayload({ APInvoices });

  return { APInvoices, submissionEntries, validation };
}

module.exports = {
  UNRESOLVABLE_GL_CODE,
  buildSpectrumSubmission,
  validateSubmissionGlAccounts,
};
