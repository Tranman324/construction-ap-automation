// ─── Criteria ────────────────────────────────────────────────────────────────

/**
 * Fields on an Invoice that a criterion can target.
 */
export type RuleCriteriaField =
  | 'vendor_name'       // invoice.extracted.vendorName
  | 'vendor_code'       // invoice.matching.vendor.vendorCode
  | 'amount'            // invoice.extracted.amount
  | 'description'       // invoice.extracted.description
  | 'invoice_number'    // invoice.extracted.invoiceNumber
  | 'job_number'        // invoice.extracted.jobNumber OR matching.job.jobNumber
  | 'classification'    // invoice.classification (ClassificationType)
  | 'status'            // invoice.status (InvoiceStatus)
  | 'email_from'        // invoice.email.from
  | 'email_subject';    // invoice.email.subject

export type RuleCriteriaOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'starts_with'
  | 'ends_with'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'between'       // values must be [min, max]
  | 'is_empty'      // no value needed
  | 'is_not_empty'; // no value needed

/**
 * A single criterion row. Multiple values use OR logic within the row.
 * All criterion rows in a rule use AND logic between them.
 */
export interface RuleCriterion {
  field: RuleCriteriaField;
  operator: RuleCriteriaOperator;
  values: string[]; // always strings; numeric parsing handled by engine
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type RuleActionType =
  | 'auto_approve'        // sets status → 'approved'
  | 'auto_discard'        // sets status → 'discarded'
  | 'auto_file'           // sets filed = true
  | 'hide_from_queue'     // client-side filter only — no DB change
  | 'set_vendor'          // value = vendorCode
  | 'set_job'             // value = jobNumber
  | 'set_classification'  // value = ClassificationType string
  | 'assign_reviewer'     // value = userId (Azure AD)
  | 'add_note'            // value = note text (appended)
  | 'flag'                // sets flagged = true
  | 'set_phase_code'      // value = phase code (e.g. '01502')
  | 'set_gl_account'      // value = GL account (e.g. '5300')
  | 'set_cost_type'       // value = cost type (e.g. 'E')
  | 'set_routing_code';   // value = routing code (e.g. 'LP')

/**
 * A single action to apply when criteria match.
 * `value` required for: set_vendor, set_job, set_classification, assign_reviewer, add_note,
 *                       set_phase_code, set_gl_account, set_cost_type, set_routing_code
 * `value` ignored for: auto_approve, auto_discard, auto_file, hide_from_queue, flag
 */
export interface RuleAction {
  type: RuleActionType;
  value?: string;
  /** Clears the target field instead of assigning `value`; supported only by clearable setter actions. */
  clear?: boolean;
}

// ─── Rule ────────────────────────────────────────────────────────────────────

export interface Rule {
  id: string;
  name: string;
  isActive: boolean;
  order: number;           // ascending priority — 0 runs first
  stopOnMatch: boolean;    // if true, no further rules run for this invoice
  criteria: RuleCriterion[];
  actions: RuleAction[];
  createdAt: string;       // ISO 8601
  updatedAt: string;
  createdBy: string;
}

// ─── API Payload / Response Types ────────────────────────────────────────────

/** POST /api/rules */
export interface RuleCreatePayload {
  name: string;
  isActive: boolean;
  order?: number;
  stopOnMatch?: boolean;
  criteria: RuleCriterion[];
  actions: RuleAction[];
  /** Atomic create-and-apply: create the rule and apply it in ONE transaction. */
  apply?: boolean;
  scope?: 'all' | 'pending' | 'queue';
  documentIds?: string[];
  includeScope?: boolean;
  /** The explicitly opened document whose post-apply result drives local navigation. */
  sourceDocumentId?: string;
}

/** POST /api/rules with `apply: true` — atomic create-and-apply result. */
export interface RuleCreateAndApplyResponse {
  rule: Rule;
  applied: { matchedInvoices: number; actionsApplied: number };
  sourceOutcome?: { id: string; matched: boolean; status: string | null };
}

/** PATCH /api/rules/:id */
export interface RuleUpdatePayload {
  name?: string;
  isActive?: boolean;
  stopOnMatch?: boolean;
  criteria?: RuleCriterion[];
  actions?: RuleAction[];
}

/** PUT /api/rules/order */
export interface RuleReorderPayload {
  ids: string[];
}

export interface RuleReorderResponse {
  updated: number;
}

/** POST /api/rules/apply */
export interface RuleApplyPayload {
  ruleIds?: string[];
  scope: 'all' | 'pending' | 'queue';
  documentIds?: string[];
  includeScope?: boolean;
}

export interface RuleApplyResponse {
  matchedInvoices: number;
  actionsApplied: number;
  errors: number;
  durationMs: number;
}

/** GET /api/rules */
export interface RuleListResponse {
  rules: Rule[];
  total: number;
}
