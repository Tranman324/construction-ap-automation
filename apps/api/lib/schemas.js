'use strict';

const { z } = require('zod');
const { RULE_ACTIONS, RULE_FIELDS, RULE_OPERATORS, values } = require('./ruleCatalog');

const uuidOrId = z.string().trim().min(1).max(100);
const stringOrNull = (max) => z.union([z.string().max(max), z.null()]);
const numberStringOrNull = z.union([z.number(), z.string().max(100), z.null()]);

const invoiceUpdateSchema = z.object({
  vendorCode: stringOrNull(50).optional(),
  vendorName: stringOrNull(200).optional(),
  invoiceNumber: stringOrNull(100).optional(),
  invoiceDate: stringOrNull(50).optional(),
  dueDate: stringOrNull(50).optional(),
  amount: numberStringOrNull.optional(),
  description: stringOrNull(2000).optional(),
  notes: stringOrNull(2000).optional(),
  jobNumber: stringOrNull(50).optional(),
  subcontractNumber: stringOrNull(50).optional(),
  costType: stringOrNull(20).optional(),
  routingCode: stringOrNull(50).optional(),
  phaseCode: stringOrNull(50).optional(),
  glAccount: stringOrNull(50).optional(),
  glDate: stringOrNull(50).optional(),
  classification: stringOrNull(100).optional(),
  displayName: stringOrNull(200).optional(),
  lienWaiverStatus: stringOrNull(50).optional(),
  projectName: stringOrNull(200).optional(),
  lienWaiverRequired: z.union([z.boolean(), z.null()]).optional(),
  waiverType: stringOrNull(100).optional(),
}).strict();

const invoiceBulkActionSchema = z.object({
  ids: z.array(uuidOrId).min(1).max(500),
  action: z.enum(['approve', 'discard', 'review', 'file', 'unapprove']),
}).strict();

const invoiceUnifiedActionSchema = z.object({
  action: z.enum([
    'file_and_release',
    'upload_to_spectrum',
    'create_vendor_upload',
    'submit_to_spectrum',
    'file_to_job_cost',
  ]),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
}).strict();

const adminUserPatchSchema = z.object({
  role_id: uuidOrId.optional(),
  is_active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

const invoiceSubmitOverrideSchema = z.object({
  approval_status: z.enum(['A', 'U']).optional(),
  routing_code: stringOrNull(50).optional(),
  gl_account: stringOrNull(50).optional(),
  phase_code: stringOrNull(50).optional(),
  cost_type: stringOrNull(20).optional(),
  gl_date: stringOrNull(50).optional(),
}).strict();

const invoiceSubmitSchema = z.object({
  ids: z.array(uuidOrId).min(1).max(500).optional(),
  overrides: z.record(uuidOrId, invoiceSubmitOverrideSchema).default({}),
}).strict().default({});

const lienWaiverLinkSchema = z.object({
  waiverId: uuidOrId,
}).strict();

const dateOnlyString = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'date must be YYYY-MM-DD',
}).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, {
  message: 'date must be a valid calendar date',
});

const statementLineAmount = z.preprocess((value) => {
  if (typeof value === 'string') return value.trim();
  return value;
}, z.union([
  z.number().finite(),
  z.string().min(1).refine((value) => Number.isFinite(Number(value)), {
    message: 'amount must be numeric',
  }).transform(Number),
]));

const statementLineCreateSchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(100),
  date: z.union([dateOnlyString, z.null()]),
  amount: statementLineAmount,
}).strict();

const statementLineUpdateSchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(100).optional(),
  date: z.union([dateOnlyString, z.null()]).optional(),
  amount: statementLineAmount.optional(),
}).strict().refine((body) => Object.keys(body).length > 0, {
  message: 'At least one field (invoiceNumber, date, amount) is required',
});

const statementLineResolveSchema = z.object({
  resolutionType: z.enum(['accept_line', 'use_ap_amount']),
}).strict();

const statementAttributeBalance = z.preprocess((value) => {
  if (typeof value === 'string') return value.trim();
  return value;
}, z.union([
  z.number().finite(),
  z.string().min(1).refine((value) => Number.isFinite(Number(value)), {
    message: 'balance must be finite',
  }).transform(Number),
]));

