'use strict';
/**
 * Approval Validator — reads approvalRules.json and validates a document
 * row against the correct approval path.
 *
 * This is the SINGLE SOURCE OF TRUTH for approval validation logic.
 * The approve route handler delegates to this module. The frontend fetches
 * the same schema via GET /api/approval-schema and runs client-side
 * validation as a UX preview.
 *
 * Backend is authoritative — the frontend can never approve something the
 * backend would reject.
 */

const path = require('path');
const rules = require('./approvalRules.json');

/**
 * Determine the approval path for a document.
 *
 * @param {object} opts
 * @param {string|null} opts.jobNumber       - job_match_number from the doc
 * @param {string|null} opts.subcontractNumber - subcontract_number from the doc
 * @param {number|null} opts.amount          - invoice amount
 * @param {number|null} opts.unbilledBalance - subcontract unbilled (null if no sub)
 * @returns {'1'|'2'|'3'}
 */
function getApprovalPath({ jobNumber, subcontractNumber, amount, unbilledBalance }) {
  if (!jobNumber) return '3';

  if (subcontractNumber) {
    if (
      typeof amount === 'number' &&
      typeof unbilledBalance === 'number' &&
      amount <= unbilledBalance
    ) {
      return '1';
    }
    return '2';
  }

  return '2';
}

/**
 * Check if a value is "present" for validation purposes.
 * Matches the backend's existing check: `!row[f] && row[f] !== 0`
 */
function hasValue(val) {
  if (val === 0) return true;
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim().length > 0;
  if (typeof val === 'number') return Number.isFinite(val);
  return Boolean(val);
}

/**
 * Validate a document row for approval readiness.
 *
 * @param {object} row  - The full document row (snake_case DB columns)
 * @param {object} opts
 * @param {number|null} opts.unbilledBalance - Subcontract unbilled balance (from subMap lookup)
 * @returns {object} { path, missing, autoRouting, approvalStatus, isValid }
 */
function validateApproval(row, { unbilledBalance = null } = {}) {
  const approvalPath = getApprovalPath({
    jobNumber: row.job_match_number,
    subcontractNumber: row.subcontract_number,
    amount: parseFloat(row.amount) || null,
    unbilledBalance,
  });

  const pathRules = rules.paths[approvalPath];
  if (!pathRules) {
    return {
      path: approvalPath,
      missing: [],
      autoRouting: false,
      approvalStatus: 'U',
      isValid: false,
      error: `Unknown approval path: ${approvalPath}`,
    };
  }

  // Determine which fields to check
  let requiredFields = [...pathRules.required];

  // Multi-phase override: skip phase_code and cost_type if the invoice has allocations
  const isMultiPhaseAllocated =
    row.multi_phase_candidate && row.phase_allocations;
  if (isMultiPhaseAllocated && rules.multiPhaseOverrides) {
    const skipFields = new Set(rules.multiPhaseOverrides.skipFields || []);
    requiredFields = requiredFields.filter((f) => !skipFields.has(f));
  }

  // Check each required field
  const missing = requiredFields.filter((f) => !hasValue(row[f]));

  // Auto-routing
  const autoRouting =
    pathRules.autoRouting?.enabled && !hasValue(row.routing_code);

  return {
    path: approvalPath,
    // The per-path required field list (after multi-phase skip). Exposed so the
    // approval-state endpoint serves it without re-deriving the rule set.
    requiredFields,
    missing,
    autoRouting,
    autoRoutingCode: autoRouting
      ? pathRules.autoRouting.defaultCode
      : null,
    approvalStatus: pathRules.approvalStatus,
    isValid: missing.length === 0,
    isMultiPhaseAllocated: !!isMultiPhaseAllocated,
  };
}

/**
 * Spectrum's required distribution GL account for a job cost type, from
 * approvalRules.json codingDefaults.costTypeGlMap (sourced from
 * JC_COST_TYPE_MASTER, Company_Code NCG). Returns null for unknown/unmapped
 * cost types (e.g. 'L', which has no GL account in the master).
 */
function glAccountForCostType(costType) {
  if (!costType || typeof costType !== 'string') return null;
  const mapCfg = rules.codingDefaults && rules.codingDefaults.costTypeGlMap;
  const map = (mapCfg && mapCfg.map) || {};
  return map[costType.trim().toUpperCase()] || null;
}

function getUnbilledBalance(row) {
  if (!row.subcontract_number) return null;
  const { getSubcontractsMap } = require('./matching');
  const sub = getSubcontractsMap()[row.subcontract_number];
  return sub ? parseFloat(sub.unbilled) || 0 : null;
}

