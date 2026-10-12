// ─── Classification & Status ────────────────────────────────────────────────

export type ClassificationType =
  | 'invoice'
  | 'receipt'
  | 'pay-application'
  | 'credit-memo'
  | 'subcontract'
  | 'warranty'
  | 'image'
  | 'other'
  | 'statement'
  | 'coi'
  | 'building-permit'
  | 'w9'
  | 'contract'
  | 'lien-waiver'
  | 'change-order'
  | 'purchase-order'
  | 'no-attachment'
  | 'error'
  | 'all-skipped'
  // legacy values kept for backward compat with existing data
  | 'skipped'
  | 'unsupported';

export type InvoiceStatus =
  | 'pending'
  | 'approved'
  | 'modified'
  | 'rejected'
  | 'discarded'
  | 'submitted'
  | 'retry-pending'
  | 'duplicate'
  | 'reviewed'
  | 'needs-split'
  | 'split-processing'
  | 'split';

// ─── Extracted Data ──────────────────────────────────────────────────────────

export interface LineItem {
  description: string;
  amount: number;
  jobRef: string | null;
}

export type StatementLineStatus =
  | 'matched'
  | 'in_toolbox_not_spectrum'
  | 'not_received'
  | 'amount_differs';

export interface StatementLine {
  id: string;
  invoiceNumber: string;
  date: string | null;
  amount: number;
  status: StatementLineStatus;
  /** Server-derived reconciliation state; never recomputed in the client. */
  clear?: boolean;
  source: 'extracted' | 'manual';
  resolvedAt?: string | null;
  resolutionType?: 'accept_line' | 'use_ap_amount' | null;
  resolvedBy?: string | null;
}

export interface StatementReconcileBlocker {
  code: string;
  lineId?: string;
  message: string;
}

export interface StatementReconcileState {
  blockers: StatementReconcileBlocker[];
  counts: {
    total: number;
    clear: number;
    unresolved: number;
  };
  canReconcile: boolean;
  permittedActions: Array<'reconcile'>;
}

export type StatementAttributeSource = 'manual' | 'extracted' | 'computed' | null;

export interface ResolvedStatementAttribute<T> {
  value: T | null;
  source: StatementAttributeSource;
}

/** Server-authoritative pre-collision filing candidate. */
export interface FilingFileName {
  value: string;
  provenance: "computed";
  permittedActions: string[];
  blockers: string[];
}

export type FilingValueProvenance = "manual" | "extracted" | "matching" | "email" | "computed" | "filename" | null;

/** Server-resolved filing value; the browser must not recompute its precedence. */
export interface ResolvedFilingValue<T> {
  value: T | null;
  provenance: FilingValueProvenance;
  permittedActions: string[];
  blockers: string[];
}

export interface FilingState {
  fileName: FilingFileName;
  vendor?: ResolvedFilingValue<string>;
  job?: ResolvedFilingValue<string>;
  scope?: ResolvedFilingValue<string>;
  date?: ResolvedFilingValue<string>;
  providerKind?: ResolvedFilingValue<string>;
  warrantyType?: ResolvedFilingValue<string>;
}

/** Canonical M-077 statement values returned by the document API. */
export interface StatementAttributes {
  statementPeriod: ResolvedStatementAttribute<string>;
  balance: ResolvedStatementAttribute<number>;
}

export interface ExtractedData {
  vendorName: string | null;
  vendorAddress: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  glDate?: string | null;
  dueDate: string | null;
  amount: number | null;
  jobNumber: string | null;
  jobRef?: string | null;
  projectName: string | null;
  projectAddress?: string | null;
  docTitle?: string | null;
  insuredName?: string | null;
  expirationDate?: string | null;
  vendor?: string | null;
  statementPeriod?: string | null;
  balance?: number | null;
  description: string | null;
  lineItems: LineItem[];
  statementLines?: StatementLine[];
}

// ─── Matching Data ───────────────────────────────────────────────────────────
//
// `confidence` fields below arrive from the matcher via the API and are kept
// as DIAGNOSTIC METADATA ONLY (ratified 2026-09-02). They must never be
// rendered in the UI or used to drive filtering/display logic.

export interface VendorMatchResult {
  vendorCode: string | null;
  vendorName: string | null;
  confidence: number | null;
  method: string | null;
}

export interface JobMatchResult {
  jobNumber: string | null;
  confidence: number | null;
  method: string | null;
  jobDescription?: string;
}

export interface SubcontractMatchResult {
  subcontractNumber: string;
  confidence: number | null;
  method: string | null;
}