const statementAttributePatchSchema = z.object({
  statementPeriod: z.union([z.string().trim().min(1).max(200), z.null()]).optional(),
  balance: z.union([statementAttributeBalance, z.null()]).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, {
  message: 'At least one statement attribute is required',
});

const warrantyClassificationPatchSchema = z.object({
  providerKind: z.union([z.string().trim().min(1).max(200), z.null()]).optional(),
  warrantyType: z.union([z.string().trim().min(1).max(200), z.null()]).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, {
  message: 'At least one warranty classification is required',
});

const waiverRequestSchema = z.object({
  resend: z.boolean().optional(),
  recipientOverride: z.string().trim().email().max(320).nullable().optional(),
}).strict().default({});

// W5: inline manual add to the vendor contacts directory (the recipient
// picker dialog IS the manual entry UI — no admin pages).
const waiverContactAddSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(200).nullable().optional(),
}).strict();

// Flag a document for review ("needs attention"). Optional free-text reason.
const invoiceFlagSchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict().default({});

// Unflag takes no body input; reject any unexpected fields.
const invoiceUnflagSchema = z.object({}).strict().default({});

const ignoreRuleSchema = z.object({
  type: z.string().trim().min(1).max(50),
  value: z.string().trim().min(1).max(500).refine((value) => !/[<>]/.test(value), {
    message: 'HTML tags are not allowed',
  }),
  reason: z.string().max(500).default(''),
}).strict();

const ruleCriterionSchema = z.object({
  // field + operator enums derive from the single rule catalog (lib/ruleCatalog.js)
  // so validation and GET /api/rule-options cannot drift. The rules engine
  // implements exactly these fields/operators.
  field: z.enum(values(RULE_FIELDS)),
  operator: z.enum(values(RULE_OPERATORS)),
  values: z.array(z.string()).max(10).default([]),
}).strict().superRefine((value, ctx) => {
  if (['is_empty', 'is_not_empty'].includes(value.operator)) {
    return;
  }

  if (value.operator === 'between') {
    if (value.values.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['values'],
        message: 'between operator requires exactly 2 values',
      });
      return;
    }

    if (value.values.some((entry) => Number.isNaN(Number.parseFloat(entry)))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['values'],
        message: 'between values must be numeric',
      });
    }
    return;
  }

  if (value.values.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['values'],
      message: `values required for operator ${value.operator}`,
    });
  }
});

const CLEARABLE_RULE_ACTION_TYPES = new Set([
  'set_vendor',
  'set_job',
  'set_phase_code',
  'set_gl_account',
  'set_cost_type',
  'set_routing_code',
]);

const VALUE_REQUIRED_RULE_ACTION_TYPES = new Set([
  'set_classification',
  'assign_reviewer',
  'add_note',
]);

const ruleActionSchema = z.object({
  // Derived from the single rule catalog (lib/ruleCatalog.js).
  type: z.enum(values(RULE_ACTIONS)),
  value: z.string().max(5000).optional(),
  clear: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  const hasValue = typeof value.value === 'string' && value.value.trim().length > 0;

  if (CLEARABLE_RULE_ACTION_TYPES.has(value.type)) {
    if (value.clear === true && value.value !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `action ${value.type}: omit value when clear is true`,
      });
    } else if (value.clear !== true && !hasValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `action ${value.type}: a nonempty value or clear true is required`,
      });
    }
    return;
  }

  if (value.clear === true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['clear'],
      message: `action ${value.type}: clear is not supported`,
    });
  }

  if (VALUE_REQUIRED_RULE_ACTION_TYPES.has(value.type) && !hasValue) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: `action ${value.type}: value required`,
    });
  }
});

const ruleCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean().optional(),
  stopOnMatch: z.boolean().optional(),
  shared: z.boolean().optional(),
  criteria: z.array(ruleCriterionSchema).min(1).max(50),
  actions: z.array(ruleActionSchema).min(1).max(20),
  order: z.number().int().min(0).optional(),
  // Optional atomic create-and-apply (create-only when omitted/false).
  apply: z.boolean().optional(),
  scope: z.enum(['all', 'pending', 'queue']).optional(),
  documentIds: z.array(uuidOrId).min(1).max(500).optional(),
  includeScope: z.boolean().optional(),
  // When provided, the response includes an authoritative outcome for this
  // specific document so the frontend can decide whether to navigate away.
  sourceDocumentId: uuidOrId.optional(),
}).strict();