/**
 * W7 (2026-08-26, D-W7): calendar-month key for an invoice date. Handles the
 * two shapes pg hands us — 'YYYY-MM-DD…' strings (sliced directly, no timezone
 * math) and Date objects (local getters; node-postgres parses DATE columns to
 * local midnight, so local getters give the stored calendar date).
 */
function calendarMonthKey(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * W7 closed-period check: the only open period is the CURRENT calendar month
 * (server time) — there is no Spectrum period source of truth, so any other
 * month is treated as closed (D-W7). Returns null when open (or no date);
 * otherwise the month keys plus the one-click fix value (first of the current
 * month). The submit-time regex translation (submitResult.js) stays as the
 * backstop for drift.
 */
function getClosedPeriodInfo(value, now = new Date()) {
  const monthKey = calendarMonthKey(value);
  if (!monthKey) return null;
  const currentMonthKey = calendarMonthKey(now);
  if (monthKey === currentMonthKey) return null;
  return {
    monthKey,
    currentMonthKey,
    suggestedInvoiceDate: `${currentMonthKey}-01`,
    // Keep the helper's existing shape compatible while response envelopes
    // dual-emit the old names during the frontend rollout.
    suggestedGlDate: `${currentMonthKey}-01`,
  };
}

function isLienWaiverMissing(row) {
  return Boolean(row.lien_waiver_required)
    && row.waiver_bypassed !== true
    && !row.linked_lien_waiver_id
    && row.lien_waiver_status !== 'attached'
    && !row.waiver_on_document;
}

/**
 * Apply the approval eligibility rules shared by preview, single, and bulk
 * approval. The legacy default uses GL date; preview and single approve opt
 * into canonical invoice-date behavior.
 *
 * Duplicate blocker (DUPLICATE-WORKFLOW-SPEC 2.4): callers that have run the
 * async live evaluation pass it as opts.duplicateStatus; an unresolved signal
 * blocks approval. Resolved = discarded (unreachable here) or bypassed —
 * the evaluation itself returns 'none' for those.
 */
function validateApprovalEligibility(row, { invoiceId, closedPeriodDateSource = 'gl', duplicateStatus = null } = {}) {
  if (duplicateStatus && duplicateStatus.state && duplicateStatus.state !== 'none') {
    const detail = duplicateStatus.state === 'spectrum'
      ? 'this invoice appears already posted in Spectrum'
      : duplicateStatus.state === 'toolbox'
        ? `flagged as a duplicate of ${duplicateStatus.original?.id || 'another Toolbox document'}`
        : 'flagged as a duplicate of a discarded copy';
    return {
      error: `Cannot approve: unresolved duplicate flag — ${detail}. Discard the duplicate or bypass the flag first.`,
      code: 'DUPLICATE_UNRESOLVED',
      duplicateState: duplicateStatus.state,
      duplicateEvidence: duplicateStatus.evidence || null,
      nextAction: invoiceId
        ? `Resolve via the duplicate banner: discard, or POST /api/invoices/${invoiceId}/duplicate-bypass.`
        : undefined,
    };
  }

  if (row.multi_phase_candidate && !row.phase_allocations) {
    return {
      error: 'Cannot approve: this invoice is on a multi-phase subcontract and requires a phase allocation.',
      code: 'MULTI_PHASE_ALLOCATION_REQUIRED',
      subcontractNumber: row.subcontract_number,
      nextAction: invoiceId
        ? `PATCH /api/invoices/${invoiceId}/phase-allocations with your allocation, then retry approve.`
        : undefined,
    };
  }

  if (row.multi_phase_candidate && row.phase_allocations && row.subcontract_number) {
    const { getSubcontractPhaseInfo } = require('./matcher');
    const phaseInfo = getSubcontractPhaseInfo(row.subcontract_number);
    const invoiceAmt = parseFloat(row.amount) || 0;
    const exceeds = phaseInfo && invoiceAmt > phaseInfo.unbilled + 0.01;
    if (exceeds && !row.routing_code) {
      return {
        error: 'Cannot approve: invoice exceeds subcontract unbilled budget and requires PM routing.',
        code: 'PM_ROUTING_REQUIRED',
        subcontractNumber: row.subcontract_number,
        invoiceAmount: invoiceAmt,
        subcontractUnbilled: phaseInfo.unbilled,
        overageAmount: Math.round((invoiceAmt - phaseInfo.unbilled) * 100) / 100,
        nextAction: invoiceId
          ? `Set a routing_code on this invoice (suggested from job PM) before retrying approve. GET /api/invoices/${invoiceId}/phase-options returns suggestedRoutingCode.`
          : undefined,
      };
    }
  }

  // Cost-type / GL mismatch on job-coded invoices: Spectrum hard-rejects these
  // ("Cost type does not match distribution G/L account"), so block at approval
  // with an actionable message instead of letting the submit fail later.
  // Multi-phase allocated rows skip the doc-level pair (each allocation line's
  // GL is derived from its own cost type at submit time).
  const isMultiPhaseAllocated = row.multi_phase_candidate && row.phase_allocations;
  if (row.job_match_number && !isMultiPhaseAllocated
    && hasValue(row.cost_type) && hasValue(row.gl_account)) {
    const expectedGl = glAccountForCostType(row.cost_type);
    if (expectedGl && String(row.gl_account).trim() !== expectedGl) {
      return {
        error: `Cannot approve: cost type ${String(row.cost_type).trim().toUpperCase()} requires GL account ${expectedGl} in Spectrum, but this invoice has ${String(row.gl_account).trim()}. Change the GL account (or the cost type) — Spectrum rejects this combination.`,
        code: 'COST_TYPE_GL_MISMATCH',
        costType: String(row.cost_type).trim().toUpperCase(),
        glAccount: String(row.gl_account).trim(),
        expectedGlAccount: expectedGl,
        nextAction: invoiceId
          ? `PATCH /api/invoices/${invoiceId} with glAccount ${expectedGl} (or the intended cost type), then retry approve.`
          : undefined,
      };
    }
  }

  // W7 closed-period gate: canonical preview/single approval opt into the
  // server-selected invoice-date recovery envelope. The default Bulk path
  // retains its independent legacy GL-date blocker and action.
  const usesCanonicalInvoiceDate = closedPeriodDateSource === 'invoice';
  const closedPeriodDate = !usesCanonicalInvoiceDate
    ? (row.gl_date || row.invoice_date)
    : row.invoice_date;
  const closedPeriod = getClosedPeriodInfo(closedPeriodDate);
  if (closedPeriod) {
    if (!usesCanonicalInvoiceDate) {
      return {
        error: `Cannot approve: the GL date falls in ${closedPeriod.monthKey}, a closed period — only the current month (${closedPeriod.currentMonthKey}) is open. Use the current open period or correct the date.`,
        code: 'CLOSED_PERIOD_DATE',
        glDateMonth: closedPeriod.monthKey,
        currentMonth: closedPeriod.currentMonthKey,
        suggestedGlDate: closedPeriod.suggestedGlDate,
        nextAction: invoiceId
          ? `PATCH /api/invoices/${invoiceId} with glDate ${closedPeriod.suggestedGlDate} (or retry approve with a glDate override), then retry approve.`
          : undefined,
      };
    }
    return {
      error: `Cannot approve: the invoice date falls in ${closedPeriod.monthKey}, a closed period — only the current month (${closedPeriod.currentMonthKey}) is open. Use the current open period or correct the date.`,
      code: 'CLOSED_PERIOD_DATE',
      invoiceDateMonth: closedPeriod.monthKey,
      currentMonth: closedPeriod.currentMonthKey,
      suggestedInvoiceDate: closedPeriod.suggestedInvoiceDate,
      // Compatibility aliases are retained during the frontend rollout.
      glDateMonth: closedPeriod.monthKey,
      suggestedGlDate: closedPeriod.suggestedInvoiceDate,
      nextAction: invoiceId
        ? `PATCH /api/invoices/${invoiceId} with invoiceDate ${closedPeriod.suggestedInvoiceDate}, then retry approve.`
        : undefined,
    };
  }

  const validation = validateApproval(row, { unbilledBalance: getUnbilledBalance(row) });
  const missing = [...validation.missing];
  if (isLienWaiverMissing(row)) missing.push('linked_lien_waiver_id');

  if (missing.length > 0) {
    return {
      error: 'Missing required fields for approval',
      missing,
      path: validation.path,
    };
  }

  return {
    approvalPath: validation.path,
    autoRouting: validation.autoRouting,
  };
}

/**
 * Get the approval rules schema — returned directly by the API endpoint
 * so the frontend can consume the same rules.
 */
function getApprovalSchema() {
  return {
    paths: rules.paths,
    multiPhaseOverrides: rules.multiPhaseOverrides,
    fieldLabels: rules.fieldLabels,
    // Advisory coding pre-fill policy (additive). The derived per-document values
    // are served by GET /api/validate-approval; this exposes the raw policy for
    // clients that read the schema directly. Existing keys are unchanged.
    codingDefaults: rules.codingDefaults,
    version: rules.version,
  };
}

/**
 * Get field labels for missing field names (human-readable).
 */
function formatMissing(missingFields) {
  return missingFields
    .map((f) => rules.fieldLabels[f] || f)
    .join(', ');
}

module.exports = {
  getApprovalPath,
  validateApproval,
  getApprovalSchema,
  formatMissing,
  hasValue,
  validateApprovalEligibility,
  glAccountForCostType,
  calendarMonthKey,
  getClosedPeriodInfo,
};
