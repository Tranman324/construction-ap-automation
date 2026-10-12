'use strict';

/**
 * Approval-state composer — assembles the complete approval/coding verdict for a
 * document from the EXISTING single-source backend services. It re-derives
 * nothing: every field is sourced from the service that owns it, so the frontend
 * (approvalValidation.ts) can be retired without duplicating logic.
 *
 * Per-field provenance:
 *   path            <- approvalValidator.validateApproval (getApprovalPath)
 *   requiredFields  <- approvalValidator.validateApproval (per-path rules, multi-phase-aware)
 *   blockers        <- approvalValidator.validateApprovalEligibility evaluated on the
 *                      EFFECTIVE row (row merged with served codingDefaults) — the SAME
 *                      merge invoiceApprovalService/bulkActionService validate and
 *                      persist, so blockers match the mutations exactly.
 *   unbilledBalance <- subcontract sidecar (getSubcontractsMap), the source getApprovalPath uses.
 *   suggestedRouting* <- phaseOptionsService.findSuggestedRouting (PM->routing sidecar).
 *   codingDefaults  <- documented composition (see deriveCodingDefaults). All
 *                      policy values come from approvalRules.json codingDefaults
 *                      (no literals here). Advisory pre-fill only — NOT persisted
 *                      state. Precedence: row/trigger value, else configured default.
 *                      costType: subcontract -> 'S' (trg_default_cost_type-consistent),
 *                      else 'M'. glAccount: from the effective cost type via the
 *                      Spectrum cost-type→GL master (costTypeGlMap), else
 *                      subcontract -> 5450 / non-subcontract -> 5300.
 *   asOf            <- server time of computation.
 */

const rules = require('./approvalRules.json');
const {
  validateApproval,
  validateApprovalEligibility,
  hasValue,
  glAccountForCostType,
} = require('./approvalValidator');
const { getSubcontractsMap } = require('./matching');
const { findSuggestedRouting } = require('./phaseOptionsService');

// Unbilled balance from the subcontract sidecar (null when no subcontract) —
// the same source getApprovalPath consumes.
function subcontractUnbilledBalance(row) {
  if (!row.subcontract_number) return null;
  const sub = getSubcontractsMap()[row.subcontract_number];
  return sub ? parseFloat(sub.unbilled) || 0 : null;
}

// Human-readable blockers + structured details built ENTIRELY from the shared
// approve/bulk-approve gate (validateApprovalEligibility), evaluated on the
// EFFECTIVE row (row values merged with the served codingDefaults) — the exact
// same merge the approve mutations validate and persist.
// Returns { blockers: string[], blockerDetails: object[] }.
function buildBlockers(effectiveRow, invoiceId, duplicateStatus = null) {
  const eligibility = validateApprovalEligibility(effectiveRow, { invoiceId, closedPeriodDateSource: 'invoice', duplicateStatus });
  if (!eligibility.error) return { blockers: [], blockerDetails: [] };
  if (Array.isArray(eligibility.missing)) {
    const blockers = eligibility.missing.map((field) => `${rules.fieldLabels[field] || field} is required`);
    const blockerDetails = [{ code: 'MISSING_FIELDS', missing: eligibility.missing, path: eligibility.path }];
    return { blockers, blockerDetails };
  }
  // Structured blocker: pass through every key except `error` (which becomes
  // the human-readable string in blockers[]).
  const { error, ...detail } = eligibility;
  return { blockers: [error], blockerDetails: [detail] };
}