export interface MatchingData {
  vendor: VendorMatchResult | null;
  job: JobMatchResult | null;
  subcontract: SubcontractMatchResult | null;
  sourceInvoiceTotal: number | null;
  overallConfidence?: number | null;
}

// ─── Invoice Email ────────────────────────────────────────────────────────────

export type SpectrumDuplicateSource = "OPEN_ITEMS" | "APPROVAL" | "PAYMENT_HIST";

export interface SpectrumDuplicateHit {
  source: SpectrumDuplicateSource | string;
  amount: number | null;
}

export interface InvoiceEmail {
  messageId?: string;
  from: string;
  subject: string;
  receivedAt: string;
  bodyPreview?: string;
  body?: string | null;
  bodyContentType?: 'html' | 'text';
}

// ─── Full Invoice Record ─────────────────────────────────────────────────────

export interface Invoice {
  id: string;
  classification: ClassificationType;
  confidence: number;
  file: string;
  email: InvoiceEmail;
  status: InvoiceStatus;
  queuedAt: string;
  /** Server-derived collaboration counts; the client never calculates these. */
  unreadReplies?: number;
  unreadComments?: number;
  extracted: ExtractedData | null;
  statementLines?: StatementLine[];
  matching: MatchingData | null;
  overallConfidence: number;
  splitFrom: string | null;
  suggestedSplit?: boolean;
  duplicateOf: string | null;
  /**
   * List-only: set when this reviewable invoice already exists in Spectrum
   * (open items / in approval / payment history). Spectrum matches have no
   * Toolbox original, so `duplicateOf` stays null for them.
   */
  spectrumDuplicate?: SpectrumDuplicateHit | null;
  duplicateBypassed?: boolean;
  duplicateBypassedAt?: string | null;
  duplicateBypassedBy?: string | null;
  reason: string | null;
  rejectionReason?: string | null;
  error: { stage: string; message: string; timestamp: string } | null;
  reclassifiedFrom: string | null;
  reclassifiedAt: string | null;
  // ── Lien waiver detection ──────────────────────────────────────────────
  lienWaiverStatus?: 'attached' | 'missing';
  /** Canonical list-row waiver state. Display it directly; do not infer precedence client-side. */
  waiverStatus?: 'required' | 'requested' | 'attached' | 'bypassed' | 'not-required' | null;
  waiverBypassed?: boolean;
  waiverBypassedAt?: string | null;
  waiverBypassedBy?: string | null;
  // ── Lien waiver pairing ───────────────────────────────────────────────
  linkedLienWaiverId?: string | null;
  lienWaiverRequired?: boolean;
  waiverOnDocument?: boolean;
  waiverOnDocumentAt?: string | null;
  waiverOnDocumentBy?: string | null;
  waiverType?: string | null;
  // ── Explicit server-derived waiver document state (never inferred client-side) ──
  // Derived by the backend from persisted columns per CONTRACTS.md §waiver state.
  pairingStatus?: 'paired' | 'unpaired';
  filingStatus?: 'unfiled' | 'filed' | 'shelved';
  releaseStatus?: 'released' | 'held';
  waiverRequestedAt?: string | null;
  waiverRequestedBy?: string | null;
  waiverLinkSource?: 'email-thread' | 'request-thread' | 'subject-vendor' | 'manual' | 'suggestion' | null;
  /** Caller-aware controls resolved from current server state. */
  waiverActions?: WaiverActionState;
  // ── Filing / reconciliation ──────────────────────────────────────────
  filed?: boolean;
  filedAt?: string | null;
  filedDestination?: string | null;
  filingNote?: string | null;
  holdReason?: string | null;
  /** Canonical filing preview; never derive or rewrite this in the browser. */
  filing?: FilingState;
  spFileUrl?: string | null;
  sharePointItemId?: string | null;
  sharePointFilename?: string | null;
  reconciled?: boolean;
  reconciledAt?: string | null;
  /** Statement reconciliation authority returned by canonical detail/mutation responses. */
  reconcile?: StatementReconcileState;
  /** Canonical resolved statement attributes; never derive these in the frontend. */
  statementAttributes?: StatementAttributes;
  // Last Spectrum rejection reason (set by backend on failed submit attempts)
  lastSpectrumError?: string | null;
  spectrumUploadStatus?: 'queued' | 'processing' | 'success' | 'failed' | null;
  spectrumUploadQueuedAt?: string | null;
  spectrumUploadStartedAt?: string | null;
  spectrumUploadCompletedAt?: string | null;
  spectrumUploadError?: string | null;
  spectrumUploadTransId?: string | null;
  spectrumUploadTrackingCode?: string | null;
  spectrumUploadVendorCode?: string | null;
  spectrumUploadAttempts?: number;
  // ── Editing provenance ────────────────────────────────────────────────────
  wasModified?: boolean;       // true when any field was manually edited before approval
  /** BE-G: absent keys are unknown/system, never inferred from wasModified. */
  fieldOrigins?: Record<string, { origin: 'manual' | 'derived'; at: string; by: unknown }>;
  // ── Split review ───────────────────────────────────────────────────────────
  splitSuggestion?: import('@/modules/accounting/modules/invoices/types/api').SplitSuggestion | null;
  /** Server-served reason that explains why waiver auto-linking was skipped. */
  waiverAutoLinkSkipReason?: "multi-waiver-bundle" | null;
  // ── Rule-related fields (returned by backend once implemented) ──────────
  notes?: string | null;       // free-text notes; add_note action appends here
  flagged?: boolean;           // LEGACY ingestion/manual-split marker — NOT the review flag; never key flag UI off this
  // ── Review "needs attention" flag (distinct from the legacy `flagged` boolean above) ──
  // Flag state is `flaggedAt !== null`. Set/cleared server-side via flag/unflag endpoints.
  flaggedAt?: string | null;   // ISO timestamp; presence means the document is flagged for review
  flaggedBy?: string | null;   // acting user's email
  flagReason?: string | null;  // optional free-text reason
  hidden?: boolean;            // soft-hide from queue (persisted server-side)
  assignedTo?: string | null;  // userId (Azure AD) of assigned reviewer
  // ── Multi-Phase Subcontract ────────────────────────────────────────────────
  multiPhaseCandidate?: boolean;
  phaseAllocations?: import('@/modules/accounting/modules/invoices/types/api').PhaseAllocation[] | null;
  // ── Soft delete / trash ────────────────────────────────────────────────────
  deletedAt?: string | null;
  /** Present only for global search rows; server-authoritative Trash membership. */
  isTrash?: boolean;
  /** Served discard timestamp for filtered records that were not manually deleted. */
  discardedAt?: string | null;
  deletedBy?: string | null;
  deletionReason?: string | null;
  /** Server-authoritative discard provenance; null represents a legacy manual discard. */
  discardSource?: 'manual' | 'auto-ai' | 'rule-filter' | 'junk-hash' | null;
  restoredAt?: string | null;
  restoredBy?: string | null;
  // ── COI compliance data ────────────────────────────────────────────────────
  coiData?: CoiExtractedData | null;
  /** Active persisted COI overrides. Detail-only; absent from list rows. */
  coiOverrides?: import('@/modules/accounting/modules/invoices/types/api').CoiOverride[];
  /** Server-authoritative COI evaluation. Detail-only; never derived in the client. */
  compliance?: import('@/modules/accounting/modules/invoices/types/api').CoiComplianceResult;
}