const ruleUpdateSchema = ruleCreateSchema
  .omit({ order: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const ruleOrderSchema = z.object({
  ids: z.array(uuidOrId).min(1).max(500),
}).strict();

const ruleApplySchema = z.object({
  ruleIds: z.array(z.union([uuidOrId, z.number().int()])).min(1).max(500).optional().transform(ids => ids?.map(id => String(id))),
  scope: z.enum(['all', 'pending', 'queue']).default('pending'),
  documentIds: z.array(uuidOrId).min(1).max(500).optional(),
  includeScope: z.boolean().default(true),
}).strict().superRefine((value, ctx) => {
  if (!value.includeScope && !value.documentIds?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['documentIds'],
      message: 'documentIds must contain at least one id when includeScope is false',
    });
  }
});

const retentionSettingSchema = z.object({
  classification: z.string().trim().min(1).max(100),
  status: z.string().trim().min(1).max(50),
  retention_days: z.coerce.number().int().min(1).max(3650).default(30),
  delete_pdf: z.boolean().default(true),
  delete_box: z.boolean().default(true),
}).strict();

const retentionUpdateSchema = z.object({
  retention_days: z.coerce.number().int().min(1).max(3650).optional(),
  delete_pdf: z.boolean().optional(),
  delete_box: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

const classificationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(100),
  action: z.enum(['view-only', 'extract-match']).default('view-only'),
  opensAs: z.enum(['invoice', 'receipt', 'statement', 'coi', 'w9', 'lien-waiver', 'other']).default('other'),
}).strict();

// Document destinations catalog (served from document_destinations). A Settings
// PUT replaces the whole config; unknown keys and malformed nodes are rejected.
const destinationFolderNodeSchema = z.lazy(() => z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  children: z.array(destinationFolderNodeSchema).default([]),
}).strict());

const documentDestinationsConfigSchema = z.object({
  rootLabel: z.string().trim().min(1).max(200),
  tree: z.array(destinationFolderNodeSchema),
  defaults: z.object({
    subcontract: z.string().trim().min(1).max(500),
    warranty: z.string().trim().min(1).max(500),
    'lien-waiver': z.string().trim().min(1).max(500),
    other: z.string().trim().min(1).max(500),
  }).strict(),
}).strict();

// Destination writes retain the legacy full-config body while allowing an
// optional effective timestamp for append-only future versions. The service
// validates the timestamp's canonical ISO representation before any query.
const documentDestinationsWriteSchema = documentDestinationsConfigSchema.extend({
  effectiveFrom: z.string().optional(),
}).strict();

// COI compliance config (served from coi_compliance_config). A PUT replaces the
// whole config; malformed values (non-integer limits, unknown keys, missing
// groups) are rejected so a bad config can't poison the client-side engine.
const coiCoverageLimitSchema = z.object({
  key: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  minimum: z.number().int().nonnegative(),
  tier: z.enum(['exception']).optional(),
}).strict();

const coiCoverageTypeSchema = z.object({
  type: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  required: z.boolean(),
  limits: z.array(coiCoverageLimitSchema),
}).strict();

const coiComplianceConfigSchema = z.object({
  certificateHolder: z.object({
    name: z.string().trim().min(1).max(300),
    nameAliases: z.array(z.string().trim().min(1).max(300)),
    address: z.string().trim().min(1).max(500),
  }).strict(),
  cancellationNoticeMinimumDays: z.number().int().nonnegative().max(3650),
  warnWindowDays: z.number().int().nonnegative().max(3650).default(30),
  coverageRequirements: z.array(coiCoverageTypeSchema).min(1),
  coverageTypeAliases: z.record(z.string(), z.string()),
}).strict();

const coiOverrideCreateSchema = z.object({
  checkId: z.string().trim().min(1).max(100),
  reason: z.string().trim().max(1000).optional(),
}).strict();

const featureRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  category: z.enum(['workflow', 'reporting', 'integration', 'design', 'admin']),
}).strict();

const featureRequestUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  category: z.enum(['workflow', 'reporting', 'integration', 'design', 'admin']).optional(),
  status: z.enum(['open', 'in_progress', 'completed', 'declined']).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