// codingDefaults: the coding values a client should pre-fill, consolidating the
// GL/cost-type/phase/routing/GL-date defaults the frontend derives today.
function deriveCodingDefaults(row, approvalPathRules, phaseInfo) {
  const hasSubcontract = hasValue(row.subcontract_number);
  const codingPolicy = rules.codingDefaults;

  // cost type: existing value wins; else subcontract -> configured subcontract
  // default ('S', trg_default_cost_type-consistent); else the configured
  // non-subcontract default ('M'). Policy values live in approvalRules.json — no
  // literal here. (The former phaseInfo cost_type branch was unreachable: a row
  // with a subcontract already resolves to the subcontract default above, and
  // phaseInfo is only populated for subcontract rows.)
  let costType;
  if (hasValue(row.cost_type)) costType = row.cost_type;
  else if (hasSubcontract) costType = codingPolicy.costType.subcontractDefault;
  else costType = codingPolicy.costType.nonSubcontractDefault;

  // phase code: existing value; else the subcontract's phase (exact for
  // single-phase subcontracts; multi-phase docs skip the doc-level phase_code).
  const phaseCode = hasValue(row.phase_code)
    ? row.phase_code
    : (phaseInfo && phaseInfo.aggregatedPhases && phaseInfo.aggregatedPhases[0]
      ? phaseInfo.aggregatedPhases[0].phase_code
      : null);

  // routing code: existing value; else the path's auto-routing default (paths 1/3
  // default to 'D'; path 2 requires an explicit code, so no default).
  const routingCode = hasValue(row.routing_code)
    ? row.routing_code
    : (approvalPathRules && approvalPathRules.autoRouting && approvalPathRules.autoRouting.enabled
      ? approvalPathRules.autoRouting.defaultCode
      : null);

  // GL date defaults to the invoice date when unset.
  const glDate = row.gl_date || row.invoice_date || null;

  // GL account: existing value wins; else derived from the EFFECTIVE cost type
  // via the Spectrum cost-type→GL master (approvalRules.json costTypeGlMap:
  // S→5450, M→5300, E→5500, ...), so an edited cost type pre-fills the GL
  // Spectrum will actually accept; else the legacy subcontract/non-subcontract
  // policy (5450/5300) for unmapped cost types. No literals here (B2).
  const glAccount = hasValue(row.gl_account)
    ? row.gl_account
    : (glAccountForCostType(costType)
      || (hasSubcontract ? codingPolicy.glAccount.subcontract : codingPolicy.glAccount.nonSubcontract));

  return { glAccount, costType, phaseCode, routingCode, glDate };
}

// codingDefaults camelCase key -> documents column it fills.
const CODING_COLUMN_MAP = {
  gl_account: 'glAccount',
  cost_type: 'costType',
  phase_code: 'phaseCode',
  routing_code: 'routingCode',
  gl_date: 'glDate',
};

/**
 * Compute the effective coding state for a row: the served codingDefaults, the
 * columns those defaults would FILL (`applied` — only columns that are unset on
 * the row and have a non-null default), and the resulting `effectiveRow`
 * (row merged with `applied`).
 *
 * This is the single merge shared by the verdict endpoint (blockers) and the
 * approve mutations (validate + persist) — preview and action always agree.
 */
function getEffectiveCoding(row, { log } = {}) {
  const unbilledBalance = subcontractUnbilledBalance(row);
  const validation = validateApproval(row, { unbilledBalance });
  const approvalPathRules = rules.paths[validation.path] || null;

  // Subcontract phase info (drives suggested routing + phase defaults).
  let phaseInfo = null;
  if (row.subcontract_number) {
    const { getSubcontractPhaseInfo } = require('./matcher');
    phaseInfo = getSubcontractPhaseInfo(row.subcontract_number);
  }

  const codingDefaults = deriveCodingDefaults(row, approvalPathRules, phaseInfo);
  const applied = {};
  for (const [column, defaultKey] of Object.entries(CODING_COLUMN_MAP)) {
    if (!hasValue(row[column]) && hasValue(codingDefaults[defaultKey])) {
      applied[column] = codingDefaults[defaultKey];
    }
  }

  return {
    unbilledBalance,
    validation,
    phaseInfo,
    codingDefaults,
    applied,
    effectiveRow: { ...row, ...applied },
  };
}

/**
 * Compose the full approval-state contract for a document row.
 * @param {object} row - full documents row (snake_case columns)
 * @param {object} [opts]
 * @param {string} [opts.invoiceId] - id for gate next-action hints
 * @param {object} [opts.log] - optional request logger for routing sidecar warnings
 */
function buildApprovalState(row, { invoiceId, log, duplicateStatus = null } = {}) {
  const {
    unbilledBalance,
    validation,
    phaseInfo,
    codingDefaults,
    effectiveRow,
  } = getEffectiveCoding(row, { log });

  let suggestedRoutingCode = null;
  let suggestedRoutingPm = null;
  if (phaseInfo) {
    const routing = findSuggestedRouting(row, phaseInfo, { log });
    suggestedRoutingCode = routing.suggestedRoutingCode;
    suggestedRoutingPm = routing.suggestedRoutingPm;
  }

  const { blockers, blockerDetails } = buildBlockers(effectiveRow, invoiceId, duplicateStatus);

  return {
    path: validation.path,
    requiredFields: validation.requiredFields || [],
    blockers,
    blockerDetails,
    unbilledBalance,
    asOf: new Date().toISOString(),
    codingDefaults,
    suggestedRoutingCode,
    suggestedRoutingPm,
  };
}

module.exports = { buildApprovalState, getEffectiveCoding };
