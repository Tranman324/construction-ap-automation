'use strict';
/**
 * Supabase / PostgreSQL service
 * Re-exports the shared pool and provides a typed audit helper.
 */

const pool = require('../../../lib/db');
const { emitLegacyInvoiceAuditEvent } = require('../../../lib/auditEvents');
const { getStatementReconcileState } = require('./statementReconciliation');
const { resolveStatementAttributes } = require('./statementAttributes');
const { buildFilingPreview } = require('./sharepointFilename');
const { resolveFilingValues } = require('./filingValueResolver');
const { getJobDescription } = require('./matching');
const { checkPermission } = require('../../../middleware/permissions');

/**
 * Log an action to audit_log
 */
async function audit(documentId, action, changes = null, actor = 'dashboard', client) {
  return emitLegacyInvoiceAuditEvent(documentId, action, changes, actor, client);
}

function isSuggestionMatch(method) {
  return typeof method === 'string' && /suggestion/i.test(method);
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function waiverBlocker(code, message) {
  return { code, message };
}

function waiverCapability(permitted, blockers) {
  return { permitted, blockers };
}

/**
 * Resolve waiver controls from current persisted state and the caller's
 * already-authorized permission set. Clients render this envelope instead of
 * recreating permission or workflow-state decisions locally.
 */
// W4: vendors with this many bypasses since their last attached waiver get the
// informational hint ("has not typically required a lien waiver") in the UI.
const WAIVER_BYPASS_HINT_THRESHOLD = 5;

/**
 * W4 grouped bypass counts — ONE query per request, never per row. Reset
 * semantics: only bypasses on documents received AFTER the vendor's most
 * recent document with a linked waiver count (attaching a waiver resets the
 * streak). Returns { [vendorCode]: count }.
 */
async function getVendorBypassCounts(vendorCodes, db = pool) {
  const codes = [...new Set((vendorCodes || []).filter((code) => typeof code === 'string' && code.trim() !== ''))];
  if (codes.length === 0) return {};
  const result = await db.query(
    `SELECT d.vendor_code, COUNT(*)::int AS bypass_count
     FROM documents d
     LEFT JOIN (
       SELECT vendor_code, MAX(email_received_at) AS last_attached_at
       FROM documents
       WHERE linked_lien_waiver_id IS NOT NULL AND deleted_at IS NULL AND vendor_code IS NOT NULL
       GROUP BY vendor_code
     ) latest ON latest.vendor_code = d.vendor_code
     WHERE d.vendor_code = ANY($1)
       AND d.deleted_at IS NULL
       AND d.waiver_bypassed = true
       AND (latest.last_attached_at IS NULL OR d.email_received_at > latest.last_attached_at)
     GROUP BY d.vendor_code`,
    [codes]
  );
  return Object.fromEntries(result.rows.map((row) => [row.vendor_code, row.bypass_count]));
}

function getWaiverActionState(row, {
  canRequestWaiver = false,
  canApproveWaiver = false,
  vendorBypassCounts = null,
} = {}) {
  const requestable = ['invoice', 'pay-application'].includes(row?.classification);
  const hasSourceEmail = typeof row?.email_message_id === 'string' && row.email_message_id.trim().length > 0;
  const requested = Boolean(row?.waiver_requested_at);
  const markedOnDocument = Boolean(row?.waiver_on_document);
  const bypassed = row?.waiver_bypassed === true;
  // Effective requirement: raw detection minus the persistent human bypass.
  const waiverRequired = row?.lien_waiver_required === true && !bypassed;

  const requestBlockers = [];
  if (!canRequestWaiver) requestBlockers.push(waiverBlocker('WAIVER_REQUEST_FORBIDDEN', 'You do not have permission to request a lien waiver.'));
  if (!requestable) requestBlockers.push(waiverBlocker('WAIVER_REQUEST_INELIGIBLE', 'Lien waiver requests are available only for invoice and pay-application documents.'));
  if (!hasSourceEmail) requestBlockers.push(waiverBlocker('WAIVER_SOURCE_EMAIL_MISSING', 'No source email is available for this document.'));
  if (requested) requestBlockers.push(waiverBlocker('WAIVER_REQUEST_ALREADY_SENT', 'A lien waiver request was already sent; use resend instead.'));

  const resendBlockers = [];
  if (!canRequestWaiver) resendBlockers.push(waiverBlocker('WAIVER_REQUEST_FORBIDDEN', 'You do not have permission to request a lien waiver.'));
  if (!requestable) resendBlockers.push(waiverBlocker('WAIVER_REQUEST_INELIGIBLE', 'Lien waiver requests are available only for invoice and pay-application documents.'));
  if (!hasSourceEmail) resendBlockers.push(waiverBlocker('WAIVER_SOURCE_EMAIL_MISSING', 'No source email is available for this document.'));
  if (!requested) resendBlockers.push(waiverBlocker('WAIVER_REQUEST_NOT_SENT', 'No prior lien waiver request is available to resend.'));

  const markBlockers = [];
  if (!canApproveWaiver) markBlockers.push(waiverBlocker('WAIVER_APPROVAL_FORBIDDEN', 'You do not have permission to mark a waiver on this document.'));
  if (markedOnDocument) markBlockers.push(waiverBlocker('WAIVER_ALREADY_ON_DOCUMENT', 'A waiver is already marked as present on this document.'));

  const clearBlockers = [];
  if (!canApproveWaiver) clearBlockers.push(waiverBlocker('WAIVER_APPROVAL_FORBIDDEN', 'You do not have permission to clear the waiver-on-document marker.'));
  if (!markedOnDocument) clearBlockers.push(waiverBlocker('WAIVER_NOT_ON_DOCUMENT', 'No waiver-on-document marker is set.'));

  const bypassBlockers = [];
  if (!canApproveWaiver) bypassBlockers.push(waiverBlocker('WAIVER_APPROVAL_FORBIDDEN', 'You do not have permission to bypass the lien waiver requirement.'));
  if (!waiverRequired) bypassBlockers.push(waiverBlocker('WAIVER_NOT_REQUIRED', 'A lien waiver is not currently required for this document.'));

  const revertBypassBlockers = [];
  if (!canApproveWaiver) revertBypassBlockers.push(waiverBlocker('WAIVER_APPROVAL_FORBIDDEN', 'You do not have permission to restore the lien waiver requirement.'));
  if (!bypassed) revertBypassBlockers.push(waiverBlocker('WAIVER_ALREADY_REQUIRED', 'No lien waiver bypass is active for this document.'));

  // W4 informational hint: precomputed grouped count passed in via options —
  // NEVER queried here (this function is synchronous and called per row).
  const vendorBypassCount = vendorBypassCounts && row?.vendor_code
    ? (vendorBypassCounts[row.vendor_code] || 0)
    : 0;

  return {
    request: waiverCapability(requestBlockers.length === 0, requestBlockers),
    resend: waiverCapability(resendBlockers.length === 0, resendBlockers),
    markOnDocument: waiverCapability(markBlockers.length === 0, markBlockers),
    clearOnDocument: waiverCapability(clearBlockers.length === 0, clearBlockers),
    bypass: waiverCapability(bypassBlockers.length === 0, bypassBlockers),
    revertBypass: waiverCapability(revertBypassBlockers.length === 0, revertBypassBlockers),
    bypassHint: {
      count: vendorBypassCount,
      show: vendorBypassCount >= WAIVER_BYPASS_HINT_THRESHOLD,
    },
  };
}

// Phase codes exempt from the lien-waiver requirement. MUST mirror the DB
// trigger compute_lien_waiver_required() in
// migrations/2026-07-14_waiver_requirement_detection.sql.
const WAIVER_EXEMPT_PHASE_CODES = new Set(['01502', '01503', '01812', '01850', '01900']);

/**
 * Would the deterministic waiver-requirement detection rule flag this row?
 * Mirrors the DB trigger: invoice/pay-application AND cost_type 'S' AND a
 * job match AND phase not exempt. Because the trigger recomputes
 * lien_waiver_required whenever those inputs change, the ONLY way the flag
 * can be false while this returns true is the explicit waiver-bypass action.
 */
function waiverDetectionWouldRequire(r) {
  const classification = r.classification ? String(r.classification).replace(/ /g, '-') : '';
  if (!['invoice', 'pay-application'].includes(classification)) return false;
  const costType = String(r.cost_type || '').trim().toUpperCase();
  const jobNumber = String(r.job_match_number || '').trim();
  const phaseCode = String(r.phase_code || '').trim();
  return costType === 'S' && jobNumber !== '' && !WAIVER_EXEMPT_PHASE_CODES.has(phaseCode);
}

/**
 * Single waiver-state value for the dashboard list Waiver column.
 * Derived entirely from persisted columns (no new storage):
 *   'attached'  — a waiver is linked (linked_lien_waiver_id), the pipeline
 *                 saw one on the document (lien_waiver_status='attached'),
 *                 or a human marked waiver-on-document. Attached always wins.
 *   'bypassed'  — detection says a waiver is required but the flag was
 *                 explicitly overridden to false (waiver-bypass action).
 *   'requested' — required, and a request email went out
 *                 (waiver_requested_at / waiver_request_conversation_id).
 *   'required'  — required, nothing attached/requested yet.
 *   'not-required' — no waiver expected for this document.
 */
function deriveWaiverStatus(r) {
  const attached = Boolean(r.linked_lien_waiver_id)
    || r.lien_waiver_status === 'attached'
    || r.waiver_on_document === true;
  const bypassed = r.waiver_bypassed === true;
  const required = r.lien_waiver_required === true && !bypassed;
  const wouldRequire = waiverDetectionWouldRequire(r);

  // Attached wins unconditionally (the product owner ruling): a waiver that exists is
  // worth showing even if the requirement was bypassed or never detected.
  if (attached) return 'attached';
  // Persistent bypass column is authoritative; the `!required && wouldRequire`
  // inference remains as a fallback for legacy rows where the old bypass
  // mechanism flipped lien_waiver_required directly.
  if (bypassed && wouldRequire) return 'bypassed';
  if (!required && wouldRequire) return 'bypassed';
  if (!required) return 'not-required';
  const requested = Boolean(r.waiver_requested_at) || Boolean(r.waiver_request_conversation_id);
  return requested ? 'requested' : 'required';
}

function getWaiverActionSerializationOptions(req) {
  return {
    includeWaiverActions: true,
    canRequestWaiver: checkPermission(req, 'accounting.invoices.request_waiver'),
    canApproveWaiver: checkPermission(req, 'accounting.invoices.approve'),
  };
}

/**
 * Convert a DB row into the API document shape (camelCase, nested).
 */
function rowToDoc(r, options = {}) {
  const normalizedClassification = r.classification
    ? r.classification.replace(/ /g, '-')
    : r.classification;
  const statementReconcile = options.includeStatementReconcile
    ? getStatementReconcileState(r, options)
    : null;
  const waiverActions = options.includeWaiverActions
    ? getWaiverActionState(r, options)
    : null;
  const statementLines = statementReconcile?.statementLines || parseJsonArray(r.statement_lines);
  const statementAttributes = normalizedClassification === 'statement'
    ? resolveStatementAttributes(r.statement_attributes)
    : null;
  const filingValues = resolveFilingValues(r);
  const filingDate = filingValues.date.value instanceof Date
    ? { ...filingValues.date, value: filingValues.date.value.toISOString().slice(0, 10) }
    : filingValues.date;
  return {
    id: r.id,
    classification: normalizedClassification,
    status: r.status,
    confidence: r.confidence != null ? parseFloat(r.confidence) : null,
    file: r.file_name,
    email: {
      messageId: r.email_message_id,
      from: r.email_from,
      subject: r.email_subject,
      receivedAt: r.email_received_at ? r.email_received_at.toISOString() : null,
      bodyPreview: r.email_body_preview,
      body: r.email_body,
      bodyContentType: r.email_body_content_type || 'html',
    },
    extracted: {
      vendorName: r.vendor_name,
      vendorAddress: r.vendor_address,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date ? r.invoice_date.toISOString().split('T')[0] : null,
      dueDate: r.due_date ? r.due_date.toISOString().split('T')[0] : null,
      amount: r.amount != null ? parseFloat(r.amount) : null,
      jobNumber: r.job_number,
      projectName: r.project_name,
      projectAddress: r.project_address,
      description: r.description,
      docTitle: r.doc_title || null,
      lineItems: r.line_items || [],
      statementLines,
      ...(statementAttributes ? {
        statementPeriod: statementAttributes.statementPeriod.value,
        balance: statementAttributes.balance.value,
      } : {}),
    },
    statementLines,
    ...(statementAttributes ? { statementAttributes } : {}),
    ...(statementReconcile ? {
      reconcile: {
        blockers: statementReconcile.blockers,
        counts: statementReconcile.counts,
        canReconcile: statementReconcile.canReconcile,
        permittedActions: statementReconcile.permittedActions,
      },
    } : {}),
    ...(waiverActions ? { waiverActions } : {}),
    matching: {
      vendor: (r.vendor_code || isSuggestionMatch(r.vendor_match_method)) ? {
        vendorCode: r.vendor_code || null,
        vendorName: r.matched_vendor_name,
        confidence: r.vendor_match_confidence != null ? parseFloat(r.vendor_match_confidence) : null,
        method: r.vendor_match_method,
      } : null,
      job: (r.job_match_number || isSuggestionMatch(r.job_match_method)) ? {
        jobNumber: r.job_match_number || null,
        jobDescription: getJobDescription(r.job_match_number),
        confidence: r.job_match_confidence != null ? parseFloat(r.job_match_confidence) : null,
        method: r.job_match_method,
      } : null,
      subcontract: r.subcontract_number ? {
        subcontractNumber: r.subcontract_number,
        confidence: r.subcontract_match_confidence != null ? parseFloat(r.subcontract_match_confidence) : null,
        method: r.subcontract_match_method,
      } : null,
      overallConfidence: r.overall_confidence != null ? parseFloat(r.overall_confidence) : null,

    },
    filing: {
      ...buildFilingPreview(r),
      date: filingDate,
      vendor: filingValues.vendor,
      job: filingValues.job,
      scope: filingValues.scope,
      providerKind: filingValues.providerKind,
      warrantyType: filingValues.warrantyType,
    },
    coiData: r.coi_data || null,
    splitFrom: r.split_from,
    suggestedSplit: r.suggested_split || false,
    splitSuggestion: (() => {
      if (!r.split_suggestion) return null;
      try {
        return typeof r.split_suggestion === 'string'
          ? JSON.parse(r.split_suggestion)
          : r.split_suggestion;
      } catch {
        return null;
      }
    })(),
    multiPhaseCandidate: r.multi_phase_candidate || false,
    phaseAllocations: (() => {
      if (!r.phase_allocations) return null;
      try {
        return typeof r.phase_allocations === 'string'
          ? JSON.parse(r.phase_allocations)
          : r.phase_allocations;
      } catch {
        return null;
      }
    })(),
    duplicateOf: r.duplicate_of,
    duplicateBypassed: r.duplicate_bypassed === true,
    duplicateBypassedAt: r.duplicate_bypassed_at || null,
    duplicateBypassedBy: r.duplicate_bypassed_by || null,
    rejectionReason: r.rejection_reason,
    filed: r.filed || false,
    linkedTo: r.linked_to || null,
    flagged: r.flagged || false,
    // "Needs attention" flag (distinct from the legacy `flagged` split marker).
    // Flag state is `flaggedAt !== null`.
    flaggedAt: r.flagged_at ? r.flagged_at.toISOString() : null,
    flaggedBy: r.flagged_by || null,
    flagReason: r.flag_reason || null,
    hidden: r.hidden || false,
    notes: r.notes || null,
    wasModified: r.was_modified || false,
    // BE-G per-field provenance: camelCase field name → {origin, at, by}.
    // origin: 'manual' (explicit user input) | 'derived' (server-computed in a
    // user edit or rules run). Absent key = unknown/system — never fabricated.
    fieldOrigins: r.field_origins || {},
    lienWaiverStatus: r.lien_waiver_status || null,
    // Dashboard Waiver column: 'attached' | 'bypassed' | 'requested' |
    // 'required' | 'not-required'. See deriveWaiverStatus.
    waiverStatus: deriveWaiverStatus(r),
    displayName: r.display_name || null,
    assignedTo: r.assigned_to || null,
    reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
    approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
    approvedBy: r.approved_by || null,
    discardedAt: r.discarded_at ? r.discarded_at.toISOString() : null,
    discardedBy: r.discarded_by || null,
    // Trash-tab source pill: 'manual' | 'auto-ai' | 'rule-filter' | 'junk-hash'.
    // Legacy discards predate the column; the frontend treats null as 'manual'.
    discardSource: r.discard_source || null,
    filedAt: r.filed_at ? r.filed_at.toISOString() : null,
    // Empty string is the explicit Projects-root destination, not missing data.
    filedDestination: r.filed_destination ?? null,
    filingNote: r.filing_note || null,
    holdReason: r.hold_reason || null,
    spFileUrl: r.sp_file_url || null,
    sharePointItemId: r.sharepoint_item_id || null,
    sharePointFilename: r.sharepoint_filename || null,
    reconciled: r.reconciled || false,
    reconciledAt: r.reconciled_at ? r.reconciled_at.toISOString() : null,
    waiverReleased: r.waiver_released || false,
    waiverReleasedAt: r.waiver_released_at ? r.waiver_released_at.toISOString() : null,
    waiverOnDocument: r.waiver_on_document || false,
    waiverOnDocumentAt: r.waiver_on_document_at ? r.waiver_on_document_at.toISOString() : null,
    waiverOnDocumentBy: r.waiver_on_document_by || null,
    queuedAt: r.queued_at ? r.queued_at.toISOString() : null,
    updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
    routingCode: r.routing_code || null,
    phaseCode: r.phase_code || null,
    costType: r.cost_type || null,
    glAccount: r.gl_account || null,
    glDate: r.gl_date ? r.gl_date.toISOString().split('T')[0] : null,
    linkedLienWaiverId: r.linked_lien_waiver_id || null,
    waiverLinkSource: r.waiver_link_source || null,
    // W13: persisted auto-link skip reason ('multi-waiver-bundle') drives the
    // "split this document" notice in the UI.
    waiverAutoLinkSkipReason: r.waiver_auto_link_skip_reason || null,
    // EFFECTIVE requirement: raw detection flag minus an explicit human bypass.
    // The trigger owns lien_waiver_required (pure detection); waiver_bypassed
    // persists across trigger recomputes (2026-08-06 fix).
    lienWaiverRequired: (r.lien_waiver_required === true) && r.waiver_bypassed !== true,
    waiverBypassed: r.waiver_bypassed === true,
    waiverBypassedAt: r.waiver_bypassed_at ? r.waiver_bypassed_at.toISOString() : null,
    waiverBypassedBy: r.waiver_bypassed_by || null,
    waiverType: r.waiver_type || null,
    // Explicit lien-waiver workflow state, derived from PERSISTED columns (never
    // filename/subject heuristics). Meaningful for lien-waiver documents; well-
    // defined for any row from its linkage/filing/release columns.
    //   pairingStatus: 'paired' (linked to an invoice) | 'unpaired'
    //   filingStatus:  'filed' (filed + SharePoint copy) | 'shelved' (filed, no SP) | 'unfiled'
    //   releaseStatus: 'released' (filed to SharePoint OR submitted) | 'held'
    pairingStatus: r.linked_lien_waiver_id ? 'paired' : 'unpaired',
    filingStatus: !r.filed ? 'unfiled' : (r.sp_file_url ? 'filed' : 'shelved'),
    releaseStatus: (r.sp_file_url || r.status === 'submitted') ? 'released' : 'held',
    waiverRequestedAt: r.waiver_requested_at ? r.waiver_requested_at.toISOString() : null,
    waiverRequestedBy: r.waiver_requested_by || null,
    mergedFilePath: r.merged_file_path || null,
    submitError: r.submit_error || null,
    spectrumUploadStatus: r.spectrum_upload_status || null,
    spectrumUploadQueuedAt: r.spectrum_upload_queued_at ? r.spectrum_upload_queued_at.toISOString() : null,
    spectrumUploadStartedAt: r.spectrum_upload_started_at ? r.spectrum_upload_started_at.toISOString() : null,
    spectrumUploadCompletedAt: r.spectrum_upload_completed_at ? r.spectrum_upload_completed_at.toISOString() : null,
    spectrumUploadError: r.spectrum_upload_error || null,
    spectrumUploadTransId: r.spectrum_upload_trans_id || null,
    spectrumUploadTrackingCode: r.spectrum_upload_tracking_code || null,
    spectrumUploadVendorCode: r.spectrum_upload_vendor_code || null,
    spectrumUploadAttempts: r.spectrum_upload_attempts != null ? Number(r.spectrum_upload_attempts) : 0,
    lastSpectrumError: r.spectrum_upload_error || r.last_spectrum_error || null,
    // Soft-delete fields (added 2026-04-11)
    ...(typeof r.is_trash === 'boolean' ? { isTrash: r.is_trash } : {}),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
    // Trash "Deleted By": discarded rows have no deleted_by (they are not
    // soft-deleted), so fall back to discarded_by ('retro-filter', 'pipeline',
    // or a user email). Legacy rows may be null on both — frontend shows "—".
    deletedBy: r.deleted_by || r.discarded_by || null,
    deletionReason: r.deletion_reason || null,
    restoredAt: r.restored_at ? r.restored_at.toISOString() : null,
    restoredBy: r.restored_by || null,
    ...((Object.prototype.hasOwnProperty.call(r, 'unread_replies')
      || Object.prototype.hasOwnProperty.call(r, 'unreadReplies')) ? {
      unreadReplies: Number.parseInt(r.unread_replies ?? r.unreadReplies, 10) || 0,
      unreadComments: Number.parseInt(r.unread_comments ?? r.unreadComments, 10) || 0,
    } : {}),
  };
}

module.exports = {
  pool,
  audit,
  deriveWaiverStatus,
  getVendorBypassCounts,
  getWaiverActionSerializationOptions,
  getWaiverActionState,
  rowToDoc,
};
