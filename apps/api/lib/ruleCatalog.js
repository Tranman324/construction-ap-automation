'use strict';

/**
 * Single backend definition of the rule-builder enum catalogs and the Spectrum
 * cost-type catalog, previously hardcoded in the frontend (ruleOptions.ts,
 * SpectrumSubmitSection.tsx).
 *
 * These are the ONE source of truth: `lib/schemas.js` derives its rule
 * validation enums from `RULE_ACTIONS`/`RULE_FIELDS`/`RULE_OPERATORS` (so
 * validation and serving cannot drift — a single-source test enforces it), and
 * the serving endpoints return these same arrays. The rules engine
 * (`scripts/rules-engine.js`) implements exactly these fields/operators; the
 * legacy `greater_than`/`less_than` enum values (no engine path, no frontend
 * emission) are intentionally NOT part of the canonical operator set.
 *
 * Value-identical to the frontend constants at introduction:
 *  - RULE_ACTIONS  <- ACTION_LABELS (ruleOptions.ts)
 *  - RULE_FIELDS   <- FIELD_LABELS
 *  - RULE_OPERATORS<- OPERATOR_LABELS
 *  - RULE_STATUSES <- STATUS_OPTIONS
 *  - COST_TYPE_OPTIONS <- COST_TYPE_LABELS (SpectrumSubmitSection.tsx)
 */

const RULE_ACTIONS = [
  { value: 'auto_approve', label: 'Auto-approve' },
  { value: 'auto_discard', label: 'Auto-discard' },
  { value: 'auto_file', label: 'File it' },
  { value: 'hide_from_queue', label: 'Hide from queue' },
  { value: 'set_vendor', label: 'Set vendor' },
  { value: 'set_job', label: 'Set job number' },
  { value: 'set_classification', label: 'Set document type' },
  { value: 'assign_reviewer', label: 'Assign reviewer' },
  { value: 'add_note', label: 'Add note' },
  { value: 'flag', label: 'Flag for attention' },
  { value: 'set_phase_code', label: 'Set phase code' },
  { value: 'set_gl_account', label: 'Set GL account' },
  { value: 'set_cost_type', label: 'Set cost type' },
  { value: 'set_routing_code', label: 'Set routing code' },
];

const RULE_FIELDS = [
  { value: 'vendor_name', label: 'Vendor Name' },
  { value: 'vendor_code', label: 'Vendor Code' },
  { value: 'amount', label: 'Amount ($)' },
  { value: 'description', label: 'Description / Memo' },
  { value: 'invoice_number', label: 'Invoice Number' },
  { value: 'job_number', label: 'Job Number' },
  { value: 'classification', label: 'Document Type' },
  { value: 'status', label: 'Status' },
  { value: 'email_from', label: 'Sender Email' },
  { value: 'email_subject', label: 'Email Subject' },
];

const RULE_OPERATORS = [
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does not contain' },
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Does not equal' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'gt', label: 'Greater than' },
  { value: 'lt', label: 'Less than' },
  { value: 'gte', label: 'At least' },
  { value: 'lte', label: 'At most' },
  { value: 'between', label: 'Is between' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
];

const RULE_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'discarded', label: 'Discarded' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'retry-pending', label: 'Retry Pending' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'reviewed', label: 'Reviewed' },
];

const COST_TYPE_OPTIONS = [
  { value: 'S', label: 'S - Subcontract' },
  { value: 'M', label: 'M - Material' },
  { value: 'L', label: 'L - Labor' },
  { value: 'O', label: 'O - Other' },
  { value: 'E', label: 'E - Equipment' },
  { value: 'B', label: 'B - Bond' },
];

function values(options) {
  return options.map((option) => option.value);
}

module.exports = {
  RULE_ACTIONS,
  RULE_FIELDS,
  RULE_OPERATORS,
  RULE_STATUSES,
  COST_TYPE_OPTIONS,
  values,
};
