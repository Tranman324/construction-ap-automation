import type { Invoice, StatementLine, StatementLineStatus } from '@/modules/accounting/modules/invoices/types/invoice';

export type {
  StatementReconcileBlocker,
  StatementReconcileState,
} from '@/modules/accounting/modules/invoices/types/invoice';

/** PATCH /api/invoices/:id/statement-attributes. Null clears only a manual value. */
export interface UpdateStatementAttributesPayload {
  statementPeriod?: string | null;
  balance?: number | null;
}

export interface UpdateStatementAttributesResponse {
  invoice: Invoice;
}

/** PATCH /api/invoices/:id/warranty-classification. Null clears one manual slot. */
export interface UpdateWarrantyClassificationPayload {
  providerKind?: string | null;
  warrantyType?: string | null;
}

export interface UpdateWarrantyClassificationResponse {
  invoice: Invoice;
}

// ─── Query Response Shapes ───────────────────────────────────────────────────

/** GET /api/invoices */
export interface InvoiceListResponse {
  invoices: Invoice[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/** POST /api/invoices/:id/reprocess. Acceptance does not mean pipeline completion. */
export interface ReprocessInvoiceResponse {
  success: true;
  id: string;
  status: string;
}

/** Slim invoice row shape reused by the detail panel's trash navigation list. */
export interface InvoiceNavItem {
  id: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  status: string;
  amount: number | null;
}

/** GET /api/invoices/:id/neighbors — server-computed keyset prev/next (ids or null). */
export interface InvoiceNeighborsResponse {
  prev: string | null;
  next: string | null;
  /** Anchor's 1-based rank in the filtered order ("N"); null when out of set. */
  position: number | null;
  /** Count of rows matching the filter ("M"). */
  total: number;
}

/** GET /api/invoices/trash */
export interface TrashListResponse {
  invoices: Invoice[];
  total: number;
  limit: number;
  offset: number;
}

/** GET /api/invoices/stats */
export interface DashboardStats {
  total: number;
  activeTotal?: number;
  trashTotal?: number;
  shelfTotal?: number;
  globalTotal?: number;
  pending: number;
  approved: number;
  rejected: number;
  submitted: number;
  discarded: number;
  duplicate: number;
  reviewed: number;
  errors: number;
  skipped: number;
  /** Count of non-deleted documents flagged for review (flaggedAt !== null); excluded from all bucket totals. */
  flaggedCount?: number;
  todayProcessed: number;
  avgConfidence: number;
  missingLienWaivers: number;
  amounts: {
    pending: number;
    approved: number;
    submitted: number;
    total: number;
  };
}

/** GET /api/vendors */
export interface Vendor {
  code: string;
  name: string;
}

/** GET /api/jobs */
export interface Job {
  number: string;
  description: string;
  address: string;
  status: string;
  pm: string;
}

/** GET /api/subcontracts */
export interface SubcontractPhase {
  phaseCode?: string;
  phase_code?: string;
  costType?: string;
  cost_type?: string;
  description?: string;
  originalAmount?: number;
  amountBilled?: number;
}

/** GET /api/subcontracts */
export interface Subcontract {
  subcontractNumber: string;
  job: string;
  vendorCode: string;
  vendor: string;
  revContract: number;
  totalBilled: number;
  status: string;
  phases?: SubcontractPhase[];
  phaseCode?: string;
  phase_code?: string;
  costType?: string;
  cost_type?: string;
}

/** GET /api/routing-codes */
export interface RoutingCodeOption {
  code: string;
  description: string;
  confirm_by?: string;
  approvers?: Array<{
    sequence: string;
    operator: string;
    limit: number;
  }>;
}

/** GET /api/routing-codes */
export interface RoutingCodesResponse {
  routing_codes: RoutingCodeOption[];
  pm_to_routing: Record<string, string>;
  refreshed_at?: string;
}

/** GET /api/phase-codes */
export interface PhaseCodeOption {
  phase_code: string;
  description: string;
  default_cost_type: string;
}

/** GET /api/phase-codes */
export interface PhaseCodesResponse {
  phase_codes: PhaseCodeOption[];
  cost_types: string[];
  refreshed_at?: string;
}

/** GET /api/gl-accounts */
export interface GlAccountOption {
  code: string;
  description: string;
  accountType?: string;
  account_type?: string;
  costType?: string;
  cost_type?: string;
  active?: boolean;
}

/** GET /api/gl-accounts */
export interface GlAccountsResponse {
  gl_accounts: GlAccountOption[];
  refreshed_at?: string;
}

/**
 * Server-authoritative approval/coding verdict.
 * GET /api/validate-approval/:id — the single source that retires the former
 * client-side `approvalValidation.ts` derivation and the `derivedGlAccount` /
 * `derivedCostType` coding literals. There is NO client fallback: when the
 * query is unavailable, consumers disable approve and render an explicit
 * unavailable state rather than re-deriving anything.
 */
export interface ApprovalCodingDefaults {
  /** Row `gl_account`, else config default (subcontract "5450" / otherwise "5300"). */
  glAccount: string;
  /** Row `cost_type`, else config default (subcontract "S" / otherwise "M"). */
  costType: string;
  phaseCode: string | null;
  /** Path 1/3 auto-routing default ("D"); null on path 2. */
  routingCode: string | null;
  /** Defaults to invoice_date; null when unset. */
  glDate: string | null;
}

export interface ApprovalBlockerDetail {
  code: string;
  duplicateState?: DuplicateState;
  duplicateEvidence?: DuplicateEvidence | null;
  /** Canonical invoice-date recovery fields served by the approval endpoint. */
  invoiceDateMonth?: string;
  suggestedInvoiceDate?: string;
  /** Legacy aliases retained while the backend dual-emits the W7 fields. */
  glDateMonth?: string;
  currentMonth?: string;
  suggestedGlDate?: string;
  nextAction?: string;
}

export type DuplicateState = "spectrum" | "toolbox" | "stale" | "none";

export interface DuplicateEvidence {
  invoiceNumber: string | null;
  normalizedInvoiceNumber: string | null;
  vendorCode: string | null;
  amount: number | null;
  duplicateOf: string | null;
  originalDiscardedAt: string | null;
}

/** GET /api/invoices/:id/duplicate-status — live server evaluation. */
export interface DuplicateStatusResponse {
  state: DuplicateState;
  spectrum: { source: string; invoiceNumber: string | null; vendorCode: string | null; amount: number | null } | null;
  original: { id: string; status: string; amount: number | null; invoiceNumber: string | null; fileName: string | null } | null;
  bypassed: { at: string | null; by: string | null } | null;
  evidence: DuplicateEvidence | null;
}

/** POST /api/invoices/:id/duplicate-bypass(/revert) — response */
export interface DuplicateBypassResponse {
  duplicateBypassed: boolean;
  at?: string | null;
  by?: string | null;
}

export interface ApprovalState {
  /** 1 = job + subcontract within budget, 2 = job-only/over-budget, 3 = no job. */
  path: "1" | "2" | "3";
  /** Per-path required columns (multi-phase-aware). */
  requiredFields: string[];
  /** Human-readable; matches what approve/bulk-approve reject (empty = allowed). */
  blockers: string[];
  /** Structured blocker metadata; clients must use code rather than blocker copy. */
  blockerDetails: ApprovalBlockerDetail[];
  /** Subcontract sidecar; null when no subcontract. */
  unbilledBalance: number | null;
  /** ISO server timestamp. */
  asOf: string;
  codingDefaults: ApprovalCodingDefaults;
  /** phaseOptionsService PM→routing; null unless over-budget with a job PM. */
  suggestedRoutingCode: string | null;
  suggestedRoutingPm: string | null;
}

/** GET /api/ignore-rules */
export interface IgnoreRule {
  id: string;
  type: 'sender' | 'domain' | 'classification';
  value: string;
  reason: string;
  createdAt?: string;
}

/** GET /api/retention */
export interface RetentionRule {
  id: number;
  classification: string;
  status: string;
  retentionDays: number;
  deletePdf: boolean;
  deleteBox: boolean;
  updatedAt: string;
  updatedBy: string;
  appliesTo: string;
}

/** POST /api/retention */
export interface RetentionRuleCreatePayload {
  classification: string;
  status: string;
  retention_days: number;
  delete_pdf: boolean;
  delete_box: boolean;
}

/** PUT /api/retention/:id */
export interface RetentionRuleUpdatePayload {
  retention_days?: number;
  delete_pdf?: boolean;
  delete_box?: boolean;
}

/** DELETE /api/retention/:id */
export interface RetentionRuleDeleteResponse {
  deleted: boolean;
}

/** GET /api/pipeline/status */
export interface PipelineStatus {
  running: boolean;
  lastRun: string | null;
  lastResult: {
    processed: number;
    queued: number;
    errors: number;
    /** True when the run exited abnormally or its result could not be correlated. */
    failed?: boolean;
  } | null;
}

/** POST /api/invoices/bulk — response */
export interface BulkActionSkip {
  id: string;
  invoiceNumber: string | null;
  reason?: string;
  error?: string;
  code?: string;
  /** Required approval fields that are missing when an approval is skipped. */
  missing?: string[];
  /** Approval-rule path selected for a missing-fields approval skip. */
  path?: string;
  /** Subcontract context returned for multi-phase approval skips. */
  subcontractNumber?: string | null;
  /** Remediation guidance returned for multi-phase approval skips. */
  nextAction?: string;
  /** Amount context returned when PM routing is required. */
  invoiceAmount?: number;
  subcontractUnbilled?: number;
  overageAmount?: number;
}

export interface BulkActionResponse {
  updated: number;
  skipped?: number;
  skippedInvoices?: BulkActionSkip[];
  message?: string;
}

/** POST /api/invoices/submit — response */
export type SubmitWaiverDiscardOutcome =
  | "discarded"
  | "already_discarded"
  | "no_link"
  | "not_found"
  | "not_lien_waiver"
  | "link_changed"
  | "protected"
  | "raced";

export interface SubmitResponse {
  success: boolean;
  submitted: number;
  message: string;
  total?: number;
  results?: Array<{
    id: string;
    success: boolean;
    invoiceNumber?: string;
    linkedDocs?: number;
    waiverDiscard?: SubmitWaiverDiscardOutcome;
    error?: string;
  }>;
}

/** POST /api/invoices/submit — duplicate local identity entry in a 400 response */
export interface DuplicateSubmitIdentity {
  vendorCode: string;
  invoiceNumber: string;
  documentIds: string[];
  /** Why this vendor + invoice-number identity cannot be submitted. */
  reason?: "already_submitted" | "batch_duplicate";
  /** Documents that share the duplicate identity, including their current status. */
  documents?: Array<{
    id: string;
    status: string;
    jobNumber: string | null;
    amount: number | null;
  }>;
}

/** POST /api/invoices/submit — duplicate local identity 400 response */
export interface DuplicateSubmitResponse {
  error: string;
  detail: string;
  duplicates: DuplicateSubmitIdentity[];
  details: {
    detail: string;
    duplicates: DuplicateSubmitIdentity[];
  };
}

export interface InvoiceActionMetadata {
  actionId: string | null;
  type: string;
  undoable: boolean;
  timestamp?: string;
  undoEndpoint?: string;
  reason?: string;
}

export interface SharePointUploadResult {
  uploaded: boolean;
  webUrl?: string;
  itemId?: string;
  filename?: string;
  warning?: string;
  error?: string;
}

export interface SharePointDeleteResult {
  deleted: boolean;
  itemId: string;
  driveId: string;
  warning?: string;
}

export interface InvoiceUndoableActionActor {
  userId: string | null;
  name: string | null;
  role: string | null;
}

export interface InvoiceUndoableActionTarget {
  type: string;
  id: string;
  label?: string;
}

/** GET /api/invoices/:id/actions — shared audit event shape */
export interface InvoiceUndoableAction {
  id: string;
  type: string;
  timestamp: string | null;
  actor: InvoiceUndoableActionActor;
  target: InvoiceUndoableActionTarget;
  changes?: unknown;
  beforeState?: unknown;
  afterState?: unknown;
  undoable: boolean;
  undoneAt: string | null;
  undoneBy: string | null;
  summary: string | null;
  module: string | null;
  severity: string | null;
}

/** GET /api/invoices/:id/actions — response */
export interface InvoiceActionsResponse {
  actions: InvoiceUndoableAction[];
}

/** POST /api/invoices/:id/file — request body */
export interface FileDocumentPayload {
  destination?: string;
  destinationAbsolute?: string;
  filename?: string;
  note?: string;
  holdReason?: string;
  uploadToSharePoint?: boolean;
}

/** POST /api/invoices/:id/file — response */
export interface FileDocumentResponse {
  invoice: Invoice;
  action?: InvoiceActionMetadata;
  sharePoint?: SharePointUploadResult;
}

/** POST /api/invoices/:id/file — guarded 409 response, optionally with orphan cleanup warning */
export interface FileDocumentGuardedResponse {
  error: string;
  code: string;
  details?: {
    filing?: {
      fileName?: string | { value?: string };
    };
  };
  sharePoint?: SharePointUploadResult;
}

/** POST /api/invoices/:id/discard — response */
export interface DiscardInvoiceResponse {
  invoice: Invoice;
  action?: InvoiceActionMetadata;
}

/** POST /api/invoices/:id/approve — response */
export interface ApproveInvoiceResponse {
  invoice: Invoice;
  action?: InvoiceActionMetadata;
}

/** POST /api/invoices/:id/actions/:actionId/undo — success response */
export interface UndoActionResponse {
  invoice: Invoice;
  undoneActionId: string;
  sharePoint?: SharePointDeleteResult;
}

/** POST /api/invoices/:id/actions/:actionId/undo — expired file undo response */
export interface UndoWindowExpiredResponse {
  error: string;
  code: 'UNDO_WINDOW_EXPIRED';
  details: {
    actionId: string;
    undoWindowSeconds: 300;
    expiresAt?: string;
  };
}

export type UndoActionErrorCode =
  | 'ACTION_NOT_FOUND'
  | 'ALREADY_UNDONE'
  | 'ACTION_NOT_UNDOABLE'
  | 'STATE_CHANGED_SINCE_ACTION';

/** POST /api/invoices/:id/actions/:actionId/undo — non-expiry error response */
export interface UndoActionErrorResponse {
  error: string;
  code: UndoActionErrorCode;
  details?: {
    actionId?: string;
    staleFields?: string[];
  };
}

export type UndoActionFailureResponse = UndoWindowExpiredResponse | UndoActionErrorResponse;

/** POST /api/invoices/:id/reconcile and /unreconcile — response */
export interface ReconcileDocumentResponse {
  invoice: Invoice;
  action?: InvoiceActionMetadata;
}

/** POST /api/invoices/:id/flag — response */
export interface FlagDocumentResponse {
  invoice: Invoice;
  auditId: string | null;
}

/** POST /api/invoices/:id/unflag — response */
export interface UnflagDocumentResponse {
  invoice: Invoice;
}

/** POST /api/invoices/:id/statement-lines — request body */
export interface AddStatementLinePayload {
  invoiceNumber: string;
  date: string | null;
  amount: number | string;
}

/** POST /api/invoices/:id/statement-lines — response */
export interface AddStatementLineResponse {
  invoice: Invoice;
  statementLines: StatementLine[];
  addedLine: StatementLine & { source: 'manual' };
}

/** PATCH /api/invoices/:id/statement-lines/:lineId — request body */
export interface UpdateStatementLinePayload {
  invoiceNumber?: string;
  date?: string | null;
  amount?: number | string;
}

/** PATCH /api/invoices/:id/statement-lines/:lineId — response */
export interface UpdateStatementLineResponse {
  invoice: Invoice;
  statementLines: StatementLine[];
  updatedLine: StatementLine;
}

/** DELETE /api/invoices/:id/statement-lines/:lineId — response */
export interface DeleteStatementLineResponse {
  invoice: Invoice;
  statementLines: StatementLine[];
  removedLine: StatementLine;
}

export type StatementLineResolutionType = 'accept_line' | 'use_ap_amount';

export interface ResolveStatementLinePayload {
  resolutionType: StatementLineResolutionType;
}

export interface StatementLineResolutionResponse {
  invoice: Invoice;
  statementLines: StatementLine[];
  updatedLine: StatementLine;
}

export interface StatementLineStatusChange {
  lineId: string;
  invoiceNumber: string;
  status: [StatementLineStatus, StatementLineStatus];
}

/** PATCH /api/invoices/:id — canonical document response. */
export interface InvoiceUpdateResponse extends Invoice {
  invoice: Invoice;
  action: InvoiceActionMetadata;
  approvalVerdict: ApprovalState;
  /** Present when a statement vendor update triggered a server-side rematch. */
  statusChanges?: StatementLineStatusChange[];
  subcontractDerivation?: {
    method: string;
    subcontractNumber: string | null;
    options?: Array<{ number: string; revContract: number; status: string }>;
  };
}

/** POST /api/invoices/:id/statement-lines/rematch — response */
export interface RematchStatementLinesResponse {
  invoice: Invoice;
  statementLines: StatementLine[];
  statusChanges: StatementLineStatusChange[];
}

export interface WaiverOverrideMetadata {
  active: boolean;
  at: string | null;
  by: string | null;
}

/** POST /api/invoices/:id/waiver-override and /revert — response */
export interface WaiverOverrideResponse {
  invoice: Invoice;
  action?: InvoiceActionMetadata;
  waiverOverride: WaiverOverrideMetadata;
}

/** POST /api/invoices/:id/waiver-bypass and /revert — response */
export interface WaiverBypassResponse {
  invoice: Invoice;
  action?: InvoiceActionMetadata;
}

/** POST /api/invoices/:id/request-waiver — response */
export interface RequestWaiverPayload {
  resend?: boolean;
  recipientOverride?: string;
}

export interface RequestWaiverResponse {
  success: true;
  sentTo: string;
  requestedAt: string;
  invoice: Invoice;
}

export type WaiverRecipientType = "direct" | "parsed" | "manual";
export type WaiverRecipientSource = "sender" | "body" | "forwarded_header" | "vendor_record";

export interface WaiverDirectoryContact {
  email: string;
  name: string | null;
  source: "observed" | "confirmed_send" | "manual";
  lastSeenAt: string | null;
}

export interface WaiverRecipientCandidate {
  email: string;
  source: WaiverRecipientSource;
}

/** GET /api/invoices/:id/waiver-recipient — response */
export interface WaiverRecipientResponse {
  recipientType: WaiverRecipientType;
  directEmail: string | null;
  candidates: WaiverRecipientCandidate[];
  cachedVendorEmail: string | null;
  emailFrom: string | null;
  reason: string;
  directoryContacts: WaiverDirectoryContact[];
}

/** POST /api/invoices/:id/waiver-contacts — request and response */
export interface AddWaiverContactPayload {
  email: string;
  name?: string;
}

export interface AddWaiverContactResponse {
  success: true;
  directoryContacts: WaiverDirectoryContact[];
}

/** POST /api/invoices/:id/attach-file — response */
export interface AttachFileResponse {
  success: true;
  documentId: string;
  classification: string;
  flagged: boolean;
  notes: string | null;
  emailAttached: boolean;
  extracted: Record<string, unknown> | null;
  matching: {
    vendorCode: string | null;
    jobNumber: string | null;
    subcontractNumber: string | null;
    overallConfidence: number | null;
  } | null;
}

/** POST /api/documents/:id/upload-to-spectrum - request body */
export interface UploadCoiToSpectrumPayload {
  vendorCode: string;
  expirationDate: string;
}

/** POST /api/documents/:id/upload-to-spectrum - 202 queue acceptance response */
export interface UploadCoiToSpectrumResponse {
  status: 'queued';
  documentId: string;
  vendorCode: string;
  expirationDate: string;
  attempt: number;
  queuePosition: number;
  message?: string;
}

// ─── Mutation Payload Types ──────────────────────────────────────────────────

/** PATCH /api/invoices/:id — all fields optional */
export interface InvoiceUpdatePayload {
  vendorCode?: string;
  vendorName?: string;
  jobNumber?: string;
  subcontractNumber?: string;
  amount?: number;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  notes?: string;
  routingCode?: string;
  phaseCode?: string;
  costType?: string;
  glAccount?: string;
  glDate?: string | null;
  waiverType?: string;
}

/** GET /api/vendors/refresh/status — polling response */
export interface SpectrumRefreshStatus {
  running: boolean;
  startedAt?: string;
  lastRefresh: string | null;
  lastResult: {
    vendors: number;
    jobs: number;
    subcontracts: number;
    durationMs: number;
  } | null;
}

/** POST /api/vendors/refresh — immediate response */
export interface SpectrumRefreshTriggerResponse {
  status: 'started';
  startedAt: string;
}

/** POST /api/invoices/:id/discard — request body */
export interface DiscardPayload {
  reason?: string;
  /** Asks the server to compose the canonical duplicate-discard reason. */
  duplicateContext?: boolean;
}

/** POST /api/invoices/bulk — request body */
export interface BulkActionPayload {
  ids: string[];
  action: 'approve' | 'reject' | 'discard' | 'review' | 'file' | 'unapprove';
}

/** POST /api/invoices/submit — request body */
export interface SubmitPayload {
  ids: string[];
  overrides?: Record<string, {
    routing_code?: string;
    phase_code?: string;
    gl_account?: string;
    cost_type?: string;
    gl_date?: string;
  }>;
}

/** POST /api/ignore-rules — request body */
export interface IgnoreRuleCreate {
  type: 'sender' | 'domain' | 'classification';
  value: string;
  reason: string;
}

/** POST /api/invoices/:id/reject — request body */
export interface RejectPayload {
  reason: string;
}

/** POST /api/invoices/:id/reclassify — request body */
export interface ReclassifyPayload {
  classification: string;
}

/** POST /api/invoices/:id/approve — optional inline overrides */
export interface ApprovePayload {
  routingCode?: string;
  phaseCode?: string;
  costType?: string;
  glAccount?: string;
  glDate?: string;
  /** Server-authorized canonical date used only by closed-period recovery. */
  invoiceDate?: string;
}

/** POST /api/invoices/:id/review — response */
export interface MarkReviewedResponse {
  id: string;
  status: 'reviewed';
  reviewedAt: string;
}

/** DELETE /api/invoices/:id — response */
export interface DeleteDocumentResponse {
  deleted: boolean;
  id: string;
}

/** POST /api/invoices/:id/restore — response */
export interface RestoreInvoiceResponse {
  restored: boolean;
  id: string;
  status: string;
}

/** DELETE /api/invoices/:id/permanent — response */
export interface PermanentDeleteResponse {
  deleted: boolean;
  permanent: boolean;
  id: string;
}

/** GET /api/invoices/:id/audit — single entry */
export interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  changes: Record<string, [unknown, unknown]>;
  createdAt: string;
}

/** Shared document-collaboration activity contracts. The server owns actor identity and timestamps. */
export interface ActivityActor {
  userId?: string | null;
  name?: string | null;
  role?: string | null;
  /** Server-resolved Azure identity, nullable for unresolved/external actors; never derive from an email. */
  azureId?: string | null;
  azure_id?: string | null;
  /** Stored platform photo URL, nullable for unresolved/external actors. */
  avatarUrl?: string | null;
  avatar_url?: string | null;
}

export interface ActivityEntry {
  id: string;
  kind: "comment" | "event" | "email";
  documentId?: string;
  action?: string;
  type?: string;
  documentClassification?: string | null;
  summary?: string | null;
  severity?: string | null;
  module?: string | null;
  target?: { type?: string; id?: string; label?: string | null };
  undoneAt?: string | null;
  subject?: string | null;
  body?: string | null;
  bodyPreview?: string | null;
  /** Server-sanitized inbound HTML; never treat this as executable app markup. */
  sanitizedBodyHtml?: string | null;
  messageId?: string | null;
  timestamp?: string;
  receivedAt?: string | null;
  arrivalTimestamp?: string | null;
  createdAt?: string;
  actor: ActivityActor;
  changes?: Record<string, unknown>;
  direction?: "in" | "out";
  emailKind?: "reply" | "forward" | "inbound" | "ndr";
  status?: "pending" | "confirmed" | "failed" | "ambiguous" | null;
  correlationState?: "matched" | "ambiguous" | "unmatched" | null;
  correlationReason?: string | null;
  from?: string | null;
  to?: string[];
  hasAttachments?: boolean;
  attachmentReviewed?: boolean;
  verifiedParticipant?: boolean | null;
}

export interface InboundAttachment {
  attachmentId: string;
  name: string;
  contentType: string;
  sizeBytes: number | null;
  isInline: boolean;
  eligible: boolean;
}

export interface InboundAttachmentsResponse {
  documentId: string;
  messageId: string;
  attachments: InboundAttachment[];
}

export interface InboundPromotionResponse {
  promoted: boolean;
  duplicate: boolean;
  documentId: string;
  sourceDocumentId: string;
  sourceEmailMessageId: string;
}

export interface ActivityResponse {
  entries: ActivityEntry[];
  pagination: { limit: number; offset: number; total: number; hasMore: boolean };
}

export interface ActivityViewResponse {
  documentId: string;
  priorActivityViewedAt: string | null;
  activityViewedAt: string;
  unreadReplies: number;
  unreadComments: number;
}

export interface CreateCommentPayload { body: string; }
export interface CreateCommentResponse { comment: ActivityEntry; }

export interface DocumentEmailReplyPayload { body: string; recipient?: string; }
export interface DocumentEmailForwardPayload { recipients: string[]; body: string; }
export interface DocumentEmailSendResponse {
  ok: boolean;
  sentTo: string | string[];
}
export interface ForwardDefaultRecipient {
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}
export interface ForwardDefaultsResponse {
  defaultRecipients: ForwardDefaultRecipient[];
}

export type ReplyRecipientSource = WaiverRecipientSource | "thread_history";
export interface ReplyRecipientCandidate { email: string; source: ReplyRecipientSource; }
export interface ReplyRecipientResponse {
  recipientType: WaiverRecipientType;
  directEmail: string | null;
  candidates: ReplyRecipientCandidate[];
  cachedVendorEmail: string | null;
  emailFrom: string | null;
  reason: string;
  directoryContacts: WaiverDirectoryContact[];
}

/** GET /api/classifications?include=associations&status=all — single item */
/** GET /api/classifications — additive per-classification routing/filter metadata. */
export interface ClassificationPanelMetadata {
  /** Routing surface — equals documentRouting.getSurface(opensAs). */
  surface: 'invoice_workflow' | 'document_panel' | 'generic_panel';
  /** Dashboard panel group — equals opensAs (custom rows default to 'other'). */
  filterGroup: 'invoice' | 'receipt' | 'statement' | 'coi' | 'w9' | 'lien-waiver' | 'other';
}

export interface ClassificationInfo {
  name: string;
  label: string;
  opensAs: string | null;
  action: 'extract-match' | 'view-only';
  builtIn: boolean;
  status: 'active' | 'disabled';
  addedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  /** Additive server metadata (never null when served). Optional for back-compat with fixtures/defaults. */
  panel?: ClassificationPanelMetadata;
}

/** GET /api/rule-options — one select option. */
export interface RuleOptionItem {
  value: string;
  label: string;
}

/** GET /api/rule-options — the four rule-builder catalogs in one response. */
export interface RuleOptionsResponse {
  actions: RuleOptionItem[];
  fields: RuleOptionItem[];
  operators: RuleOptionItem[];
  statuses: RuleOptionItem[];
}

/** GET /api/cost-types — served Spectrum cost-type catalog. */
export interface CostTypesResponse {
  costTypes: RuleOptionItem[];
}

/**
 * GET /api/approval-schema — the shared approval rules the backend enforces.
 * Only the members the client consumes are typed; the payload also carries
 * `paths`, `multiPhaseOverrides`, `fieldLabels`, and `version`.
 *
 * `codingDefaults.costTypeGlMap.map` is the Spectrum JC_COST_TYPE_MASTER
 * cost-type → distribution GL pairing, served from `approvalRules.json` so the
 * client never keeps its own copy (it would drift from the backend's). Cost
 * types absent from the master (e.g. `L`) have no GL and are simply not keys.
 */
export interface ApprovalSchemaResponse {
  codingDefaults?: {
    costTypeGlMap?: {
      map?: Record<string, string>;
    };
  };
}

/** GET /api/classifications?include=associations&status=all — association option */
export interface ClassificationAssociation {
  key: string;
  label: string;
  description: string;
}

/** GET /api/classifications?include=associations&status=all — response */
export interface ClassificationsResponse {
  classifications: ClassificationInfo[];
  availableAssociations: ClassificationAssociation[];
}

/** GET /api/document-destinations — a SharePoint folder-tree node (leaves carry []). */
export interface DestinationFolderNode {
  id: string;
  name: string;
  children?: readonly DestinationFolderNode[];
}

/** GET /api/document-destinations — served SharePoint destination catalog. */
export interface DocumentDestinationsConfig {
  rootLabel: string;
  tree: readonly DestinationFolderNode[];
  defaults: {
    subcontract: string;
    warranty: string;
    "lien-waiver": string;
    other: string;
  };
}

/** GET /api/coi-config — one required-coverage limit (minimum in integer dollars). */
/** Persisted COI check override returned on invoice detail responses. */
export interface CoiOverride {
  id: string;
  documentId: string;
  checkId: string;
  originalStatus: "pass" | "warn" | "fail";
  reason: string | null;
  configVersionId: string | null;
  approvedBy: string;
  approvedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
}

export interface ApplyCoiOverridePayload {
  checkId: string;
  reason?: string;
}

export interface ApplyCoiOverrideResponse {
  override: CoiOverride;
  activeOverrides: CoiOverride[];
  compliance: CoiComplianceResult;
}

export interface RevokeCoiOverrideResponse {
  revokedOverride: CoiOverride;
  activeOverrides: CoiOverride[];
  compliance: CoiComplianceResult;
}

export interface CoiComplianceResult {
  verdict: 'compliant' | 'review-required' | 'non-compliant';
  evaluatedAt: string;
  configVersion: string;
  configVersionId: string;
  checks: Array<{ id: string; label: string; rawStatus: 'pass' | 'warn' | 'fail'; effectiveStatus: 'pass' | 'warn' | 'fail'; provenance: 'computed' | 'override'; detail: string; required: boolean; code?: 'OVERRIDE_STALE' }>;
  coverageFailures: Array<{ coverageId: string; coverageLabel: string; limitLabel: string; value: number | null; minimum: number }>;
  coverageExceptions: Array<{ coverageId: string; coverageLabel: string; limitLabel: string; value: number | null; minimum: number }>;
  expiration: { value: { state: 'active' | 'expiring-soon' | 'expired' | 'unknown'; expirationDate: string | null; daysRemaining: number | null }; provenance: string; permittedActions: string[]; blockers: Array<{ code: string; message: string }> };
  vendorCode: { value: string | null; provenance: string; permittedActions: string[]; blockers: Array<{ code: string; message: string }> };
  blockers: Array<{ code: string; message: string }>;
  uploadReady: boolean;
}

export interface UpdateCoiManualValuesPayload { vendorCode?: string | null; expirationDate?: string | null; }
export interface UpdateCoiManualValuesResponse { manualValues: Record<string, { value: string; setBy: string; setAt: string }>; compliance: CoiComplianceResult; }

export interface CoiComplianceConfig {
  certificateHolder: { name: string; nameAliases: string[]; address: string };
  cancellationNoticeMinimumDays: number;
  warnWindowDays: number;
  coverageRequirements: Array<{ type: string; label: string; required: boolean; limits: Array<{ key: string; label: string; minimum: number }> }>;
  coverageTypeAliases: Record<string, string>;
}
export interface CoiConfigVersion { id: string; config: CoiComplianceConfig; effectiveFrom: string; author: string; createdAt: string; }
export interface CoiConfigVersionList { versions: CoiConfigVersion[]; total: number; limit: number; offset: number; }

/** POST /api/classifications — request body */
export interface ClassificationCreatePayload {
  name: string;
  label: string;
  opensAs: string;
  status?: ClassificationInfo['status'];
}

/** POST /api/classifications — response */
export type ClassificationCreateResponse = ClassificationInfo;

export interface ClassificationBatchUpdateItem {
  name: string;
  label?: string;
  opensAs?: string | null;
  status?: ClassificationInfo['status'];
}

/** PUT /api/classifications — request body */
export interface ClassificationBatchUpdatePayload {
  updates: ClassificationBatchUpdateItem[];
}

/** PUT /api/classifications — response */
export interface ClassificationBatchUpdateResponse {
  classifications: ClassificationInfo[];
  availableAssociations?: ClassificationAssociation[];
}

/** DELETE /api/classifications/:name — request params */
export interface ClassificationDeletePayload {
  name: string;
}

/** DELETE /api/classifications/:name — response */
export interface ClassificationDeleteResponse {
  deleted: string;
}

// ─── Lien Waiver Pairing ─────────────────────────────────────────────────────

/** Server-owned target and candidate summary for scoped waiver pairing lists. */
export interface WaiverCandidateSummary {
  id: string;
  fileName: string | null;
  vendorCode: string | null;
  vendorName: string | null;
  jobNumber: string | null;
  amount: number | null;
  invoiceNumber: string | null;
  status: string | null;
  receivedAt: string | null;
}

/** Exact paired counterpart envelope supplied by scoped orphan endpoints. */
export interface PairedWaiverDocumentSummary {
  id: string;
  fileName: string | null;
  vendorCode: string | null;
  vendorName: string | null;
  jobNumber: string | null;
  amount: number | null;
  invoiceNumber: string | null;
  status: string | null;
}

export interface InvoiceOrphanWaiversResponse {
  target: WaiverCandidateSummary;
  paired: PairedWaiverDocumentSummary | null;
  waivers: WaiverCandidateSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface LienWaiverOrphanInvoicesResponse {
  target: WaiverCandidateSummary;
  paired: PairedWaiverDocumentSummary | null;
  invoices: WaiverCandidateSummary[];
  total: number;
  page: number;
  limit: number;
}

/** POST /api/invoices/:id/link-waiver — response */
export interface LinkWaiverResponse {
  success: boolean;
  invoiceId: string;
  waiverId: string;
  linkedAt: string;
}

/** DELETE /api/invoices/:id/link-waiver — response */
export interface UnlinkWaiverResponse {
  success: boolean;
  invoiceId: string;
  unlinkedAt: string;
}

// ─── Split Review Types ──────────────────────────────────────────────────────

/** Per-page Haiku analysis */
export interface SplitPageInfo {
  page: number;
  invoiceNumber: string | null;
  docType: string;
}

/** Haiku-generated suggestion stored in split_suggestion JSONB */
export interface SplitSuggestion {
  pageCount: number;
  generatedAt: string;
  pages: SplitPageInfo[];
  suggestedGroups: Array<{
    pages: number[];
    invoiceNumber: string | null;
    docType: string;
  }>;
  haikuTokens?: { in: number; out: number };
}

/** Single item from split queue */
export interface SplitDoc {
  id: string;
  status: 'needs-split';
  fileName: string;
  pageCount: number;
  email: {
    messageId: string;
    from: string;
    subject: string;
    receivedAt: string;
  };
  splitSuggestion: SplitSuggestion | null;
  queuedAt: string;
}

/** GET /api/splits/queue — response */
export interface SplitQueueResponse {
  items: SplitDoc[];
  total: number;
  offset: number;
  limit: number;
}

/** A single group in the confirm request */
export interface SplitGroup {
  pages: number[];
  docType?: string;
  displayName?: string;
}

/** POST /api/splits/:id/confirm — request */
export interface ConfirmSplitRequest {
  groups: SplitGroup[];
  discardPages: number[];
}

/** POST /api/splits/:id/confirm — response */
export interface ConfirmSplitResponse {
  parentId: string;
  childIds: string[];
  backupChildId: string | null;
  discardedPages: number[];
  status: 'processing';
  message: string;
}

/** GET /api/splits/child/:childId/status — response */
export interface ChildStatusResponse {
  id: string;
  parentId: string;
  status: string;
  classification: string;
  extractedInvoiceNumber: string | null;
  matchedVendor: string | null;
  matchedJob: string | null;
}

// ─── Multi-Phase Allocation ──────────────────────────────────────────────────

export interface PhaseOption {
  phase_code: string;
  cost_type: string;
  description: string;
  original_amount: number;
  amount_billed: number;
  remaining_amount: number;
}

export interface PhaseRow extends PhaseOption {
  row_index: number;
  bid_item?: string;
}

export interface SubcontractHeader {
  vendorCode: string;
  vendorName: string;
  revContract: number;
  totalBilled: number;
  unbilled: number;
}

export interface PhaseAllocation {
  phase_code: string;
  cost_type: string;
  amount: number;
  description: string;
}

export interface PhaseOptionsResponse {
  invoiceId: string;
  subcontractNumber: string;
  jobNumber: string | null;
  invoiceAmount: number | null;
  header: SubcontractHeader;
  exceedsUnbilled: boolean;
  overageAmount: number;
  suggestedRoutingCode: string | null;
  suggestedRoutingPm: string | null;
  currentRoutingCode: string | null;
  isMultiPhase: boolean;
  distinctPhaseCount: number;
  phaseRowCount: number;
  phaseRows: PhaseRow[];
  phases: PhaseOption[];
  currentAllocations: PhaseAllocation[] | null;
}

export interface SetPhaseAllocationsResponse {
  id: string;
  subcontractNumber: string;
  invoiceTotal: number;
  allocationTotal: number;
  phaseAllocations: PhaseAllocation[];
  message: string;
}

/** POST /api/invoices/:id/flag-for-split — response */
export interface FlagForSplitResponse {
  id: string;
  status: 'needs-split';
  previousStatus: string;
  nextPath: string;
  message: string;
}

/** POST /api/splits/:id/analyze — response */
export interface AnalyzeSplitResponse {
  id: string;
  splitSuggestion: SplitSuggestion;
  haikuSaysSingleInvoice: boolean;
}