export interface WaiverActionBlocker {
  code: string;
  message: string;
}

export interface WaiverActionCapability {
  permitted: boolean;
  blockers: WaiverActionBlocker[];
}

export interface WaiverActionState {
  request: WaiverActionCapability;
  resend: WaiverActionCapability;
  markOnDocument: WaiverActionCapability;
  clearOnDocument: WaiverActionCapability;
  bypass: WaiverActionCapability;
  revertBypass: WaiverActionCapability;
  bypassHint: { count: number; show: boolean };
}

// ─── COI Extracted Compliance Data ───────────────────────────────────────────

export interface CoiExtractedCoverageLine {
  type: string;
  carrier: string | null;
  policyNumber: string | null;
  expirationDate: string | null;
  limits?: Record<string, number>;
}

export interface CoiExtractedEndorsements {
  additionalInsured: boolean;
  additionalInsuredForms: string[];
  waiverOfSubrogation: boolean;
  primaryNoncontributory: boolean;
  completedOperations: boolean;
}

export interface CoiExtractedHolder {
  name: string | null;
  address: string | null;
}

export interface CoiExtractedData {
  coverageLines?: CoiExtractedCoverageLine[];
  endorsements?: CoiExtractedEndorsements;
  holder?: CoiExtractedHolder;
  cancellationNoticeDays?: number;
}

export type FilingStatus = 'unfiled' | 'shelved' | 'sp-filed';

export function getFilingStatus(invoice: Invoice): FilingStatus {
  if (!invoice.filed) return 'unfiled';
  return invoice.spFileUrl ? 'sp-filed' : 'shelved';
}