const featureVoteSchema = z.object({
  voteType: z.enum(['must_have', 'nice_to_have']),
}).strict();

const roleCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
}).strict();

const roleUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

const rolePermissionsSchema = z.object({
  permissions: z.array(z.string().trim().min(1)),
}).strict();

const userOverridesSchema = z.object({
  overrides: z.array(z.object({
    key: z.string().trim().min(1),
    granted: z.boolean(),
  }).strict()),
}).strict();

const dateTimeString = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid datetime',
});

const auditTargetTypeSchema = z.enum([
  'document',
  'invoice',
  'project',
  'user',
  'role',
  'title_rule',
  'feature_request',
  'system',
]);

const auditSeveritySchema = z.enum(['info', 'warning', 'critical']);

const auditEventActorSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  role: z.union([z.string().trim().max(100), z.null()]).default(null),
}).strict();

const auditEventTargetSchema = z.object({
  type: auditTargetTypeSchema,
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(500).optional(),
}).strict();

const auditEventCreateSchema = z.object({
  id: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(150),
  timestamp: dateTimeString,
  actor: auditEventActorSchema,
  target: auditEventTargetSchema,
  changes: z.unknown().optional(),
  beforeState: z.unknown().optional(),
  afterState: z.unknown().optional(),
  undoable: z.boolean().optional(),
  summary: z.string().trim().min(1).max(1000),
  module: z.string().trim().min(1).max(100),
  severity: auditSeveritySchema.default('info'),
}).strict();

const auditEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  type: z.string().trim().min(1).max(150).optional(),
  module: z.string().trim().min(1).max(100).optional(),
  actorId: z.string().trim().min(1).max(200).optional(),
  targetType: auditTargetTypeSchema.optional(),
  targetId: z.string().trim().min(1).max(200).optional(),
  severity: auditSeveritySchema.optional(),
  from: dateTimeString.optional(),
  to: dateTimeString.optional(),
}).strict().refine((value) => {
  if (!value.from || !value.to) return true;
  return Date.parse(value.from) <= Date.parse(value.to);
}, {
  message: 'from must be before or equal to to',
});

const titleRuleCreateSchema = z.object({
  pattern: z.string().trim().min(1),
  match_type: z.enum(['equals', 'contains', 'starts_with']),
  role_id: z.string().trim().uuid(),
  priority: z.number().int().min(0).max(1000),
  is_active: z.boolean().optional(),
}).strict();

const titleRuleUpdateSchema = z.object({
  pattern: z.string().trim().min(1).optional(),
  match_type: z.enum(['equals', 'contains', 'starts_with']).optional(),
  role_id: z.string().trim().uuid().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  is_active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

const titleRulePreviewSchema = z.object({
  jobTitle: z.string().trim().min(1),
}).strict();

const vendorFeedbackSchema = z.object({
  vendorCode: z.string().trim().min(1),
  email: z.string().optional(),
  vendorName: z.string().optional(),
}).strict();

const subcontractFeedbackSchema = z.object({
  vendorCode: z.string().trim().min(1),
  jobNumber: z.string().trim().min(1),
  subcontractNumber: z.string().trim().min(1),
}).strict();

const pipelineErrorResolveSchema = z.object({
  resolution: z.string().optional(),
}).strict();

const splitGroupSchema = z.object({
  pages: z.array(z.coerce.number().int().min(1)).min(1),
  docType: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, {
    message: 'docType must be kebab-case',
  }).optional(),
  displayName: z.string().max(200).optional(),
}).strict();

const splitConfirmSchema = z.object({
  groups: z.array(splitGroupSchema).min(1).max(100),
  discardPages: z.array(z.coerce.number().int().min(1)).max(500).default([]),
}).strict();

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.string().max(50).optional(),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().max(500).optional(),
  status: z.string().max(50).optional(),
  splitFrom: z.string().max(100).optional(),
  classification: z.string().max(100).optional(),
  filed: z.enum(['true', 'false']).optional(),
});

// Use this for list endpoints that accept only the shared pagination contract.
// Endpoint-specific filters belong in a dedicated strict schema below.
const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const invoicePanelGroupSchema = z.enum([
  'invoice', 'receipt', 'statement', 'coi', 'w9', 'lien-waiver', 'other',
]);
const invoiceListSortSchema = z.enum([
  'date', 'vendor', 'amount', 'invoice', 'job', 'received',
  // Existing dashboard deep links use these client-side sort labels. The
  // collection service safely retains its established date-order fallback.
  'classification', 'waivers-first',
]);
const invoiceListSortDirSchema = z.enum(['asc', 'desc']);
const invoiceListStatusSchema = z.enum([
  'all', 'documents', 'pending', 'modified', 'approved', 'rejected', 'discarded',
  'submitted', 'submitting', 'retry-pending', 'duplicate', 'reviewed',
  'needs-split', 'split-processing', 'split',
]);

// Offset intentionally remains optional. The collection service distinguishes an
// omitted offset (page-based navigation) from an explicit offset (offset wins).
const invoiceListQueryFields = {
  status: invoiceListStatusSchema.default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).optional(),
  sort: invoiceListSortSchema.default('date'),
  sortDir: invoiceListSortDirSchema.default('asc'),
  search: z.string().trim().max(500).default(''),
  classification: z.string().trim().min(1).max(100).optional(),
  panel: invoicePanelGroupSchema.optional(),
  filed: z.enum(['true', 'false']).optional(),
  flagged: z.enum(['true', 'false']).optional(),
  splitFrom: uuidOrId.optional(),
  // Global search is an explicit opt-in because it deliberately ignores the
  // ordinary queue/shelf/trash scope filters.
  scope: z.enum(['global']).optional(),
};

const invoiceListQuerySchema = z.object(invoiceListQueryFields).strict().superRefine((query, context) => {
  if (query.scope === 'global' && query.search.trim().length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['search'], message: 'Global search requires a nonblank search term' });
  }
});
// Keyset neighbors share the list filter + sort vocabulary but never paginate
// (they seek a single prev/next), so page/limit/offset are excluded.
const {
  page: _invoiceNeighborsPage,
  limit: _invoiceNeighborsLimit,
  offset: _invoiceNeighborsOffset,
  scope: _invoiceNeighborsScope,
  ...invoiceNeighborsQueryFields
} = invoiceListQueryFields;
const invoiceNeighborsQuerySchema = z.object(invoiceNeighborsQueryFields).strict();
const invoiceStatsQuerySchema = z.object({
  filed: z.enum(['true', 'false']).optional(),
  panel: invoicePanelGroupSchema.optional(),
}).strict();
const invoiceTrashQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).optional(),
  search: z.string().trim().max(500).default(''),
  panel: invoicePanelGroupSchema.optional(),
}).strict();

const jobsQuerySchema = z.object({
  search: z.string().trim().max(200).default(''),
  status: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const sharePointFolderQuerySchema = z.object({
  path: z.string().trim().max(1000).default(''),
}).strict();

const jobNumberParamsSchema = z.object({
  jobNumber: z.string().trim().min(1).max(100),
}).strict();

const vendorsQuerySchema = z.object({
  search: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const featureRequestsQuerySchema = z.object({
  category: z.enum(['workflow', 'reporting', 'integration', 'design', 'admin', 'all']).optional(),
  // Preserve the long-standing no-query default while allowing the explicit
  // all-status board view through a bounded, strict contract.
  status: z.enum(['open', 'in_progress', 'completed', 'declined', 'all']).default('open'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const splitQueueQuerySchema = z.object({
  sort: z.enum(['pages', 'vendor', 'received']).default('received'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const waiverPanelQuerySchema = z.object({
  vendor: z.string().trim().max(100).optional(),
  job: z.string().trim().max(100).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const subcontractsQuerySchema = z.object({
  vendorCode: z.string().trim().max(100).default(''),
  jobNumber: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const resourceIdParamsSchema = z.object({
  id: uuidOrId,
}).strict();

const documentAttachmentParamsSchema = z.object({
  id: uuidOrId,
  attachmentId: uuidOrId,
}).strict();

const lienWaiverOrphansQuerySchema = z.object({
  vendorCode: z.string().trim().max(100).optional(),
  jobNumber: z.string().trim().max(100).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  page: z.coerce.number().int().min(1).default(1),
  offset: z.coerce.number().int().min(0).optional(),
}).strict();

// Resource-scoped orphan lists deliberately use a fixed page size. The server
// derives vendor priority from the target document; clients cannot supply it.
const orphanCandidatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().max(200).optional(),
}).strict();

const pipelineErrorsQuerySchema = z.object({
  resolved: z.enum(['true', 'false', 'all']).default('false'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const classificationsQuerySchema = z.object({
  include: z.enum(['associations']).optional(),
  // The web hook has always requested the complete classification set with
  // `?include=associations&status=all`. The route intentionally returns all
  // built-in/custom classifications, so preserve that bounded query contract.
  status: z.literal('all').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const glAccountsQuerySchema = z.object({
  type: z.enum(['E', 'I', 'A', 'L', 'C']).optional(),
  search: z.string().trim().max(200).optional(),
  costType: z.string().trim().min(1).max(20).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const commentCreateSchema = z.object({
  body: z.string().trim().min(1).max(2000),
}).strict();

const documentReplySchema = z.object({ body: z.string().min(1).max(5000), recipient: z.string().trim().email().max(320).optional() }).strict();
const documentForwardSchema = z.object({
  recipients: z.array(z.string().uuid()).min(1).max(10), body: z.string().max(5000),
}).strict();
const documentEmailTokenSchema = z.string().uuid();
const documentEmailQuerySchema = z.object({}).strict();
const documentEmailAttemptParamsSchema = z.object({ attemptId: uuidOrId }).strict();
const documentEmailEmptyBodySchema = z.object({}).strict().default({});
const documentAttachmentEmptyBodySchema = z.object({}).strict().default({});

module.exports = {
  commentCreateSchema,
  documentReplySchema, documentForwardSchema, documentEmailTokenSchema, documentEmailQuerySchema,
  documentEmailAttemptParamsSchema, documentEmailEmptyBodySchema,
  documentAttachmentParamsSchema, documentAttachmentEmptyBodySchema,
  documentDestinationsConfigSchema,
  documentDestinationsWriteSchema,
  coiComplianceConfigSchema,
  coiOverrideCreateSchema,
  uuidOrId,
  adminUserPatchSchema,
  invoiceUpdateSchema,
  invoiceBulkActionSchema,
  invoiceUnifiedActionSchema,
  invoiceFlagSchema,
  invoiceUnflagSchema,
  invoiceSubmitSchema,
  lienWaiverLinkSchema,
  statementLineCreateSchema,
  statementLineUpdateSchema,
  statementLineResolveSchema,
  statementAttributePatchSchema,
  warrantyClassificationPatchSchema,
  waiverRequestSchema,
  waiverContactAddSchema,
  ignoreRuleSchema,
  ruleCriterionSchema,
  ruleActionSchema,
  ruleCreateSchema,
  ruleUpdateSchema,
  ruleOrderSchema,
  ruleApplySchema,
  retentionSettingSchema,
  retentionUpdateSchema,
  classificationSchema,
  featureRequestSchema,
  featureRequestUpdateSchema,
  featureVoteSchema,
  roleCreateSchema,
  roleUpdateSchema,
  rolePermissionsSchema,
  userOverridesSchema,
  auditEventCreateSchema,
  auditEventsQuerySchema,
  titleRuleCreateSchema,
  titleRuleUpdateSchema,
  titleRulePreviewSchema,
  vendorFeedbackSchema,
  subcontractFeedbackSchema,
  pipelineErrorResolveSchema,
  splitGroupSchema,
  splitConfirmSchema,
  paginationSchema,
  paginationQuerySchema,
  invoiceListQuerySchema,
  invoiceNeighborsQuerySchema,
  invoiceStatsQuerySchema,
  invoiceTrashQuerySchema,
  jobsQuerySchema,
  sharePointFolderQuerySchema,
  jobNumberParamsSchema,
  vendorsQuerySchema,
  featureRequestsQuerySchema,
  splitQueueQuerySchema,
  waiverPanelQuerySchema,
  subcontractsQuerySchema,
  resourceIdParamsSchema,
  lienWaiverOrphansQuerySchema,
  orphanCandidatesQuerySchema,
  pipelineErrorsQuerySchema,
  classificationsQuerySchema,
  glAccountsQuerySchema,
};
