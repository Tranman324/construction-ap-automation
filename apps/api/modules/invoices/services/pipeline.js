#!/usr/bin/env node
/**
 * Invoice Pipeline — Main orchestrator
 * 
 * Polls invoices@northwindcg.example, downloads attachments, classifies documents,
 * extracts invoice data, matches vendors/subcontracts, and queues for approval.
 * 
 * Usage:
 *   node modules/invoices/services/pipeline.js run           — full pipeline run
 *   node modules/invoices/services/pipeline.js run --dry     — dry run (process but don't update state)
 *   node modules/invoices/services/pipeline.js status        — show queue status
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pool = require('../../../lib/db');
const { insertAuditEvent } = require('../../../lib/auditEvents');
const logger = require('../../../lib/logger');
const { callHaiku } = require('./vision');
const { buildStoredFilename, detectFileType } = require('./file-types');
const { collectImageText, collectPdfText } = require('./ocr');
const { sanitizeFilename, sanitizePathForShell } = require('./sanitize');
const { convertToPdf, isWordDoc } = require('./docConvert');
const junkFilter = require('./junkFilterService');
const {
  matchStatementLines,
  normalizeStatementLines,
} = require('./statementLines');
const { buildExtractedStatementAttributes } = require('./statementAttributes');
const { getPerPageTexts, applyWaiverPrePass } = require('./waiverDetection');

const { PIPELINE_STATUS_PATH, DOCUMENT_EMAIL } = require('../../../config');
const { divertInboundEmail: defaultDivertInboundEmail, isAutomaticReply, isNdr, resolveWaiverRequestTarget, shouldInspectInbound } = require('./inboundCorrelationService');

const DATA_DIR = path.join(__dirname, '..', 'data');
const INCOMING_DIR = path.join(DATA_DIR, 'incoming');
const EXTRACTED_DIR = path.join(DATA_DIR, 'extracted');
const FILES_DIR = path.join(DATA_DIR, 'files');
const QUEUE_PATH = path.join(DATA_DIR, 'queue.json'); // kept for dry-run only
const PROCESSED_IDS_PATH = path.join(DATA_DIR, 'processed-ids.json');
const pipelineLogger = logger.child({ component: 'pipeline' });
// Ensure directories exist
[INCOMING_DIR, EXTRACTED_DIR, FILES_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// Match-time routing persistence (owner ruling 2026-07-23): a job-matched doc
// gets routing_code = PM's routing code, else 'D'. No job match → null.
// Sidecar failures must never block the insert.
function deriveInsertRoutingCode(match) {
  const jobNumber = match && match.job ? match.job.jobNumber : null;
  if (!jobNumber) return null;
  try {
    const { deriveRoutingCode } = require('./submitRouting');
    return deriveRoutingCode(jobNumber);
  } catch (err) {
    pipelineLogger.warn({ err, jobNumber }, 'routing derivation failed at insert');
    return null;
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
// Note on a document whose type is known but whose details could not be read
// (e.g. a PDF holding several lien waivers). Flagged for review, not an error.
const DETAILS_UNREADABLE_NOTE = 'Details could not be read automatically - review and enter details';

async function insertDocument(entry, db = pool) {
  // Last-line invariant: only active classifications (or pipeline sentinels)
  // may ever reach the documents table, regardless of which path built the entry.
  entry.classification = await enforceActiveClassification(entry.classification, 'insertDocument');
  const ext = entry.extracted || {};
  const match = entry.matching || {};
  const email = entry.email || {};

  // Self-vendor guard: if the AI extracted NCG as the vendor name, null it out.
  const { isSelfVendor } = require('./matcher');
  if (isSelfVendor(null, ext.vendorName)) {
    ext.vendorName = null;
  }

  // When the matcher returned a confident vendor, prefer its canonical name
  // over the AI-extracted vendorName (which may have picked up the bill-to
  // address instead of the actual vendor).
  if (match.vendor?.vendorCode && match.vendor?.vendorName) {
    ext.vendorName = match.vendor.vendorName;
  }

  const statementAttributes = entry.classification === 'statement'
    ? buildExtractedStatementAttributes(ext, entry.statementAttributes)
    : null;

  // Save PDF to disk if base64 present
  let filePath = entry.filePath || null;
  let fileSize = entry.pdfSize || 0;
  if (entry.pdfBase64) {
    const filename = buildStoredFilename(entry.id, entry.file, entry.filePath);
    filePath = path.join(FILES_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(entry.pdfBase64, 'base64'));
    fileSize = fs.statSync(filePath).size;
  }

  await db.query(`
    INSERT INTO documents (
      id, classification, status, confidence,
      file_name, file_path, file_size_bytes,
      email_message_id, email_conversation_id, email_from, email_subject, email_received_at,
      email_body_preview, email_body, email_body_content_type,
      vendor_name, vendor_address, invoice_number, invoice_date, due_date,
      amount, job_number, project_name, project_address, description, line_items, statement_lines,
      vendor_code, vendor_match_confidence, vendor_match_method, matched_vendor_name,
      job_match_number, job_match_confidence, job_match_method,
      subcontract_number, subcontract_match_confidence, subcontract_match_method,
      overall_confidence,
      split_from, duplicate_of, rejection_reason,
      flagged, notes,
      lien_waiver_status, display_name,
      page_classifications, coi_data, statement_attributes, doc_title,
      queued_at, updated_at, created_at,
      routing_code,
      discard_source, sha256, discarded_at, discarded_by,
      flagged_at, flagged_by, flag_reason,
      source_document_id, source_email_message_id, source_attachment_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
      $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,
      $58,$59,$60,$61,$62,$63
    )
  `, [
    entry.id,
    entry.classification || 'other',
    entry.status || 'pending',
    entry.confidence || match.overallConfidence || null,
    entry.file || null,
    filePath,
    fileSize || null,
    email.messageId || null,
    email.conversationId || null,
    email.from || null,
    email.subject || null,
    email.receivedAt || null,
    email.bodyPreview || null,
    email.body || null,
    email.bodyContentType || 'html',
    ext.vendorName || null,
    ext.vendorAddress || null,
    ext.invoiceNumber || null,
    ext.invoiceDate || null,
    ext.dueDate || null,
    ext.amount || null,
    ext.jobNumber || null,
    ext.projectName || null,
    ext.projectAddress || null,
    ext.description || null,
    JSON.stringify(ext.lineItems || []),
    JSON.stringify(ext.statementLines || []),
    match.vendor?.vendorCode || null,
    match.vendor?.confidence || null,
    match.vendor?.method || null,
    match.vendor?.vendorName || null,
    match.job?.jobNumber || null,
    match.job?.confidence || null,
    match.job?.method || null,
    match.subcontract?.subcontractNumber || null,
    match.subcontract?.confidence || null,
    match.subcontract?.method || null,
    match.overallConfidence || entry.overallConfidence || null,
    entry.splitFrom || null,
    entry.duplicateOf || null,
    entry.rejectionReason || null,
    entry.flagged || false,
    entry.notes || null,
    entry.lienWaiverStatus || null,
    entry.displayName || null,
    entry.pageClassifications ? JSON.stringify(entry.pageClassifications) : null,
    ext._coiData ? JSON.stringify(ext._coiData) : null,
    statementAttributes ? JSON.stringify(statementAttributes) : null,
    typeof ext.docTitle === 'string' ? ext.docTitle.trim().slice(0, 255) || null : null,
    entry.queuedAt || new Date().toISOString(),
    entry.queuedAt || new Date().toISOString(),
    entry.queuedAt || new Date().toISOString(),
    deriveInsertRoutingCode(match),
    // Trash-tab provenance: pre-discarded rows carry their filter source and
    // content hash so the frontend pill renders and restore can un-junk.
    entry.discardSource || null,
    entry.sha256 || null,
    entry.status === 'discarded' ? (entry.discardedAt || new Date().toISOString()) : null,
    entry.status === 'discarded' ? (entry.discardedBy || 'pipeline') : null,
    // Review flag (UI shows flags where flagged_at IS NOT NULL).
    entry.flaggedAt || null,
    entry.flaggedAt ? (entry.flaggedBy || 'pipeline') : null,
    entry.flaggedAt ? (entry.flagReason || null) : null,
    entry.sourceDocumentId || null,
    entry.sourceEmailMessageId || null,
    entry.sourceAttachmentId || null,
  ]);

  // Audit log
  await db.query(
    'INSERT INTO audit_log (document_id, action, actor) VALUES ($1, $2, $3)',
    [entry.id, 'queued', 'pipeline']
  );
  await insertAuditEvent({
    type: 'invoice.intake', actor: { userId: null, name: 'System', role: 'pipeline' },
    target: { type: 'invoice', id: entry.id },
    changes: { from: email.from || null, subject: email.subject || null, receivedAt: email.receivedAt || null },
    summary: 'Document received', module: 'invoices',
  }, db);
}

async function recordCompletedInboundPromotion({ db, inbound, attachmentId, documentId }) {
  if (!inbound?.messageId || inbound.correlationState !== 'matched' || !inbound.documentId || !attachmentId) return;
  const promotionId = `promotion-${inbound.messageId}-${attachmentId}`;
  await db.query(`INSERT INTO document_inbound_promotions
    (id,source_document_id,source_email_message_id,source_attachment_id,resulting_document_id,status,actor_user_id,completed_at)
    VALUES ($1,$2,$3,$4,$5,'completed','pipeline',NOW())
    ON CONFLICT (source_email_message_id,source_attachment_id) DO NOTHING`,
  [promotionId, inbound.documentId, inbound.messageId, attachmentId, documentId]);
}

/**
 * Trash-tab exposure for filtered attachments: the FIRST time a filter drops
 * a given content hash, insert a real (pre-discarded) document row so the
 * skip is visible in the dashboard Trash tab with a source pill. Repeat hits
 * of the same hash stay log-only (attachment_skip_log). The file is stored in
 * FILES_DIR like any other document so the Trash preview works.
 */
async function insertFilteredTrashDocument({
  filePath, reason, discardSource, sha256, email, db, sourceIdentity = {},
}) {
  let pdfBase64 = null;
  let pdfSize = 0;
  try {
    pdfBase64 = fs.readFileSync(filePath).toString('base64');
    pdfSize = fs.statSync(filePath).size;
  } catch (e) {
    pipelineLogger.warn({ err: e, filePath }, 'trash-row file read failed; inserting without stored file');
  }
  const entry = {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    classification: 'other',
    status: 'discarded',
    discardSource,
    sha256: sha256 || null,
    file: path.basename(filePath),
    filePath,
    pdfBase64,
    pdfSize,
    notes: reason,
    email: email || {},
    ...sourceIdentity,
  };
  await insertDocument(entry, db);
  return entry.id;
}

function describeInboundDiversion(inbound, email) {
  if (inbound.action === 'drop') return 'Dropped automatic reply';
  return inbound.action === 'held'
    ? `Held ambiguous inbound ${inbound.kind || 'reply'} for review`
    : `Captured inbound ${inbound.kind || 'reply'} on ${inbound.documentId || 'no document'}`;
}

async function findDuplicate(invoiceNumber, vendorCode, vendorEmail, db = pool) {
  if (!invoiceNumber) return null;
  // Normalize so punctuation/case drift between the original extraction and a
  // resend's extraction (e.g. "26-6150-01" vs "266150 01") still matches.
  const normalizedInvNum = String(invoiceNumber).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalizedInvNum) return null;
  // Discarded/duplicate earlier copies ARE valid match targets — a resend of
  // something already dealt with is still a duplicate. Prefer live copies
  // (submitted/pending/etc.) over discarded ones, then most recent.
  const result = await db.query(`
    SELECT id, status FROM documents
    WHERE invoice_number IS NOT NULL
      AND regexp_replace(upper(invoice_number), '[^A-Z0-9]', '', 'g') = $1
      AND (vendor_code = $2 OR email_from LIKE $3)
    ORDER BY CASE WHEN status IN ('discarded', 'duplicate') THEN 1 ELSE 0 END,
             queued_at DESC NULLS LAST
    LIMIT 1
  `, [normalizedInvNum, vendorCode || '', `%${vendorEmail || '___NOMATCH___'}%`]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

async function findExistingErrorDoc({ emailFrom, emailSubject, fileName, fileSizeBytes, db = pool }) {
  if (!emailFrom || !emailSubject || !fileName) return null;
  const result = await db.query(`
    SELECT id, notes
    FROM documents
    WHERE classification = 'error'
      AND status != 'duplicate'
      AND email_from = $1
      AND email_subject = $2
      AND file_name = $3
      AND ($4::integer IS NULL OR file_size_bytes = $4)
      AND queued_at > NOW() - INTERVAL '30 days'
    ORDER BY updated_at DESC
    LIMIT 1
  `, [emailFrom, emailSubject, fileName, fileSizeBytes || null]);
  return result.rows[0] || null;
}

async function touchExistingErrorDoc(existingId, error = {}, db = pool) {
  const noteLine = `[retry ${new Date().toISOString()}] [${error.stage || 'classification'}] ${error.message || 'Unknown error'}`;
  await db.query(
    `UPDATE documents
        SET updated_at = NOW(),
            flagged = true,
            notes = CASE
              WHEN notes IS NULL OR notes = '' THEN $2
              ELSE notes || E'\n' || $2
            END
      WHERE id = $1`,
    [existingId, noteLine]
  );
  await db.query(
    'INSERT INTO audit_log (document_id, action, actor, changes) VALUES ($1, $2, $3, $4)',
    [existingId, 'error-duplicate-suppressed', 'pipeline', JSON.stringify({ error })]
  );
}

// Serializes one email's persistence and keeps its document set and processed
// marker in the same database transaction. The advisory lock closes the race
// where two pollers loaded the same pre-transaction processed-email snapshot.
async function beginEmailIngestionTransaction(db, emailId) {
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [emailId]);
    const existing = await db.query('SELECT 1 FROM processed_emails WHERE email_id = $1', [emailId]);
    if (existing.rows.length > 0) {
      await db.query('ROLLBACK');
      return false;
    }
    return true;
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

async function finishEmailIngestionTransaction(db, emailId, { internetMessageId } = {}) {
  await db.query(
    'INSERT INTO processed_emails (email_id, processed_at, internet_message_id) VALUES ($1, $2, $3) ON CONFLICT (email_id) DO NOTHING',
    [emailId, new Date().toISOString(), internetMessageId || null]
  );
  await db.query('COMMIT');
}

async function rollbackEmailIngestionTransaction(db) {
  try { await db.query('ROLLBACK'); } catch (_) {}
}

async function runEmailIngestionTransaction({ db, emailId, internetMessageId, persist }) {
  const started = await beginEmailIngestionTransaction(db, emailId);
  if (!started) return { alreadyProcessed: true };
  try {
    const value = await persist(db);
    await finishEmailIngestionTransaction(db, emailId, { internetMessageId });
    return { alreadyProcessed: false, value };
  } catch (err) {
    await rollbackEmailIngestionTransaction(db);
    throw err;
  }
}

async function findExistingEmailAttachment({ db, emailId, fileName, fileSizeBytes }) {
  const result = await db.query(
    `SELECT id FROM documents
      WHERE email_message_id = $1
        AND file_name = $2
        AND file_size_bytes = $3
      LIMIT 1`,
    [emailId, fileName, fileSizeBytes]
  );
  return result.rows[0] || null;
}

async function materializeExhaustedRetryDocuments({ db, email, attachments, error, runId, createDocument = insertDocument, fallbackToBody = false, inbound = null }) {
  const created = [];
  const senderEmail = email.from?.emailAddress?.address || '';
  for (const attachment of attachments || []) {
    const filePath = attachment.path || attachment.filePath;
    if (!filePath) continue;
    const fileName = attachment.filename || path.basename(filePath);
    const fileSizeBytes = attachment.size ?? fs.statSync(filePath).size;
    const existing = await findExistingEmailAttachment({
      db,
      emailId: email.id,
      fileName,
      fileSizeBytes,
    });
    if (existing) continue;

    const message = error.message || 'Pipeline retry limit reached';
    const stage = error.stage || 'classification';
    const entry = {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      runId,
      classification: 'error',
      status: 'retry-pending',
      file: fileName,
      filePath,
      pdfSize: fileSizeBytes,
      flagged: true,
      notes: `[${stage}] ${message}`,
      email: {
        messageId: email.id,
        conversationId: email.conversationId || null,
        from: senderEmail,
        subject: email.subject || '',
        receivedAt: email.receivedDateTime || '',
        bodyPreview: (email.bodyPreview || '').slice(0, 500),
        body: email.body?.content || null,
        bodyContentType: email.body?.contentType || null,
      },
      sourceDocumentId: inbound?.correlationState === 'matched' ? inbound.documentId : null,
      sourceEmailMessageId: inbound?.messageId || null,
      sourceAttachmentId: attachment.attachmentId || null,
    };
    await createDocument(entry, db);
    created.push(entry);
  }
  const hasMaterializableAttachment = (attachments || []).some((attachment) => attachment.path || attachment.filePath);
  if (!hasMaterializableAttachment && fallbackToBody) {
    const entry = {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-body`,
      runId,
      classification: 'no-attachment',
      status: 'pending',
      file: null,
      email: {
        messageId: email.id,
        conversationId: email.conversationId || null,
        from: senderEmail,
        subject: email.subject || '',
        receivedAt: email.receivedDateTime || '',
        bodyPreview: (email.bodyPreview || '').slice(0, 500),
        body: email.body?.content || null,
        bodyContentType: email.body?.contentType || 'html',
      },
      queuedAt: new Date().toISOString(),
    };
    await createDocument(entry, db);
    created.push(entry);
  }
  return created;
}

// Waiver linking uses its own transaction and connection. It must therefore
// happen only after the ingestion transaction commits, so that service can see
// the newly persisted waiver row. A linking failure is advisory and must never
// undo the successfully-ingested email.
async function autoLinkCommittedWaivers(waivers, autoLink = null, logMessage = log) {
  if (!Array.isArray(waivers) || waivers.length === 0) return;
  let linkWaiver = autoLink;
  if (!linkWaiver) {
    try {
      linkWaiver = require('./waiverAutoLinkService').autoLinkWaiver;
    } catch (autoLinkErr) {
      logMessage(`  ⚠ Waiver auto-link unavailable: ${autoLinkErr.message}`);
      return;
    }
  }
  for (const waiver of waivers) {
    try {
      await linkWaiver(waiver, { log: logMessage, targetInvoiceId: waiver.targetInvoiceId,
        attachmentCount: waiver.attachmentCount, targetLinkSource: waiver.targetLinkSource });
    } catch (autoLinkErr) {
      logMessage(`  ⚠ Waiver auto-link error: ${autoLinkErr.message}`);
    }
  }
}

function normalizeExtractedDates(extracted, emailReceivedDate = null) {
  if (!extracted) return extracted;

  const isValidDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d).getTime());
  const currentYear = new Date().getFullYear();

  /**
   * Sanity-check a parsed date: year must be 2000..currentYear+5.
   * Returns the date string if sane, null otherwise.
   */
  const isSaneYear = (dateStr) => {
    if (!dateStr) return null;
    const year = new Date(dateStr).getFullYear();
    if (year < 2000 || year > currentYear + 5) return null;
    return dateStr;
  };

  // Validate and sanity-check invoiceDate
  if (extracted.invoiceDate && !isValidDate(extracted.invoiceDate)) {
    extracted.invoiceDate = null;
  }
  if (extracted.invoiceDate) {
    extracted.invoiceDate = isSaneYear(extracted.invoiceDate);
  }

  // Fall back to email received date when invoiceDate is missing/invalid
  if (!extracted.invoiceDate && emailReceivedDate) {
    extracted.invoiceDate = emailReceivedDate.split('T')[0];
  }

  const dueDateBase = extracted.invoiceDate || null;

  // Validate and sanity-check dueDate
  if (extracted.dueDate && !isValidDate(extracted.dueDate)) {
    let netDays = 30;
    const termsMatch = extracted.dueDate.match(/net\s*(\d+)/i);
    if (termsMatch) netDays = parseInt(termsMatch[1], 10);
    if (dueDateBase) {
      const invDate = new Date(dueDateBase);
      invDate.setDate(invDate.getDate() + netDays);
      extracted.dueDate = invDate.toISOString().split('T')[0];
    } else {
      extracted.dueDate = null;
    }
  }
  if (extracted.dueDate) {
    extracted.dueDate = isSaneYear(extracted.dueDate);
  }

  // Default missing dueDate to invoiceDate + 30
  if (!extracted.dueDate && dueDateBase) {
    const invDate = new Date(dueDateBase);
    invDate.setDate(invDate.getDate() + 30);
    extracted.dueDate = invDate.toISOString().split('T')[0];
  }

  return extracted;
}

const AMAZON_GL_CATEGORIES = [
  { category: 'office_supplies', gl: '5600', costType: null, examples: 'Paper, pens, toner, binders, labels, tape, folders, envelopes, sticky notes' },
  { category: 'food_beverage', gl: '7200', costType: null, examples: 'Snacks, coffee, water, plates, cups, napkins, catering supplies' },
  { category: 'computer_equipment', gl: '7300', costType: null, examples: 'Keyboards, monitors, cables, drives, mice, chargers, adapters, headsets' },
  { category: 'tools_equipment', gl: '5500', costType: null, examples: 'Power tools, drill bits, safety gear, PPE, hard hats, gloves, tape measures' },
  { category: 'fixed_assets', gl: '1816', costType: null, examples: 'Phones, computers, laptops, tablets, printers, appliances, furniture, any capital equipment' },
  { category: 'job_materials', gl: '5300', costType: 'M', examples: 'Construction materials, appliances, fixtures, or job-specific items with a PO number or job reference' },
];

async function classifyAmazonGL(doc) {
  const lineItems = doc.line_items;
  const description = doc.description || '';
  const itemText = Array.isArray(lineItems) && lineItems.length > 0
    ? lineItems.map(li => typeof li === 'string' ? li : (li.description || li.name || JSON.stringify(li))).join('\n')
    : description;

  if (!itemText.trim()) return null;

  const categoryTable = AMAZON_GL_CATEGORIES
    .map(c => `- ${c.category}: ${c.examples}`)
    .join('\n');

  const prompt = `You are classifying an Amazon Business invoice for a construction company's accounting system.

Based on the line items below, classify this purchase into exactly ONE category.
If items span multiple categories, pick the one that represents the largest dollar value or most items.

Categories:
${categoryTable}

Line items:
${itemText.substring(0, 2000)}

Respond with ONLY the category name (e.g. "office_supplies"). If you cannot determine the category, respond with "unknown".`;

  const result = await callHaiku([], prompt, 50);
  const answer = (result.text || '').trim().toLowerCase().replace(/[^a-z_]/g, '');
  const match = AMAZON_GL_CATEGORIES.find(c => c.category === answer);
  return match ? { gl: match.gl, costType: match.costType, category: match.category } : null;
}

function pipelineChanges(document, patches) {
  return Object.fromEntries(Object.entries(patches).map(([field, value]) => [
    field.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase()),
    [document[field] ?? null, value],
  ]));
}

function pipelineRuleAuditPatches(document, patches) {
  if (
    patches.status === 'discarded'
    && document.classification === 'lien-waiver'
    && document.linked_lien_waiver_id
  ) {
    return { ...patches, filed: false, filed_at: null };
  }
  return patches;
}

async function applyAmazonGLClassification(doc, result, db = pool) {
  const setClauses = ['gl_account = $2', 'updated_at = NOW()'];
  const params = [doc.id, result.gl];
  const patches = { gl_account: result.gl };
  if (result.costType) {
    setClauses.push(`cost_type = $${params.length + 1}`);
    params.push(result.costType);
    patches.cost_type = result.costType;
  }

  await db.query(`UPDATE documents SET ${setClauses.join(', ')} WHERE id = $1`, params);
  await insertAuditEvent({
    type: 'invoice.classified',
    actor: { userId: null, name: 'System', role: 'pipeline' },
    target: { type: 'invoice', id: doc.id },
    changes: pipelineChanges(doc, patches),
    summary: `Pipeline classified: ${result.category}`,
    module: 'invoices',
    severity: 'info',
  }, db);
}

async function emitPipelineRulesAppliedEvent({ document, patchUpdate, matchedRules, db = pool }) {
  const auditPatches = pipelineRuleAuditPatches(document, patchUpdate.patches);
  await insertAuditEvent({
    type: 'invoice.classified',
    actor: { userId: null, name: 'System', role: 'pipeline' },
    target: { type: 'invoice', id: document.id },
    changes: pipelineChanges(document, auditPatches),
    summary: `Rules applied: ${matchedRules.join(', ')}`,
    module: 'invoices',
    severity: 'info',
  }, db);
}

async function getQueueCount() {
  const result = await pool.query('SELECT COUNT(*) FROM documents');
  return parseInt(result.rows[0].count, 10);
}

function loadJSON(filepath, fallback) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); } catch { return fallback; }
}

function saveJSON(filepath, data) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function log(msg) {
  pipelineLogger.info(msg);
}

// --- Graph API direct access (for shared mailbox) ---
const graph = require('../../../lib/graph');
const { INVOICE_MAILBOX: SHARED_MAILBOX, INVOICE_SUBFOLDERS } = require('../../../config');

async function graphFetch(urlPath) {
  return graph.graphFetch(urlPath);
}

// --- Step 1+2: Fetch unread emails from shared mailbox + configured subfolders ---
// Date floor: ignore emails older than SCAN_LOOKBACK_DAYS to prevent reprocessing
// ancient emails that get moved back into the inbox (e.g., folder cleanup).
const SCAN_LOOKBACK_DAYS = 45;

async function fetchEmailList() {
  log('Fetching unread emails from invoices@northwindcg.example...');
  
  try {
    const select = '$select=id,subject,from,receivedDateTime,isRead,bodyPreview,body,hasAttachments,conversationId,internetMessageId,internetMessageHeaders';
    const top = 200;

    // Date floor — only fetch emails from the last N days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - SCAN_LOOKBACK_DAYS);
    const dateFilter = `$filter=receivedDateTime ge ${cutoff.toISOString()}`;

    // Poll root inbox
    const inboxData = await graphFetch(
      `/users/${SHARED_MAILBOX}/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime desc&${select}&${dateFilter}`
    );
    let emails = inboxData.value || [];

    // Poll additional subfolders (e.g. "Saved Invoices", "Home Depot")
    for (const [folderId, folderName] of Object.entries(INVOICE_SUBFOLDERS || {})) {
      try {
        const folderData = await graphFetch(
          `/users/${SHARED_MAILBOX}/mailFolders/${folderId}/messages?$top=${top}&$orderby=receivedDateTime desc&${select}&${dateFilter}`
        );
        const folderEmails = folderData.value || [];
        if (folderEmails.length > 0) {
          log(`  + ${folderEmails.length} from subfolder: ${folderName}`);
          emails = emails.concat(folderEmails);
        }
      } catch (subErr) {
        log(`  WARNING: Could not poll subfolder "${folderName}": ${subErr.message}`);
      }
    }

    log(`Found ${emails.length} emails total (lookback: ${SCAN_LOOKBACK_DAYS} days)`);
    return emails;
  } catch (e) {
    // CRITICAL: Do NOT swallow email fetch failures silently.
    // Returning [] here previously caused the pipeline to write a false
    // 'processed: 0' success to pipeline-status.json, masking real auth/network
    // failures. Re-throw so runPipeline() can report a proper error exit.
    log(`❌ Email fetch failed: ${e.message}`);
    const err = new Error(`Email fetch failed: ${e.message}`);
    err.stage = 'fetch-email-list';
    err.original = e;
    throw err;
  }
}

// --- Step 3: Download attachments for an email ---
// Inline images below this size are treated as email signature graphics/logos.
// Phone receipt photos are typically 30-50KB+; signature logos are 1-5KB.
const INLINE_SIZE_THRESHOLD = 15000; // 15KB

function hasInlineAttachmentReference(email) {
  const bodyContent = typeof email.body === 'string' ? email.body : (email.body?.content || '');
  const contentType = typeof email.body === 'string' ? email.bodyContentType : email.body?.contentType;
  return String(contentType || '').toLowerCase() === 'html'
    && /(?:src|href|background)\s*=\s*["']?\s*cid:/i.test(bodyContent);
}

async function downloadAttachments(messageId, emailDir, emailMeta = {}) {
  const downloaded = [];
  let inlineRescued = 0;
  try {
    fs.mkdirSync(emailDir, { recursive: true });
  } catch (e) {
    log(`  Attachment download failed: ${e.message}`);
    return { files: [], inlineRescued, failed: true, error: e.message };
  }

  let data;
  try {
    data = await graphFetch(`/users/${SHARED_MAILBOX}/messages/${messageId}/attachments`);
  } catch (e) {
    log(`  Attachment download failed: ${e.message}`);
    return { files: [], inlineRescued, failed: true, error: e.message };
  }

  const usedPaths = new Set();
  for (const att of (data?.value || [])) {
    if (att['@odata.type'] === '#microsoft.graph.fileAttachment') {
      // Skip tiny inline images (email signatures, logos, tracking pixels) but keep
      // larger inline images (receipt photos from phones, scanned statements).
      // Phone receipt photos are typically 30-50KB+; signature logos are 1-5KB.
      if (att.isInline && /^image\//i.test(att.contentType)) {
        if (!att.name || att.name === 'noname' || att.size < INLINE_SIZE_THRESHOLD) {
          log(`  Skipping inline image: ${att.name || '(unnamed)'} (${att.contentType}, ${att.size} bytes)`);
          if (!emailMeta.dryRun) {
            await junkFilter.logSkip({
              fileName: att.name || '(unnamed)',
              fileSizeBytes: att.size ?? null,
              sha256: att.contentBytes ? junkFilter.sha256Buffer(Buffer.from(att.contentBytes, 'base64')) : null,
              reason: `inline-image (${att.contentType}, ${att.size} bytes)`,
              emailFrom: emailMeta.from || null,
              emailSubject: emailMeta.subject || null,
              emailMessageId: messageId,
            });
          }
          continue;
        }
        log(`  Including large inline image as potential receipt: ${att.name} (${att.size} bytes)`);
        inlineRescued++;
      }
      // Sanitize filename: strip all shell metacharacters and unsafe characters.
      // att.name comes from the email sender and is untrusted input.
      const safeName = sanitizeFilename(att.name || 'unnamed');
      const extension = path.extname(safeName);
      const fileStem = extension ? safeName.slice(0, -extension.length) : safeName;
      const wordAttachment = isWordDoc(safeName);
      let collisionNumber = 1;
      let filePath;
      let convertedPdfPath;
      do {
        const suffix = collisionNumber === 1 ? '' : ` (${collisionNumber})`;
        filePath = path.join(emailDir, `${fileStem}${suffix}${extension}`);
        convertedPdfPath = wordAttachment ? path.join(emailDir, `${fileStem}${suffix}.pdf`) : null;
        collisionNumber++;
      } while (usedPaths.has(filePath) || (convertedPdfPath && usedPaths.has(convertedPdfPath)));
      usedPaths.add(filePath);
      if (convertedPdfPath) usedPaths.add(convertedPdfPath);
      try {
        fs.writeFileSync(filePath, Buffer.from(att.contentBytes, 'base64'));
      } catch (e) {
        log(`  Attachment download failed: ${e.message}`);
        return { files: [], inlineRescued, failed: true, error: e.message };
      }

      const metadata = { attachmentId: att.id || null, isInline: Boolean(att.isInline) };
      // Convert Word docs to PDF in place — downstream expects PDF or image
      if (isWordDoc(filePath)) {
        try {
          const pdfPath = convertToPdf(filePath);
          usedPaths.add(pdfPath);
          log(`  Converted Word doc to PDF: ${att.name} → ${path.basename(pdfPath)}`);
          downloaded.push({ filename: att.name, path: pdfPath, size: fs.statSync(pdfPath).size, convertedFromWord: true, ...metadata });
        } catch (convErr) {
          log(`  Word→PDF conversion failed for ${att.name}: ${convErr.message}`);
          downloaded.push({ filename: att.name, path: filePath, size: att.size, conversionFailed: true, ...metadata });
        }
      } else {
        downloaded.push({ filename: att.name, path: filePath, size: att.size, ...metadata });
      }
    }
  }

  log(`  Downloaded ${downloaded.length} attachment(s)${inlineRescued > 0 ? ` (${inlineRescued} inline rescued)` : ''}`);
  return { files: downloaded, inlineRescued, failed: false, error: null };
}



// --- Step 4b: Refetch a single attachment from Graph (for corruption retry) ---
const STRUCTURAL_CORRUPTION_PATTERNS = [
  /Catalog dictionary not located/i,
  /Couldn't find trailer/i,
  /Couldn't read xref/i,
  /no pages/i,
  /FirstPage is greater than/i,
  /no images defined/i,
];

function isStructuralCorruption(errorMessage) {
  return STRUCTURAL_CORRUPTION_PATTERNS.some(p => p.test(errorMessage));
}

async function refetchAttachment(messageId, originalFileName, destPath) {
  try {
    const data = await graphFetch(`/users/${SHARED_MAILBOX}/messages/${messageId}/attachments`);
    for (const att of (data.value || [])) {
      if (att['@odata.type'] !== '#microsoft.graph.fileAttachment') continue;
      // Match by filename (original unsanitized name)
      if (att.name === originalFileName) {
        fs.writeFileSync(destPath, Buffer.from(att.contentBytes, 'base64'));
        log(`  → Refetched attachment "${att.name}" (${att.size} bytes)`);
        return true;
      }
    }
    // Fallback: try sanitized match
    const safeName = sanitizeFilename(originalFileName);
    for (const att of (data.value || [])) {
      if (att['@odata.type'] !== '#microsoft.graph.fileAttachment') continue;
      if (sanitizeFilename(att.name || '') === safeName) {
        fs.writeFileSync(destPath, Buffer.from(att.contentBytes, 'base64'));
        log(`  → Refetched attachment "${att.name}" via sanitized match (${att.size} bytes)`);
        return true;
      }
    }
    log(`  → Refetch failed: attachment "${originalFileName}" not found in message`);
    return false;
  } catch (e) {
    log(`  → Refetch failed: ${e.message}`);
    return false;
  }
}

const INVOICE_EXTRACTION_CLASSIFICATIONS = ['invoice', 'receipt', 'credit-memo', 'pay-application'];
// Warranty documents use the same intentionally light, document-visible
// project extraction as permits.  They are not invoice-like and must not be
// routed through amount/vendor matching merely to recover a project reference.
const PROJECT_EXTRACTION_CLASSIFICATIONS = ['building-permit', 'other', 'warranty'];
const EXTRACTION_CLASSIFICATIONS = [
  ...INVOICE_EXTRACTION_CLASSIFICATIONS,
  ...PROJECT_EXTRACTION_CLASSIFICATIONS,
  'coi',
  'statement',
  'lien-waiver',
];
const AUTO_MATCH_CONFIDENCE = 0.85;
const SUGGESTION_MATCH_CONFIDENCE = 0.7;
const CLASSIFICATION_SELECTION_PRIORITY = [
  'invoice',
  'pay-application',
  'receipt',
  'credit-memo',
  'lien-waiver',
  'building-permit',
  // Above 'coi': executed subcontract packets usually embed a real COI page;
  // the agreement should win the doc-level classification, not the attachment.
  'subcontract-agreement',
  'coi',
  'statement',
];

function normalizeClassificationName(value) {
  if (!value || typeof value !== 'string') return 'other';
  let normalized = value
    .replace(/[_ ]+/g, '-')
    .replace(/[^a-z0-9-]/gi, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim()
    .toLowerCase();
  // Pay-app / AIA variants → the built-in 'pay-application' type (NOT 'invoice';
  // pay-application is its own active built-in that opens as invoice).
  if (
    ['pay-app', 'payapp', 'pay-application', 'payment-application'].includes(normalized) ||
    /^application-for-payment/.test(normalized) ||
    /aia-?form|aia-?g70[23]/.test(normalized) ||
    (normalized.includes('application') && normalized.includes('payment'))
  ) {
    normalized = 'pay-application';
  }
  return normalized || 'other';
}

// Sentinel classifications the pipeline itself assigns; never coerce these.
const PIPELINE_SENTINEL_CLASSIFICATIONS = new Set(['error', 'duplicate', 'skipped', 'unsupported', 'no-attachment']);

// Enforce the invariant: documents may only carry an active classification
// (built-in or user-created) or a pipeline sentinel. Anything else → 'other'.
async function enforceActiveClassification(value, context = '') {
  const normalized = normalizeClassificationName(value);
  if (PIPELINE_SENTINEL_CLASSIFICATIONS.has(normalized)) return normalized;
  // Fast path: built-in types need no DB lookup.
  try {
    const { BUILT_IN_CLASSIFICATIONS } = require('../routes/settings');
    if (BUILT_IN_CLASSIFICATIONS.some((c) => c.name === normalized)) return normalized;
  } catch {}
  try {
    const { getActiveClassificationNames } = require('../routes/settings');
    const activeNames = await getActiveClassificationNames();
    if (!activeNames.has(normalized)) {
      log(`  → enforceActiveClassification${context ? ` [${context}]` : ''}: unknown type "${normalized}" → other`);
      return 'other';
    }
  } catch (e) {
    // If the active list is unavailable, fail open with the normalized value —
    // normalization alone already blocks freeform strings with spaces/parens.
    log(`  ⚠ enforceActiveClassification: could not load active types (${e.message}); using normalized value`);
  }
  return normalized;
}

function isInvoiceLikeClassification(classification) {
  return INVOICE_EXTRACTION_CLASSIFICATIONS.includes(classification);
}

function isExtractionEnabledForClassification(classification) {
  return EXTRACTION_CLASSIFICATIONS.includes(classification);
}

function shouldUseCombinedSinglePageInvoiceExtraction(pageCount, forcedClassification = null) {
  return pageCount === 1 && !forcedClassification;
}

function attachExtractedPayloadToQueueEntry(queueEntry, classResult) {
  if (
    queueEntry &&
    classResult?.extracted &&
    isExtractionEnabledForClassification(classResult.classification)
  ) {
    queueEntry.extracted = classResult.extracted;
  }
  return queueEntry;
}

function cleanTextValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || /^(?:null|none|n\/a|na|unknown)$/i.test(trimmed)) return null;
  return trimmed;
}

function pickCleanText(source, keys) {
  if (!source) return null;
  for (const key of keys) {
    const cleaned = cleanTextValue(source[key]);
    if (typeof cleaned === 'string' && cleaned) return cleaned;
  }
  return null;
}

function pickRawValue(source, keys) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function normalizeCurrencyAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const negative = /^\(.*\)$/.test(trimmed);
  const numeric = Number(trimmed.replace(/[,$()\s]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return negative ? -numeric : numeric;
}

function normalizeIsoDate(value) {
  const cleaned = cleanTextValue(value);
  if (typeof cleaned !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) && !isNaN(new Date(cleaned).getTime())
    ? cleaned
    : null;
}

function findJobRefInText(...values) {
  const text = values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .join(' ');
  const match = text.match(/\b(\d{2}-(?:SVC)?\d{3})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function normalizePermitExtraction(extracted) {
  const source = extracted || {};
  const docTitle = pickCleanText(source, ['docTitle', 'documentTitle', 'title', 'heading']);
  return {
    projectName: pickCleanText(source, ['projectName', 'project', 'projectTitle', 'jobName', 'siteName']),
    projectAddress: pickCleanText(source, ['projectAddress', 'siteAddress', 'jobAddress', 'address', 'propertyAddress']),
    ...(docTitle ? { docTitle } : {}),
  };
}

function normalizeReceiptExtraction(extracted, context = {}) {
  const source = extracted || {};
  const lineItemText = Array.isArray(source.lineItems)
    ? source.lineItems.map((li) => [li.description, li.jobRef, li.poNumber, li.referenceNumber].filter(Boolean).join(' '))
    : [];
  return {
    ...source,
    jobRef: findJobRefInText(
      source.jobRef,
      source.poNumber,
      source.purchaseOrder,
      source.purchaseOrderNumber,
      source.po,
      source.referenceNumber,
      source.description,
      lineItemText,
      context.emailSubject,
      context.documentText,
      context.supplementalText
    ) || cleanTextValue(source.jobRef),
  };
}

function normalizeCoiExtraction(extracted) {
  const source = extracted || {};
  const normalized = {
    insuredName: pickCleanText(source, ['insuredName', 'namedInsured', 'insured', 'insuredParty']),
    expirationDate: normalizeIsoDate(pickRawValue(source, ['expirationDate', 'expires', 'expiration', 'policyExpirationDate'])),
  };

  // Structured COI compliance data → stored in documents.coi_data (JSONB)
  const coiData = {};

  // Coverage lines
  if (Array.isArray(source.coverageLines) && source.coverageLines.length > 0) {
    coiData.coverageLines = source.coverageLines.map(line => {
      const entry = {
        type: String(line.type || 'unknown').toLowerCase().trim(),
        carrier: cleanTextValue(line.carrier) || null,
        policyNumber: cleanTextValue(line.policyNumber) || null,
        expirationDate: normalizeIsoDate(line.expirationDate) || null,
      };
      // Normalize limits — keep only numeric values
      if (line.limits && typeof line.limits === 'object') {
        const limits = {};
        const includedKeys = [];
        for (const [key, val] of Object.entries(line.limits)) {
          const num = Number(val);
          if (!isNaN(num) && num > 0) { limits[key] = num; continue; }
          if (typeof val === 'string' && /^incl/i.test(val.trim())) includedKeys.push(key);
        }
        // ACORD certs print "Included" when a coverage shares another limit
        // instead of carrying its own sublimit (e.g. Personal & Adv Injury paid
        // from the each-occurrence limit). Map those to the line's
        // occurrence-level limit so compliance evaluates the real available
        // coverage instead of failing on a missing number.
        const sharedLimit = limits.eachOccurrence ?? limits.combinedSingleLimit;
        if (includedKeys.length > 0 && Number.isFinite(sharedLimit)) {
          for (const key of includedKeys) {
            if (!(key in limits)) limits[key] = sharedLimit;
          }
          entry.includedLimits = includedKeys;
        }
        if (Object.keys(limits).length > 0) entry.limits = limits;
      }
      return entry;
    });
  }

  // Endorsements
  if (source.endorsements && typeof source.endorsements === 'object') {
    coiData.endorsements = {
      additionalInsured: Boolean(source.endorsements.additionalInsured),
      additionalInsuredForms: Array.isArray(source.endorsements.additionalInsuredForms)
        ? source.endorsements.additionalInsuredForms.filter(f => typeof f === 'string')
        : [],
      waiverOfSubrogation: Boolean(source.endorsements.waiverOfSubrogation),
      primaryNoncontributory: Boolean(source.endorsements.primaryNoncontributory),
      completedOperations: Boolean(source.endorsements.completedOperations),
    };
  }

  // Certificate holder
  if (source.holder && typeof source.holder === 'object') {
    coiData.holder = {
      name: cleanTextValue(source.holder.name) || null,
      address: cleanTextValue(source.holder.address) || null,
    };
  }

  // Cancellation notice days
  const cancelDays = Number(source.cancellationNoticeDays);
  if (!isNaN(cancelDays) && cancelDays > 0) {
    coiData.cancellationNoticeDays = cancelDays;
  }

  if (Object.keys(coiData).length > 0) {
    normalized._coiData = coiData;
  }

  return normalized;
}

function normalizeStatementExtraction(extracted) {
  const source = extracted || {};
  const normalized = {
    vendor: pickCleanText(source, ['vendor', 'vendorName', 'statementVendor', 'companyName']),
    statementPeriod: pickCleanText(source, ['statementPeriod', 'period', 'billingPeriod']),
    balance: normalizeCurrencyAmount(pickRawValue(source, ['balance', 'balanceDue', 'amountDue', 'statementBalance'])),
  };
  const statementLines = normalizeStatementLines(source);
  if (statementLines.length > 0) {
    normalized.statementLines = statementLines;
  }
  return normalized;
}

function normalizeLienWaiverExtraction(extracted) {
  const source = extracted || {};
  return {
    vendorName: pickCleanText(source, ['vendorName', 'vendor', 'claimantName', 'contractorName', 'companyName']),
    amount: normalizeCurrencyAmount(pickRawValue(source, ['amount', 'waiverAmount', 'amountReleased', 'paymentAmount'])),
    invoiceNumber: pickCleanText(source, ['invoiceNumber', 'invoiceReference', 'invoiceRef', 'referenceNumber']),
    jobNumber: pickCleanText(source, ['jobNumber', 'jobRef', 'projectNumber', 'projectRef']),
  };
}

function normalizeExtractedFieldsForClassification(classification, extracted, context = {}) {
  if (!extracted) return extracted;
  switch (classification) {
    case 'building-permit':
    case 'other':
    case 'warranty':
      return normalizePermitExtraction(extracted);
    case 'receipt':
      return normalizeReceiptExtraction(extracted, context);
    case 'coi':
      return normalizeCoiExtraction(extracted);
    case 'statement':
      return normalizeStatementExtraction(extracted);
    case 'lien-waiver':
      return normalizeLienWaiverExtraction(extracted);
    default:
      return { ...extracted };
  }
}

function buildInvoiceExtractionPrompt(classification = 'invoice', activeClassNames = null) {
  const classificationRule = activeClassNames
    ? `The "classification" field MUST be exactly one of: ${activeClassNames}. Never invent new type names.`
    : `The "classification" field MUST be one of the known types. Never invent new type names.`;
  return `Extract invoice/billing data from this document.

${classificationRule}

Return ONLY valid JSON:
{
  "classification": "${classification}",
  "confidence": 0.95,
  "extracted": {
    "vendorName": "Company/store name",
    "vendorAddress": "Full address or null",
    "invoiceNumber": "Invoice/receipt/transaction number, ALPHANUMERIC ONLY, NO prefix labels, NO internal spaces. Examples: 'Invoice #305' → '305'; 'Invoice: 25-6059-04R' → '25-6059-04R'; '25 1254' → '251254'. Strip words like 'Invoice', 'Inv', 'No.', 'Number', '#' and strip all internal whitespace. null if not visible.",
    "invoiceDate": "YYYY-MM-DD or null",
    "dueDate": "YYYY-MM-DD or payment terms or null",
    "amount": 0.00,
    "jobNumber": "Top-level job/project number like 25-554 or 25-SVC403 or null (null if multiple jobs)",
    "projectName": "Top-level project name or null (null if multiple projects)",
    "projectAddress": "Job site / project address if different from vendor address, or null",
    "description": "Brief description of work/services/purchase",
    "docTitle": "Document title or heading exactly as visible, or null",
    "lineItems": [
      {
        "description": "Line item description",
        "amount": 0.00,
        "invoiceNumber": "Invoice number for THIS line item if different from top-level. ALPHANUMERIC ONLY, NO prefix labels, NO internal spaces (strip 'Invoice', 'Inv', 'No.', '#', and any whitespace). null if same as top-level.",
        "invoiceDate": "Invoice date for THIS line item if different from top-level. null if same.",
        "dueDate": "Due date for THIS line item if different from top-level. null if same.",
        "jobRef": "Job name, number, or abbreviation for THIS line item (e.g. 'NPX', '25-554', 'Harbor Point'). null if not specified.",
        "jobAddress": "Job site address for this line item if mentioned. null if not specified.",
        "subcontractRef": "Any reference matching the pattern XX-XXX.XX (e.g. '25-556.02') found in PO number, reference, or any field for this line item. null if not found."
      }
    ]
  }
}

IMPORTANT RULES:
- Extract from the INVOICE/BILLING pages. Ignore lien waiver or non-invoice pages.
- Each line item may reference a DIFFERENT job/project. Extract the job reference per line item.
- If a PDF contains MULTIPLE SEPARATE INVOICES (different invoice numbers on different pages), treat each invoice as a separate line item with its own invoiceNumber, amount, jobRef, and subcontractRef. Set top-level amount to the TOTAL.
- Look for the pattern ##-###.## (e.g. 25-556.02, 24-145.03) in ANY field — PO numbers, reference numbers, customer PO. If found, put it in subcontractRef.
- Look for the pattern ##-SVC### (e.g. 25-SVC403, 26-SVC401) in ANY field — descriptions, PO numbers, references. This is a SERVICE job number. If found, put it in jobNumber and REMOVE IT from the description field. It takes priority over other job references.
- AIA pay applications (G702/G703, "Application for Payment") are "pay-application".
- If not an invoice, pay-application, receipt, or credit-memo, return: {"classification": "<one of the allowed types>", "confidence": 0.95, "extracted": null}
Be precise. Use null for fields not visible. For amounts, use numbers not strings.`;
}

function buildReceiptExtractionPrompt() {
  return `${buildInvoiceExtractionPrompt('receipt')}

RECEIPT EXTENSION:
- Also return extracted.jobRef as the best visible job reference matching ##-### or ##-SVC###.
- Look for jobRef in PO number, purchase order number, subject/reference text, line items, and document text.
- Do not remove or rename any invoice/receipt fields.`;
}

function buildProjectExtractionPrompt(classification) {
  return `Extract project reference data from this ${classification === 'building-permit' ? 'building permit' : 'project-related'} document.

Return ONLY valid JSON:
{
  "classification": "${classification}",
  "confidence": 0.95,
  "extracted": {
    "projectName": "Project/job/development name visible in the document, or null",
    "projectAddress": "Project/site/property address visible in the document, or null",
    "docTitle": "Document title or heading exactly as visible, or null"
  }
}

Use only document-visible content. Do not infer from the email sender. Use null for fields not visible.`;
}

function buildCoiExtractionPrompt() {
  return `Extract certificate of insurance data from this document.

Return ONLY valid JSON:
{
  "classification": "coi",
  "confidence": 0.95,
  "extracted": {
    "insuredName": "Named insured / insured company visible on the COI, or null",
    "docTitle": "Document title or heading exactly as visible, or null",
    "expirationDate": "Earliest policy expiration date across all coverage types as YYYY-MM-DD, or null",
    "coverageLines": [
      {
        "type": "general-liability | automobile | umbrella | workers-comp | professional | pollution",
        "carrier": "Insurance carrier / company name for this coverage, or null",
        "policyNumber": "Policy number, or null",
        "expirationDate": "This coverage expiration as YYYY-MM-DD, or null",
        "limits": {
          "eachOccurrence": 0,
          "generalAggregate": 0,
          "productsCompOps": 0,
          "damageToRented": 0,
          "medicalExpense": 0,
          "personalAdvInjury": 0,
          "combinedSingleLimit": 0,
          "eachAccident": 0,
          "diseasePolicyLimit": 0,
          "diseaseEachEmployee": 0,
          "eachLoss": 0,
          "aggregate": 0
        }
      }
    ],
    "endorsements": {
      "additionalInsured": true or false,
      "additionalInsuredForms": ["CG 20 10", "CG 20 37"],
      "waiverOfSubrogation": true or false,
      "primaryNoncontributory": true or false,
      "completedOperations": true or false
    },
    "holder": {
      "name": "Certificate holder name exactly as printed, or null",
      "address": "Certificate holder address exactly as printed, or null"
    },
    "cancellationNoticeDays": 30
  }
}

IMPORTANT:
- For each coverage type present on the COI, include a coverageLines entry.
- Limits: use raw dollar numbers (no commas, no $). Include ONLY limits that are visible for that coverage type. Omit keys that don't apply. If a limit box shows the word "Included" (or "Incl") instead of a dollar amount, output the string "included" for that key — do NOT output null or invent a number.
- endorsements: look for Additional Insured, Waiver of Subrogation, Primary & Noncontributory, and Completed Operations language in the Description of Operations box and any attached endorsement forms. Treat ISO CG 20 10 / CG 20 37 (including compact CG2010 / CG2037 and their edition dates), and premises/ongoing operations or completed operations wording there, as Additional Insured evidence; set additionalInsured true and preserve the visible form identifiers in additionalInsuredForms.
- coverage: recognize pollution / contractors pollution coverage as its own coverage line and capture eachLoss and aggregate when visible.
- holder: extract EXACTLY as printed in the Certificate Holder box.
- cancellationNoticeDays: the number of days notice required before cancellation (usually in the cancellation section or remarks).
- Use null for fields not visible. Use only document-visible content. Do not infer from the email sender.`;
}

function buildStatementExtractionPrompt() {
  return `Extract statement data from this vendor statement.

Return ONLY valid JSON:
{
  "classification": "statement",
  "confidence": 0.95,
  "extracted": {
    "vendor": "Vendor/company name visible in the statement content, or null",
    "statementPeriod": "Statement period or statement date range visible in the document, or null",
    "balance": 0.00,
    "lines": [
      {
        "invoiceNumber": "Parent invoice/reference number visible on the statement",
        "date": "Invoice date as YYYY-MM-DD, or null",
        "amount": 0.00,
        "subItems": [
          {
            "date": "Detail date as YYYY-MM-DD, or null",
            "description": "Detail description",
            "amount": 0.00
          }
        ]
      }
    ]
  }
}

Vendor must come from document content only. Never use the email sender as the vendor. Extract one line per parent invoice/reference. If detail/sub-item rows appear under a parent invoice, include them under subItems so the backend can roll them up; do not emit sub-items as separate parent lines. Use null for fields not visible. For balance and amounts, use numbers not strings.`;
}

function buildLienWaiverExtractionPrompt() {
  return `Extract lien waiver data from this lien waiver or release document.

Return ONLY valid JSON:
{
  "classification": "lien-waiver",
  "confidence": 0.95,
  "extracted": {
    "vendorName": "Claimant, contractor, or vendor name printed on the waiver, or null",
    "amount": 0.00,
    "invoiceNumber": "Invoice/reference number the waiver identifies, or null",
    "jobNumber": "Project/job number such as 26-434 or 25-SVC403, or null"
  }
}

Use document-visible content only. The vendor must come from the waiver itself, never the email sender. Preserve the invoice/reference identifier exactly as printed apart from surrounding labels. Use null for fields not visible and numbers (not strings) for amount. Do not infer a document link or an invoice match from these fields.`;
}

function buildExtractionPromptForClassification(classification) {
  if (classification === 'receipt') return buildReceiptExtractionPrompt();
  if (PROJECT_EXTRACTION_CLASSIFICATIONS.includes(classification)) return buildProjectExtractionPrompt(classification);
  if (classification === 'coi') return buildCoiExtractionPrompt();
  if (classification === 'statement') return buildStatementExtractionPrompt();
  if (classification === 'lien-waiver') return buildLienWaiverExtractionPrompt();
  return buildInvoiceExtractionPrompt(classification || 'invoice');
}

// --- Step 5: Classify + Extract a document ---
async function classifyAndExtract(filePath, emailContext = {}) {
  const fileType = detectFileType(filePath);
  let ext = fileType.ext;
  if (!fileType.isPdf && !fileType.isImage) {
    return { classification: 'unsupported', file: path.basename(filePath), reason: `Unsupported format: ${ext || 'unknown'}` };
  }

  const preFilterReason = junkFilter.preFilterRealFile(filePath, emailContext.fileName || path.basename(filePath));
  if (preFilterReason) {
    return { classification: 'skipped', file: path.basename(filePath), reason: preFilterReason };
  }
  
  // Escape special chars in path for shell interpolation (ImageMagick, etc.)
  const safeFilePath = sanitizePathForShell(filePath);

  // Convert to image(s) for vision — multi-page PDFs get up to 5 pages
  let imagePaths = [];
  if (fileType.isPdf) {
    try {
      // Detect page count
      const identifyOut = execSync(`identify "${safeFilePath}" 2>/dev/null | wc -l`, { timeout: 10000 }).toString().trim();
      const pageCount = Math.min(parseInt(identifyOut) || 1, 5); // cap at 5 pages
      for (let p = 0; p < pageCount; p++) {
        const imgPath = `/tmp/invoice_classify_${Date.now()}_p${p}.png`;
        execSync(`convert -density 200 "${safeFilePath}"[${p}] -quality 95 "${imgPath}"`, { timeout: 30000 });
        imagePaths.push(imgPath);
      }
    } catch (e) {
      // Structural corruption retry: refetch from Graph once if the PDF is truncated/corrupt
      if (isStructuralCorruption(e.message) && emailContext.messageId && emailContext.fileName) {
        log(`  → Structural PDF corruption detected — attempting refetch from Graph...`);
        const refetched = await refetchAttachment(emailContext.messageId, emailContext.fileName, filePath);
        if (refetched) {
          try {
            const identifyOut2 = execSync(`identify "${safeFilePath}" 2>/dev/null | wc -l`, { timeout: 10000 }).toString().trim();
            const pageCount2 = Math.min(parseInt(identifyOut2) || 1, 5);
            for (let p = 0; p < pageCount2; p++) {
              const imgPath = `/tmp/invoice_classify_${Date.now()}_p${p}.png`;
              execSync(`convert -density 200 "${safeFilePath}"[${p}] -quality 95 "${imgPath}"`, { timeout: 30000 });
              imagePaths.push(imgPath);
            }
            log(`  → Refetch successful — PDF now has ${imagePaths.length} page(s)`);
          } catch (e2) {
            return { classification: 'error', file: path.basename(filePath), reason: `PDF conversion failed after refetch: ${e2.message}`, stage: 'pdf-conversion-refetch' };
          }
        } else {
          return { classification: 'error', file: path.basename(filePath), reason: `PDF structurally corrupt, refetch failed: ${e.message}`, stage: 'pdf-corruption' };
        }
      } else {
        return { classification: 'error', file: path.basename(filePath), reason: `PDF conversion failed: ${e.message}`, stage: 'pdf-conversion' };
      }
    }
  } else {
    imagePaths = [filePath];
  }
  const imagePath = imagePaths[0]; // backward compat for cleanup

  let supplementalText = '';
  let ocrApplied = false;
  if (fileType.isPdf) {
    const textResult = collectPdfText(filePath, imagePaths);
    supplementalText = textResult.text;
    ocrApplied = textResult.ocrApplied;
  } else if (fileType.isImage) {
    const textResult = collectImageText(filePath);
    supplementalText = textResult.text;
    ocrApplied = textResult.ocrApplied;
  }

  if (ocrApplied && supplementalText) {
    log(`  → OCR extracted ${supplementalText.length} chars`);
  }

  // Explicit inbound waiver-request identification takes priority over
  // filename/cache hints, while still retaining per-page classifier evidence.
  let forcedClassification = emailContext.forceClassification
    ? normalizeClassificationName(emailContext.forceClassification)
    : null;
  let forcedMethod = forcedClassification ? (emailContext.forcedMethod || 'inbound-waiver-request') : null;
  const basename = path.basename(filePath).toLowerCase();
  if (!forcedClassification && (basename.includes('w9') || basename.includes('w-9'))) {
    return { classification: 'w9', file: path.basename(filePath), method: 'filename' };
  }
  if (!forcedClassification && (basename.includes('coi') || basename.includes('certificate'))) {
    forcedClassification = 'coi';
    forcedMethod = 'filename';
  }
  if (!forcedClassification && basename.includes('permit') && !basename.includes('invoice')) {
    forcedClassification = 'building-permit';
    forcedMethod = 'filename';
  }
  // Statement detection — check filename, email subject, and email body
  const subjectLower = (emailContext.subject || '').toLowerCase();
  const bodyLower = (emailContext.body || '').toLowerCase();
  const statementSignals = [basename, subjectLower, bodyLower];
  const hasStatement = statementSignals.some(s => /\bstatement\b/i.test(s));
  const hasInvoice = statementSignals.some(s => /\binvoice\b/i.test(s));
  if (!forcedClassification && hasStatement && !hasInvoice) {
    forcedClassification = 'statement';
    forcedMethod = 'subject-filename';
  }

  // Check classification cache before calling Haiku
  const CLASS_CACHE_PATH = path.join(DATA_DIR, 'classification-cache.json');
  const classCache = loadJSON(CLASS_CACHE_PATH, { senders: {}, patterns: {} });
  const fileKeywords = path.basename(filePath).toLowerCase().replace(/\.[^.]+$/, '').replace(/[0-9a-f]{8}-[0-9a-f]{4}/g, '').replace(/[_\-]+/g, ' ').trim();
  // Check filename patterns
  if (!forcedClassification) {
    for (const [pattern, entry] of Object.entries(classCache.patterns || {})) {
      if (fileKeywords.includes(pattern) || pattern.includes(fileKeywords)) {
        if (fileKeywords.length > 3) {
          log(`  → Classification cache hit (pattern: "${pattern}")`);
          const cachedClassification = normalizeClassificationName(entry.classification);
          if (isExtractionEnabledForClassification(cachedClassification)) {
            forcedClassification = cachedClassification;
            forcedMethod = 'cache-pattern';
            break;
          }
          return { classification: cachedClassification, file: path.basename(filePath), method: 'cache-pattern', confidence: 0.95 };
        }
      }
    }
  }

  // Load active classification types for Haiku prompt (built-in + custom from DB)
  const { BUILT_IN_CLASSIFICATIONS } = require('../routes/settings');
  let classTypes = [...BUILT_IN_CLASSIFICATIONS];
  try {
    const customResult = await pool.query("SELECT name, label, action, opens_as, status FROM custom_classifications WHERE status = 'active' ORDER BY added_at");
    for (const r of customResult.rows) {
      classTypes.push({ name: r.name, label: r.label, action: r.action, opensAs: r.opens_as, status: r.status, builtIn: false });
    }
  } catch (e) {
    log(`WARNING: Could not load custom classifications from DB (${e.message}) — using built-in only`);
  }
  const classNames = classTypes.map(t => `"${t.name}"`).join(', ');

  // Haiku vision — per-page classification then type-specific extraction
  const CLASSIFICATION_PRIORITY = CLASSIFICATION_SELECTION_PRIORITY;

  // Hoisted so a details-read failure after the type is decided keeps the type.
  let pageClassifications = [];
  let totalTokensInput = 0, totalTokensOutput = 0;
  let classificationConfidence = forcedClassification ? 0.95 : null;
  let winningClassification = forcedClassification;
  const keepTypeWithoutDetails = (reason) => {
    log(`  ⚠ ${winningClassification} details unreadable (${reason}); keeping type, flagging for review`);
    return {
      classification: winningClassification,
      confidence: classificationConfidence || 0.9,
      file: path.basename(filePath),
      method: imagePaths.length > 1 ? 'haiku-per-page' : 'haiku-vision',
      extracted: null,
      pageClassifications,
      tokensUsed: { input: totalTokensInput, output: totalTokensOutput },
      notes: DETAILS_UNREADABLE_NOTE,
    };
  };
  let typeDecided = false;
  const keepR9ForcedWaiverTypeOnDetailFailure = forcedClassification === 'lien-waiver'
    && forcedMethod === 'waiver-request-ref';

  try {
    const imageInputs = imagePaths.map(p => ({
      data: fs.readFileSync(p).toString('base64'),
      mediaType: p === filePath ? fileType.mediaType : 'image/png',
    }));

    // ── Step 1: Classify each page individually ──
    const activeTypeNames = classTypes.map(t => t.name);

    const finalizeParsedExtraction = (parsed, {
      overrideClassification = null,
      method = imagePaths.length > 1 ? 'haiku-per-page' : 'haiku-vision',
      includePageClassifications = false,
    } = {}) => {
      if (parsed.classification) {
        parsed.classification = normalizeClassificationName(parsed.classification);
      }

      if (parsed.classification && !activeTypeNames.includes(parsed.classification)) {
        log(`  → Classifier returned unknown type "${parsed.classification}" → other`);
        parsed.classification = 'other';
      }

      if (overrideClassification) {
        parsed.classification = overrideClassification;
      }

      if (parsed.extracted) {
        parsed.extracted = normalizeExtractedFieldsForClassification(parsed.classification, parsed.extracted, {
          emailSubject: emailContext.subject,
          documentText: supplementalText,
          supplementalText,
        });
      }

      // Post-extraction: scan description for SVC job numbers Haiku may have missed.
      if (isInvoiceLikeClassification(parsed.classification) && parsed.extracted && !parsed.extracted.jobNumber?.match?.(/SVC/i)) {
        const descText = (parsed.extracted.description || '') + ' ' + ((parsed.extracted.lineItems || []).map(li => li.description || '').join(' '));
        const svcMatch = descText.match(/(\d{2}-SVC\d{3})/i);
        if (svcMatch) {
          parsed.extracted.jobNumber = svcMatch[1].toUpperCase();
          log(`  → Post-extraction: found SVC job number ${parsed.extracted.jobNumber} in description`);
        }
      }

      // Post-extraction: clean invoice number prefixes defensively.
      if (isInvoiceLikeClassification(parsed.classification) && parsed.extracted) {
        const cleaned = cleanInvoiceNumber(parsed.extracted.invoiceNumber);
        if (cleaned !== parsed.extracted.invoiceNumber) {
          log(`  → Cleaned invoice number: ${JSON.stringify(parsed.extracted.invoiceNumber)} → ${JSON.stringify(cleaned)}`);
          parsed.extracted.invoiceNumber = cleaned;
        }
        if (Array.isArray(parsed.extracted.lineItems)) {
          for (const li of parsed.extracted.lineItems) {
            if (li.invoiceNumber) {
              const liCleaned = cleanInvoiceNumber(li.invoiceNumber);
              if (liCleaned !== li.invoiceNumber) {
                log(`  → Cleaned line-item invoice number: ${JSON.stringify(li.invoiceNumber)} → ${JSON.stringify(liCleaned)}`);
                li.invoiceNumber = liCleaned;
              }
            }
          }
        }
      }

      parsed.file = path.basename(filePath);
      if (ocrApplied) parsed.ocrApplied = true;
      parsed.method = method;
      if (includePageClassifications && pageClassifications.length > 1) {
        parsed.pageClassifications = pageClassifications;
      }
      parsed.tokensUsed = { input: totalTokensInput, output: totalTokensOutput };
      return parsed;
    };

    const classifyPrompt = `Classify this SINGLE PAGE as exactly one of: ${classNames}
Return ONLY valid JSON: {"classification": "type", "confidence": 0.95}
Be precise. A billing recap or payment summary IS an invoice.
A lien waiver is a legal release page — look for titles like "Waiver and Release of Lien", "Conditional/Unconditional Waiver and Release Upon Progress/Final Payment", or "Payment Bond Rights"; often signed and notarized. A page that is such a release form is "lien-waiver" even when it references invoice numbers or amounts.`;

    // ── Step 2: Determine winning classification via priority ──
    let invoicePages = [];

    if (!forcedClassification && shouldUseCombinedSinglePageInvoiceExtraction(imagePaths.length, forcedClassification)) {
      const extractPrompt = buildInvoiceExtractionPrompt('invoice', classNames);
      const fullExtractPrompt = supplementalText
        ? `${extractPrompt}\n\nOCR/Text layer content (may contain errors):\n${supplementalText.slice(0, 3000)}`
        : extractPrompt;

      let result;
      try {
        result = await callHaiku(imageInputs, fullExtractPrompt, 2000);
      } catch (e) {
        return { classification: 'error', file: path.basename(filePath), reason: `Haiku API: ${e.message}`, stage: 'haiku-api' };
      }
      totalTokensInput += result.usage.input_tokens;
      totalTokensOutput += result.usage.output_tokens;
      const text = result.text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        return { classification: 'error', file: path.basename(filePath), reason: 'Could not parse Haiku response', stage: 'haiku-parse' };
      }

      const parsed = finalizeParsedExtraction(JSON.parse(jsonMatch[0]), { method: 'haiku-vision' });
      pageClassifications = [parsed.classification || 'other'];
      classificationConfidence = parsed.confidence || 0.95;

      if (isInvoiceLikeClassification(parsed.classification)) {
        return parsed;
      }
      if (!isExtractionEnabledForClassification(parsed.classification)) {
        return parsed;
      }

      winningClassification = parsed.classification;
      log(`    → Combined single-page extraction classified as ${winningClassification}; running type-specific extraction`);
    } else {
      // Multi-page — classify each page separately
      for (let p = 0; p < imageInputs.length; p++) {
        try {
          const result = await callHaiku([imageInputs[p]], classifyPrompt, 200);
          totalTokensInput += result.usage.input_tokens;
          totalTokensOutput += result.usage.output_tokens;
          const text = result.text;
          const jsonMatch = text.match(/\{[\s\S]*?\}/);
          if (jsonMatch) {
            const pc = JSON.parse(jsonMatch[0]);
            let normalizedClass = normalizeClassificationName(pc.classification || 'other');
            if (!activeTypeNames.includes(normalizedClass)) {
              log(`    Page ${p + 1}: classifier returned unknown type "${normalizedClass}" → other`);
              normalizedClass = 'other';
            }
            pageClassifications.push(normalizedClass);
            log(`    Page ${p + 1}/${imageInputs.length}: ${normalizedClass} (${pc.confidence})`);
          } else {
            pageClassifications.push('other');
            log(`    Page ${p + 1}/${imageInputs.length}: unparseable → other`);
          }
        } catch (e) {
          pageClassifications.push('other');
          log(`    Page ${p + 1}/${imageInputs.length}: error → other (${e.message})`);
        }
      }

      // Deterministic waiver keyword pre-pass: override Haiku on pages whose
      // text matches the waiver regex (unless page 1 is ambiguous).
      if (fileType.isPdf && pageClassifications.length > 0) {
        const perPageTexts = getPerPageTexts(filePath, pageClassifications.length, ocrApplied);
        const reclassified = applyWaiverPrePass(pageClassifications, perPageTexts);
        if (reclassified > 0) {
          log(`    → Waiver pre-pass: ${reclassified} page(s) reclassified to lien-waiver`);
        }
      }

      // A forced document type controls extraction, but real per-page results
      // stay available for bundle detection and review.
      if (!forcedClassification) {
        // Pick highest priority classification found on any page
        for (const priority of CLASSIFICATION_PRIORITY) {
          const idx = pageClassifications.indexOf(priority);
          if (idx !== -1) {
            winningClassification = priority;
            // Collect all pages with this classification (for multi-invoice PDFs)
            invoicePages = pageClassifications.map((c, i) => c === priority ? i : -1).filter(i => i >= 0);
            break;
          }
        }
        // If no priority type found, use the most common classification
        if (!winningClassification) {
          const counts = {};
          pageClassifications.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
          winningClassification = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        }
      }

      log(`    → Document classification: ${winningClassification} (from ${pageClassifications.length} pages: ${pageClassifications.join(', ')})`);
    }

    // If not an extractable type, return early
    if (!isExtractionEnabledForClassification(winningClassification)) {
      return {
        classification: winningClassification,
        confidence: classificationConfidence || 0.9,
        file: path.basename(filePath),
        method: imagePaths.length > 1 ? 'haiku-per-page' : 'haiku-vision',
        extracted: null,
        pageClassifications,
        tokensUsed: { input: totalTokensInput, output: totalTokensOutput },
      };
    }

    // ── Step 3: Extract data with the prompt for the chosen classification ──
    const extractPrompt = buildExtractionPromptForClassification(winningClassification || 'invoice');

    // Append OCR/text layer content if available
    const fullExtractPrompt = supplementalText
      ? `${extractPrompt}\n\nOCR/Text layer content (may contain errors):\n${supplementalText.slice(0, 3000)}`
      : extractPrompt;

    const pageExtractionInstruction = isInvoiceLikeClassification(winningClassification)
      ? 'Extract data from the invoice/billing pages.'
      : `Extract data from the ${winningClassification} pages.`;
    const extractionPrompt = imagePaths.length > 1
      ? `This document has ${imagePaths.length} pages. ${pageExtractionInstruction}\n\n${fullExtractPrompt}`
      : fullExtractPrompt;

    let result;
    try {
      result = await callHaiku(imageInputs, extractionPrompt, 2000);
    } catch (e) {
      if (keepR9ForcedWaiverTypeOnDetailFailure) return keepTypeWithoutDetails(e.message);
      return { classification: 'error', file: path.basename(filePath), reason: `Haiku API: ${e.message}`, stage: 'haiku-api' };
    }
    // The type is decided after extraction returns; later parsing failures keep it.
    // The greedy match below fails on multi-record replies (e.g. an array
    // of waivers), which is intended: never silently keep record #1.
    typeDecided = true;
    totalTokensInput += result.usage.input_tokens;
    totalTokensOutput += result.usage.output_tokens;
    const text = result.text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      return keepTypeWithoutDetails('Could not parse Haiku response');
    }

    const parsed = finalizeParsedExtraction(JSON.parse(jsonMatch[0]), {
      overrideClassification: winningClassification,
      includePageClassifications: true,
    });

    // Statement safety net: if extraction returned zero lines despite having
    // page images, retry with an explicit vision-focused prompt. This catches
    // image-based PDFs where pdftotext/Tesseract return nothing and the first
    // Haiku call produces an empty lines array.
    if (parsed.classification === 'statement'
        && (!parsed.extracted?.statementLines?.length)
        && imageInputs.length > 0) {
      log('  ⚠ Statement extracted with zero lines — retrying with vision-focused prompt');
      try {
        const retryPrompt = buildStatementExtractionPrompt()
          + '\n\nIMPORTANT: This is an image-based document. Look at the page image carefully and extract ALL invoice/reference lines visible in the table. Do NOT return an empty lines array if you can see line items.';
        const retryResult = await callHaiku(imageInputs, retryPrompt, 2000);
        totalTokensInput += retryResult.usage.input_tokens;
        totalTokensOutput += retryResult.usage.output_tokens;
        const retryJson = retryResult.text.match(/\{[\s\S]*\}/);
        if (retryJson) {
          const retryParsed = JSON.parse(retryJson[0]);
          const retryNormalized = normalizeStatementExtraction(retryParsed.extracted || retryParsed);
          if (retryNormalized.statementLines?.length > 0) {
            parsed.extracted.statementLines = retryNormalized.statementLines;
            if (retryNormalized.statementPeriod && !parsed.extracted.statementPeriod) {
              parsed.extracted.statementPeriod = retryNormalized.statementPeriod;
            }
            if (retryNormalized.balance != null && parsed.extracted.balance == null) {
              parsed.extracted.balance = retryNormalized.balance;
            }
            log(`  → Statement retry: recovered ${retryNormalized.statementLines.length} line(s)`);
          }
        }
      } catch (retryErr) {
        log(`  → Statement retry failed (non-fatal): ${retryErr.message}`);
      }
      parsed.tokensUsed = { input: totalTokensInput, output: totalTokensOutput };
    }

    return parsed;
  } catch (e) {
    if (typeDecided) return keepTypeWithoutDetails(e.message);
    return { classification: 'error', file: path.basename(filePath), reason: e.message, stage: 'classification' };
  } finally {
    // Cleanup temp image if we created one
    if (ext === '.pdf' && imagePath) {
      imagePaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
    }
  }
}

// --- Step 6: Match vendor + subcontract ---
async function matchInvoiceData(extracted, senderEmail, emailSubject, emailJobData = {}) {
  const { matchInvoice: fullMatch } = require('./matcher');
  
  const invoiceData = {
    vendorName: extracted.vendorName,
    vendorAddress: extracted.vendorAddress,
    senderEmail: senderEmail,
    invoiceNumber: extracted.invoiceNumber,
    amount: extracted.amount || extracted.total,
    jobNumber: extracted.jobNumber || extracted.jobRef,
    projectName: extracted.projectName,
    projectAddress: extracted.projectAddress || extracted.siteAddress,
    description: extracted.description,
    emailSubject: emailSubject,
    dueDate: extracted.dueDate,
    lineItems: extracted.lineItems,
  };

  // Full invoice-level match
  const result = await fullMatch(invoiceData);

  return result;
}

function normalizeMatchConfidence(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0;
}

function normalizeVendorMatchResult(result = {}) {
  const confidence = normalizeMatchConfidence(result.confidence);
  if (result.vendorCode && confidence >= AUTO_MATCH_CONFIDENCE) {
    return {
      vendorCode: result.vendorCode,
      vendorName: result.vendorName || null,
      confidence,
      method: result.method || 'matched',
    };
  }

  const suggestionScore = normalizeMatchConfidence(result.suggestion?.score);
  if (
    result.suggestion &&
    suggestionScore >= SUGGESTION_MATCH_CONFIDENCE &&
    suggestionScore < AUTO_MATCH_CONFIDENCE
  ) {
    return {
      vendorCode: null,
      vendorName: result.suggestion.vendorName || null,
      confidence: suggestionScore,
      method: result.method || 'suggestion',
      suggestion: {
        vendorCode: result.suggestion.vendorCode || null,
        vendorName: result.suggestion.vendorName || null,
        score: suggestionScore,
      },
    };
  }

  if (confidence >= SUGGESTION_MATCH_CONFIDENCE && confidence < AUTO_MATCH_CONFIDENCE) {
    return {
      vendorCode: null,
      vendorName: result.vendorName || null,
      confidence,
      method: /suggestion/i.test(result.method || '') ? result.method : `${result.method || 'vendor-match'}-suggestion`,
      suggestion: result.vendorCode || result.vendorName ? {
        vendorCode: result.vendorCode || null,
        vendorName: result.vendorName || null,
        score: confidence,
      } : null,
    };
  }

  return {
    vendorCode: null,
    vendorName: null,
    confidence: 0,
    method: result.method || 'no-match',
  };
}

function normalizeJobMatchResult(result = {}) {
  const confidence = normalizeMatchConfidence(result.confidence);
  if (result.jobNumber && confidence >= AUTO_MATCH_CONFIDENCE) {
    const normalized = {
      jobNumber: result.jobNumber,
      confidence,
      method: result.method || 'matched',
    };
    if (result.subcontractNumber) normalized.subcontractNumber = result.subcontractNumber;
    if (result.jobDescription) normalized.jobDescription = result.jobDescription;
    if (result.matchedAddress) normalized.matchedAddress = result.matchedAddress;
    return normalized;
  }

  if (confidence >= SUGGESTION_MATCH_CONFIDENCE && confidence < AUTO_MATCH_CONFIDENCE) {
    return {
      jobNumber: null,
      confidence,
      method: /suggestion/i.test(result.method || '') ? result.method : `${result.method || 'job-match'}-suggestion`,
      suggestion: result.jobNumber ? {
        jobNumber: result.jobNumber,
        score: confidence,
        jobDescription: result.jobDescription || null,
      } : null,
    };
  }

  return {
    jobNumber: null,
    confidence: 0,
    method: result.method || 'no-job',
  };
}

function buildPerTypeMatchingResult(parts = {}) {
  const vendor = parts.vendor || null;
  const job = parts.job || null;
  const confidenceLegs = [vendor?.confidence, job?.confidence]
    .map(normalizeMatchConfidence)
    .filter((confidence) => confidence > 0);

  return {
    vendor,
    job,
    subcontract: null,
    statementLines: parts.statementLines || null,
    overallConfidence: confidenceLegs.length ? Math.min(...confidenceLegs) : 0,
  };
}

async function matchPerTypeDocumentData(classification, extracted, context = {}, matcherOverrides = {}) {
  if (!extracted) return null;
  const normalizedClassification = normalizeClassificationName(classification);
  const matcher = {
    ...require('./matcher'),
    ...matcherOverrides,
  };

  if (normalizedClassification === 'building-permit' || normalizedClassification === 'other') {
    const jobResult = await matcher.resolveJobNumber({
      projectAddress: extracted.projectAddress,
      projectName: extracted.projectName,
      emailSubject: context.emailSubject || null,
      description: extracted.projectName || null,
    }, context.vendorCode || null);
    return buildPerTypeMatchingResult({ job: normalizeJobMatchResult(jobResult) });
  }

  if (normalizedClassification === 'receipt') {
    const jobResult = await matcher.resolveJobNumber({
      jobNumber: extracted.jobRef || extracted.jobNumber,
      projectAddress: extracted.projectAddress,
      projectName: extracted.projectName,
      emailSubject: context.emailSubject || null,
      description: extracted.description || null,
    }, context.vendorCode || null);
    return buildPerTypeMatchingResult({ job: normalizeJobMatchResult(jobResult) });
  }

  if (normalizedClassification === 'coi') {
    const vendorResult = await matcher.matchVendor({
      name: extracted.insuredName,
      email: null,
      address: null,
    });
    return buildPerTypeMatchingResult({ vendor: normalizeVendorMatchResult(vendorResult) });
  }

  if (normalizedClassification === 'statement') {
    const vendorResult = await matcher.matchVendor({
      name: extracted.vendor,
      email: null,
      address: null,
    });
    const vendor = normalizeVendorMatchResult(vendorResult);
    let statementLineLookups = context.statementLineLookups;
    if (!statementLineLookups) {
      // Default to the real Toolbox + Spectrum lookups so extracted lines land
      // in the queue already stamped matched / in_toolbox_not_spectrum / etc.
      const { buildStatementLineLookups } = require('./statementLineService');
      statementLineLookups = buildStatementLineLookups(context.documentId || '');
    }
    const statementLines = extracted.statementLines?.length
      ? await matchStatementLines(
        extracted.statementLines,
        vendor.vendorCode,
        statementLineLookups
      )
      : null;
    return buildPerTypeMatchingResult({ vendor, statementLines });
  }

  if (normalizedClassification === 'lien-waiver') {
    const vendorResult = await matcher.matchVendor({
      name: extracted.vendorName,
      email: null,
      address: null,
    });
    const vendor = normalizeVendorMatchResult(vendorResult);
    const jobResult = await matcher.resolveJobNumber({
      jobNumber: extracted.jobNumber || extracted.jobRef,
      projectAddress: null,
      projectName: null,
      emailSubject: context.emailSubject || null,
      description: null,
    }, vendor.vendorCode || null);
    return buildPerTypeMatchingResult({ vendor, job: normalizeJobMatchResult(jobResult) });
  }

  return null;
}

// --- Email body parser: extract job/project numbers from email body/subject ---
function parseEmailBodyForJobData(emailBody, emailSubject) {
  if (!emailBody && !emailSubject) return {};
  const text = (emailBody || '') + ' ' + (emailSubject || '');

  const result = {};

  // Job number patterns: "26-405", "25-SVC403", "project (26-405)", "job 26-405", "job number: 26-405"
  const jobPatterns = [
    /(?:job|project|job\s*(?:number|no|#))\s*[:=]?\s*(\d{2}-(?:SVC)?\d{3})/gi,
    /\((\d{2}-(?:SVC)?\d{3})\)/g,
    /(?:^|\s)(\d{2}-SVC\d{3})(?:\s|$|[,.\)])/gm,
    /(?:^|\s)(\d{2}-\d{3})(?:\s|$|[,.\)])/gm,
  ];
  for (const pattern of jobPatterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      result.jobNumber = matches[0][1];
      break;
    }
  }

  // Subcontract patterns: "25-549.04", "PO 25-549.04"
  const scPattern = /(\d{2}-\d{3}\.\d{2})/g;
  const scMatches = [...text.matchAll(scPattern)];
  if (scMatches.length > 0) {
    result.subcontractNumber = scMatches[0][1];
    // Infer job number from the subcontract if not already found — via
    // Spectrum's sub→job link (prefix ≠ job in real cases), prefix fallback.
    if (!result.jobNumber) {
      const { findSubcontractJob } = require('./matcher');
      result.jobNumber = findSubcontractJob(result.subcontractNumber)
        || result.subcontractNumber.split('.')[0];
    }
  }

  // Project name patterns: "attached to the X project", "for the X project"
  const projPatterns = [
    /(?:attached\s+to|for)\s+(?:the\s+)?(.+?)\s+project/gi,
    /project\s*[:=]\s*(.+?)(?:\s*[\(\n,]|$)/gi,
  ];
  for (const pattern of projPatterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      result.projectName = matches[0][1].trim();
      break;
    }
  }

  return result;
}

// --- Step 6b: Detect multi-invoice PDFs (NEW — human-in-the-loop) ---
//
// Instead of trying to auto-split multi-invoice PDFs (which silently lost data
// when Haiku miscounted), we now detect ambiguity and defer to human review.
//
// Haiku's role is reduced to pure per-page extraction: "what invoice number
// is visible on this page?" We then apply deterministic rules to decide:
//
//   - All pages share the same invoice number → single multi-page invoice, auto-process
//   - Different invoice numbers on different pages → flag as needs-split
//   - No invoice numbers at all → flag as needs-split (orphan bundle)
//   - Any parsing error → flag as needs-split (safe default)
//
// Returns:
//   { needsSplit: false }                               — proceed to single-doc processing
//   { needsSplit: true, suggestion: {...} }             — save suggestion as needs-split doc
//
// See docs/specs/2026-04-08-multi-page-split-review.md
// Strip common label prefixes and internal whitespace from an invoice number.
// Haiku sometimes returns "Invoice 25-6059-04R" or "Invoice: #305" when it
// should return just the alphanumeric identifier. Vendors also sometimes
// format invoice numbers with internal spaces (e.g., "25 1254" really means
// invoice 251254). This is a defensive post-process so stored values are
// always clean regardless of Haiku drift or vendor formatting.
//
// Rules:
// - Strip label words (Invoice, Inv, No, Number, Ref, Reference) ONLY when
//   followed by whitespace, punctuation, or end-of-string — NOT when they're
//   part of a compound identifier like "INV-2024-0042" (dash-joined).
// - Strip leading '#', ':', '.', and whitespace after label removal.
// - Collapse ALL remaining whitespace (internal and trailing) so vendors who
//   format numbers as "25 1254" get stored as "251254".
function cleanInvoiceNumber(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'none') return null;

  // Match label words ONLY when followed by whitespace, colon, hash, period,
  // or end of string — NOT when followed by a hyphen (which indicates a
  // compound identifier like "INV-2024-0042").
  const labelPattern = /^(?:invoice|inv|no|number|ref|reference)(?=[\s:#.]|$)[\s:#.]*/i;
  let prev;
  do {
    prev = s;
    s = s.replace(labelPattern, '').trim();
    // Strip any leading junk punctuation after label removal
    s = s.replace(/^[#\s:.]+/, '').trim();
  } while (s !== prev && s.length > 0);

  // Strip ALL internal whitespace. Invoice numbers are single tokens —
  // spaces are always cosmetic formatting.
  s = s.replace(/\s+/g, '');

  return s || null;
}

// B4 (2026-07-24): pay-app invoice-number convention. Vendors number pay
// applications per project ("1", "2", "3"...), so the same vendor legitimately
// produces the same invoice number on different jobs — which collides in
// Spectrum (real case: HALD01 "3" on Ledgerline vs Brightwater). Rename at intake to
// `{SUB} PA {n}` (fallback `{JOB} PA {n}` when no subcontract matched).
// Trigger: pay-application classification, OR a bare 1–3 digit invoice number
// on a subcontract-matched invoice. The original number is preserved in notes.
// If a known pay app has no extracted number, use APP as a stable placeholder
// suffix so the queue is not permanently blocked on a blank invoice number.
// Spectrum Invoice_Number is char(20) — both formats always fit.
const BARE_PAY_APP_NUMBER = /^\d{1,3}$/;
// AIA form codes that vendors sometimes submit as the "invoice number"
const AIA_FORM_CODES = new Set(['g702', 'g703']);
const SPECTRUM_INVOICE_NUMBER_MAX = 20;

/**
 * Next-available PA number for a given prefix+vendor. Queries existing
 * invoice_number values matching `{prefix} PA {n}` and returns max(n)+1.
 * Falls back to 1 on DB error so the pipeline never blocks.
 */
async function nextPayAppNumber(vendorCode, prefix, db = pool) {
  try {
    const pattern = `${prefix} PA %`;
    const { rows } = await db.query(
      `SELECT invoice_number FROM documents
       WHERE vendor_code = $1 AND invoice_number LIKE $2`,
      [vendorCode, pattern]
    );
    let max = 0;
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} PA (\\d+)$`);
    for (const r of rows) {
      const m = (r.invoice_number || '').match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
  } catch {
    return 1;
  }
}

async function applyPayAppNumbering(entry, log = () => {}, db = pool) {
  const extracted = entry.extracted;
  if (!extracted) return false;
  let raw = String(extracted.invoiceNumber || '').trim();
  const isAiaForm = AIA_FORM_CODES.has(raw.toLowerCase());
  if (isAiaForm) raw = ''; // treat AIA form codes as missing
  if (raw && !BARE_PAY_APP_NUMBER.test(raw)) return false;
  if (!raw && entry.classification !== 'pay-application') return false;

  const sub = entry.matching?.subcontract?.subcontractNumber || null;
  const job = entry.matching?.job?.jobNumber || null;
  const vendorCode = entry.matching?.vendor?.vendorCode || null;
  if (entry.classification !== 'pay-application' && !sub) return false;

  // Prefix priority: subcontract > job > vendor code (always have something)
  const suffix = raw || null;
  const prefix = [sub, job, vendorCode].find(
    (p) => p && `${p} PA ${suffix || '1'}`.length <= SPECTRUM_INVOICE_NUMBER_MAX
  );
  if (!prefix) return false;

  // When the vendor sent a bare number (1, 2, 3), use it as-is.
  // When no number was extracted, auto-increment from existing PA numbers.
  const finalSuffix = suffix || String(await nextPayAppNumber(vendorCode, prefix, db));

  const renamed = `${prefix} PA ${finalSuffix}`;
  extracted.invoiceNumber = renamed;
  const note = raw
    ? `Original invoice number "${raw}" renamed to "${renamed}" (pay-app numbering convention)`
    : `Missing pay-app invoice number defaulted to "${renamed}" (pay-app numbering convention)`;
  entry.notes = entry.notes ? `${entry.notes}; ${note}` : note;
  log(`  → Pay-app numbering: "${raw || '(missing)'}" → "${renamed}"`);
  return true;
}

async function detectSplitCandidacy(imageInputs) {
  const pageCount = imageInputs.length;
  if (pageCount <= 1) return { needsSplit: false };

  const prompt =
    `This PDF has ${pageCount} pages. For EACH page individually, extract:\n` +
    `  1. The invoice number visible on the page (null if none)\n` +
    `  2. The document type: one of "invoice", "lien-waiver", "coi", "statement", "other"\n\n` +
    `Return ONLY valid JSON in this exact shape:\n` +
    `{"pages": [{"page": 1, "invoiceNumber": "..." | null, "docType": "invoice"}, ...]}\n\n` +
    `Be precise. A billing recap or payment summary IS an invoice. ` +
    `A "Sub App for Payment" / G702 IS an invoice. ` +
    `Do not merge pages. Do not group. One entry per page.\n\n` +
    `CRITICAL — invoiceNumber format:\n` +
    `- Return ONLY the alphanumeric identifier itself. NO prefixes, labels, or punctuation decoration.\n` +
    `- If the page shows "Invoice: 25-6059-04R" → return "25-6059-04R" (NOT "Invoice 25-6059-04R" or "Invoice: 25-6059-04R" or "#25-6059-04R").\n` +
    `- If the page shows "Invoice #305" → return "305" (NOT "#305" or "Invoice #305").\n` +
    `- If the page shows "INV-2024-0042" → return "INV-2024-0042" (this IS the identifier, leave as-is).\n` +
    `- If the page shows "25 1254" (with internal space) → return "251254" (strip spaces — they're cosmetic formatting).\n` +
    `- Keep hyphens, letters, and digits that are part of the identifier itself.\n` +
    `- Strip any leading label words like "Invoice", "Inv", "No", "Number", "#" and any surrounding whitespace or colons.\n` +
    `- Strip ALL internal whitespace from the final value.`;

  const { parseHaikuJson } = require('./vision');
  let perPage;
  try {
    const result = await callHaiku(imageInputs, prompt, 1000);
    const parsed = parseHaikuJson(result.text || '');
    if (!parsed) {
      log('  detectSplitCandidacy: Could not parse Haiku response — flagging as needs-split');
      return buildNeedsSplit(pageCount, [], { reason: 'haiku-parse-error' });
    }
    perPage = Array.isArray(parsed.pages) ? parsed.pages : [];
    if (perPage.length === 0) {
      log('  detectSplitCandidacy: Empty pages array — flagging as needs-split');
      return buildNeedsSplit(pageCount, [], { reason: 'empty-haiku-response' });
    }
  } catch (e) {
    log(`  detectSplitCandidacy error: ${e.message} — flagging as needs-split`);
    return buildNeedsSplit(pageCount, [], { reason: 'haiku-error', error: e.message });
  }

  // Normalize: ensure every page 1..N has an entry + clean invoice numbers
  const byPage = new Map();
  for (const p of perPage) {
    if (Number.isInteger(p.page) && p.page >= 1 && p.page <= pageCount) {
      byPage.set(p.page, {
        page: p.page,
        invoiceNumber: cleanInvoiceNumber(p.invoiceNumber || p.invoice_number),
        docType: p.docType || p.doc_type || 'other',
      });
    }
  }
  const normalized = [];
  for (let i = 1; i <= pageCount; i++) {
    normalized.push(
      byPage.get(i) || { page: i, invoiceNumber: null, docType: 'other' }
    );
  }

  // Decision logic

  // Pre-check: Is this PDF even an invoice bundle, or is it a different
  // doc type (COI, W-9, statement, lien waiver)?
  //
  // If the dominant doc type across all pages is NOT 'invoice', skip split
  // detection entirely. Multi-page COIs are common (page 1 = cover, page 2 =
  // endorsements, page 3 = additional insured, etc.) and should flow through
  // the normal classifier as a single document.
  //
  // Rule: if >= half the pages are classified as the same non-invoice type,
  // treat the whole PDF as that type and auto-process it as a single doc.
  const docTypeCounts = {};
  for (const p of normalized) {
    const t = p.docType || 'other';
    docTypeCounts[t] = (docTypeCounts[t] || 0) + 1;
  }
  const invoicePageCount = docTypeCounts['invoice'] || 0;
  const nonInvoiceTypes = ['coi', 'w9', 'statement', 'lien-waiver'];
  for (const nonInvType of nonInvoiceTypes) {
    const cnt = docTypeCounts[nonInvType] || 0;
    // If this non-invoice type dominates (majority of pages AND more than invoice pages)
    if (cnt >= Math.ceil(pageCount / 2) && cnt > invoicePageCount) {
      log(
        `  → Multi-page PDF (${pageCount} pages) is dominated by '${nonInvType}' (${cnt}/${pageCount} pages) — auto-processing as single ${nonInvType} doc`
      );
      return { needsSplit: false };
    }
  }

  const invoiceNumbers = normalized
    .filter((p) => p.invoiceNumber)
    .map((p) => p.invoiceNumber);
  const distinctInvoiceNumbers = [...new Set(invoiceNumbers)];

  // Case 1: No invoice numbers at all → only flag if at least one page is
  // classified as an invoice (otherwise it's probably a mystery doc type and
  // the normal classifier should handle it as a single doc)
  if (distinctInvoiceNumbers.length === 0) {
    if (invoicePageCount >= 1) {
      log(`  → Multi-page PDF (${pageCount} pages) with no invoice numbers but ${invoicePageCount} invoice pages — flagging as needs-split`);
      return buildNeedsSplit(pageCount, normalized, { reason: 'no-invoice-numbers' });
    }
    log(`  → Multi-page PDF (${pageCount} pages) with no invoice numbers and no invoice pages — auto-processing as single doc`);
    return { needsSplit: false };
  }

  // Case 2: Exactly one distinct invoice number across all pages that have one
  //         → treat as single multi-page invoice (auto-process)
  if (distinctInvoiceNumbers.length === 1) {
    log(
      `  → Multi-page PDF (${pageCount} pages) with single invoice ${distinctInvoiceNumbers[0]} — auto-processing as single doc`
    );
    return { needsSplit: false };
  }

  // Case 3: Multiple distinct invoice numbers → needs-split
  log(
    `  → Multi-page PDF (${pageCount} pages) with ${distinctInvoiceNumbers.length} distinct invoices — flagging as needs-split`
  );
  return buildNeedsSplit(pageCount, normalized, {
    reason: 'multiple-invoices',
    distinctInvoiceNumbers,
  });
}

// Build the split_suggestion JSONB payload
function buildNeedsSplit(pageCount, perPage, meta = {}) {
  // Build suggested groups: one group per distinct invoice number, plus
  // orphan groups for pages with no invoice number.
  const groupsByInvoice = new Map();
  const orphanPages = [];

  for (const p of perPage) {
    if (p.invoiceNumber) {
      if (!groupsByInvoice.has(p.invoiceNumber)) {
        groupsByInvoice.set(p.invoiceNumber, {
          pages: [],
          invoiceNumber: p.invoiceNumber,
          docType: p.docType === 'invoice' ? 'invoice' : p.docType,
        });
      }
      groupsByInvoice.get(p.invoiceNumber).pages.push(p.page);
    } else {
      orphanPages.push(p);
    }
  }

  const suggestedGroups = [...groupsByInvoice.values()];

  // Orphan pages: add each as its own group (user will decide to group/discard)
  for (const orphan of orphanPages) {
    suggestedGroups.push({
      pages: [orphan.page],
      invoiceNumber: null,
      docType: orphan.docType || 'other',
    });
  }

  return {
    needsSplit: true,
    suggestion: {
      pageCount,
      generatedAt: new Date().toISOString(),
      pages: perPage,
      suggestedGroups,
      meta,
    },
  };
}

// --- Step 7: Handle ZIP files ---
function extractZip(zipPath, destDir) {
  try {
    execSync(`unzip -o -j "${sanitizePathForShell(zipPath)}" -d "${sanitizePathForShell(destDir)}" 2>/dev/null`, { timeout: 30000 });
    const files = fs.readdirSync(destDir)
      .filter(f => !f.startsWith('.'))
      .map(f => path.join(destDir, f));
    log(`  Extracted ${files.length} file(s) from ZIP`);
    return files;
  } catch (e) {
    log(`  ZIP extraction failed: ${e.message}`);
    return [];
  }
}

// --- Main Pipeline ---
async function runPipeline(opts = {}) {
  const isDry = opts.dry || false;
  // Injectable only for deterministic, boundary-free behavioral tests. Normal
  // production callers use the established implementation dependencies.
  const dependencies = opts.dependencies || {};
  const listEmails = dependencies.fetchEmailList || fetchEmailList;
  const downloadEmailAttachments = dependencies.downloadAttachments || downloadAttachments;
  const countQueuedDocuments = dependencies.getQueueCount || getQueueCount;
  const classifyDocument = dependencies.classifyAndExtract || classifyAndExtract;
  const matchInvoice = dependencies.matchInvoiceData || matchInvoiceData;
  const linkCommittedWaiver = dependencies.autoLinkWaiver || null;
  const inspectInbound = dependencies.divertInboundEmail || ((args) => defaultDivertInboundEmail({
    ...args, config: DOCUMENT_EMAIL, insertAuditEvent,
  }));
  // Tests can disable the run-level rules/archive/notification fan-out while
  // still exercising the complete per-email ingestion trajectory.
  const shouldRunPostProcessing = opts.postProcess !== false;
  const startTime = Date.now();
  // The /api/pipeline/run route mints a unique run id and passes it via env so
  // it can correlate the status-file result with the child it spawned (stale
  // result provenance fix). Cron/CLI runs self-mint from the start time.
  const runId = process.env.PIPELINE_RUN_ID || `run-${startTime}`;
  
  log(`=== Invoice Pipeline ${isDry ? 'DRY RUN' : 'RUN'} (${runId}) ===`);

  // Retention: prune skip-log audit rows older than 90 days (best-effort).
  if (!isDry) await junkFilter.purgeOldSkips();

  // Self-heal ambiguous outbound sends (forwards/replies whose post-send
  // confirmation timed out). The sweep re-checks Graph and flips them to
  // confirmed/failed so they surface in document activity. Best-effort:
  // a Graph or DB hiccup here must never block inbound ingestion.
  if (!isDry) {
    try {
      const emailService = require('./email');
      const sweep = await emailService.reconcileEmailSweep();
      if (sweep.scanned > 0) log(`Outbound email sweep: ${sweep.scanned} ambiguous, ${sweep.confirmed} confirmed, ${sweep.failed} failed, ${sweep.ambiguous} still ambiguous`);
    } catch (e) {
      log(`WARNING: Outbound email reconciliation sweep failed (${e.message})`);
    }
  }

  // Load processed email IDs from Supabase
  // We track both the Graph API id (folder-scoped, changes on folder move) and
  // the RFC 2822 internetMessageId (immutable, set by originating server).
  let processedIds = [];
  let processedInternetIds = new Set();
  try {
    const { rows } = await pool.query('SELECT email_id, internet_message_id FROM processed_emails');
    processedIds = rows.map(r => r.email_id);
    for (const r of rows) {
      if (r.internet_message_id) processedInternetIds.add(r.internet_message_id);
    }
    log(`Loaded ${processedIds.length} processed email IDs from Supabase (${processedInternetIds.size} with internetMessageId)`);
  } catch (e) {
    log(`WARNING: Could not load processed IDs from Supabase (${e.message}) — falling back to JSON`);
    processedIds = loadJSON(PROCESSED_IDS_PATH, []);
  }
  
  // Fetch emails
  const emails = await listEmails();
  
  if (!Array.isArray(emails) || emails.length === 0) {
    log('No new emails to process.');
    log('=== Pipeline complete ===');
    const result = { runId, processed: 0, queued: 0, errors: 0 };
    try {
      // Must match the route's PIPELINE_STATUS_PATH (config) — a local
      // DATA_DIR path here silently diverges from what GET /status reads.
      fs.writeFileSync(PIPELINE_STATUS_PATH, JSON.stringify({ lastRun: new Date().toISOString(), lastResult: { ...result, durationMs: Date.now() - startTime, isDry } }, null, 2));
    } catch (_) {}
    return result;
  }

  let totalProcessed = 0, totalQueued = 0, totalErrors = 0, totalThreadSkipped = 0, totalInlineRescued = 0;
  const runResults = [];

  for (const email of emails) {
    const msgId = email.id;
    
    // Skip already processed (by Graph API id)
    if (processedIds.includes(msgId)) {
      log(`Skipping already-processed email: ${email.subject}`);
      continue;
    }

    // Skip already processed (by internetMessageId — survives folder moves)
    const inetMsgId = email.internetMessageId || null;
    if (inetMsgId && processedInternetIds.has(inetMsgId)) {
      log(`Skipping already-processed email (internetMessageId match after folder move): ${email.subject}`);
      processedIds.push(msgId); // cache so we don't re-check
      continue;
    }

    // Last-line dedupe against documents themselves. Covers folder moves of emails
    // processed BEFORE internet_message_id tracking existed: those tracker rows have
    // NULL internet_message_id, so neither check above can match when Graph mints a
    // new id on move (2026-08-17 incident: 17 duplicate docs re-ingested).
    // Keyed on immutable header data: sender address + received timestamp + subject.
    if (!isDry && !shouldInspectInbound(email)) {
      const dedupeSender = email.from?.emailAddress?.address || '';
      const dedupeReceivedAt = email.receivedDateTime || null;
      if (dedupeSender && dedupeReceivedAt) {
        const { rows: priorDocs } = await pool.query(
          "SELECT id FROM documents WHERE email_from = $1 AND email_received_at = $2 AND COALESCE(email_subject, '') = $3 LIMIT 1",
          [dedupeSender, dedupeReceivedAt, email.subject || '']
        );
        if (priorDocs.length > 0) {
          log(`Skipping email — document(s) already exist from a prior ingest (sender+timestamp+subject match, e.g. ${priorDocs[0].id}): ${email.subject}`);
          await pool.query(
            'INSERT INTO processed_emails (email_id, processed_at, internet_message_id) VALUES ($1, NOW(), $2) ON CONFLICT (email_id) DO NOTHING',
            [msgId, inetMsgId]
          );
          processedIds.push(msgId);
          if (inetMsgId) processedInternetIds.add(inetMsgId);
          continue;
        }
      }
    }

    log(`\nProcessing: "${email.subject}" from ${email.from?.emailAddress?.address || 'unknown'}`);
    const senderEmail = email.from?.emailAddress?.address || '';
    let emailDb = null;
    let transactionStarted = false;
    let attachments = [];
    const waiversToAutoLink = [];

    try { // Per-email error boundary
    if (!isDry) {
      emailDb = await pool.connect();
      transactionStarted = await beginEmailIngestionTransaction(emailDb, msgId);
      if (!transactionStarted) {
        processedIds.push(msgId);
        log(`Skipping already-processed email after transaction recheck: ${email.subject}`);
        continue;
      }
    }
    const persistenceDb = emailDb || pool;
    const errorCheck = !isDry
      ? await persistenceDb.query(
        'SELECT retry_count, max_retries, error_stage, error_message FROM pipeline_errors WHERE email_message_id = $1 AND resolved = false',
        [msgId]
      )
      : { rows: [] };
    const exhaustedRetries = errorCheck.rows.length > 0
      && errorCheck.rows[0].retry_count >= errorCheck.rows[0].max_retries;
    const emailDir = path.join(INCOMING_DIR, msgId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50));

    // Auto replies and NDRs remain early exits. Other inspected messages must
    // first reach an empty or downloaded attachment set and its real-file pass.
    // Unmatched mail (including unmatched NDRs) returns 'normal' and
    // continues through ordinary ingestion below.
    const inboundEarly = !isDry && (isAutomaticReply(email) || isNdr(email))
      ? await inspectInbound({ email, db: persistenceDb })
      : null;
    let inbound = inboundEarly;
    if (inbound?.action === 'drop' || inbound?.action === 'captured' || inbound?.action === 'held') {
      await finishEmailIngestionTransaction(persistenceDb, msgId, { internetMessageId: inetMsgId });
      transactionStarted = false;
      processedIds.push(msgId);
      if (inetMsgId) processedInternetIds.add(inetMsgId);
      totalProcessed++;
      if (inbound.action === 'drop') totalThreadSkipped++;
      log(`  ${describeInboundDiversion(inbound, email)}`);
      continue;
    }

    // Folder-move dedupe covers every inspected route before a repeated
    // attachment set is downloaded or correlated again.
    if (shouldInspectInbound(email) && senderEmail && email.receivedDateTime) {
      const { rows: priorDocs } = await persistenceDb.query(
        "SELECT id FROM documents WHERE email_from = $1 AND email_received_at = $2 AND COALESCE(email_subject, '') = $3 LIMIT 1",
        [senderEmail, email.receivedDateTime, email.subject || '']
      );
      if (priorDocs.length > 0) {
        await finishEmailIngestionTransaction(persistenceDb, msgId, { internetMessageId: inetMsgId });
        transactionStarted = false;
        processedIds.push(msgId);
        if (inetMsgId) processedInternetIds.add(inetMsgId);
        totalProcessed++;
        log(`  Skipping duplicate inspected message: ${email.subject}`);
        continue;
      }
    }
    
    // An exhausted download error has already used its retry budget. Preserve
    // the message body through the existing placeholder path without another
    // Graph call; other exhausted stages still download files for reprocessing.
    const exhaustedDownload = exhaustedRetries && errorCheck.rows[0].error_stage === 'download';
    const downloadResult = exhaustedDownload
      ? { files: [], inlineRescued: 0, failed: true, error: errorCheck.rows[0].error_message || 'Attachment download failed' }
      : email.hasAttachments === false && !hasInlineAttachmentReference(email)
        ? { files: [], inlineRescued: 0, failed: false, error: null }
        : await downloadEmailAttachments(msgId, emailDir, { from: senderEmail, subject: email.subject || '', dryRun: isDry });
    attachments = Array.isArray(downloadResult) ? downloadResult : (downloadResult?.files || []);
    totalInlineRescued += (downloadResult?.inlineRescued || 0);

    if (downloadResult?.failed && !exhaustedRetries) {
      const error = new Error(downloadResult.error || 'Attachment download failed');
      error.stage = 'download';
      throw error;
    }

    const preFilterReasons = new Map();
    const attachmentIdsByPath = new Map();
    let hasRealAttachments = false;
    for (const attachment of attachments || []) {
      const filePath = attachment.path || attachment.filePath;
      if (!filePath) continue;
      const fileName = attachment.filename || path.basename(filePath);
      const reason = junkFilter.preFilterRealFile(filePath, fileName);
      preFilterReasons.set(filePath, reason);
      attachmentIdsByPath.set(filePath, attachment.attachmentId || null);
      if (!reason) hasRealAttachments = true;
    }

    if (!inbound) {
      // Unmatched mail returns 'normal'; an exhausted retry then reaches the
      // placeholder/materialize path below without an inbound review row.
      inbound = !isDry
        ? await inspectInbound({ email, db: persistenceDb, hasRealAttachments, deferAudit: hasRealAttachments })
        : { action: 'normal' };
    }
    const exhaustedBodyPlaceholder = exhaustedDownload && attachments.length === 0;
    if (inbound?.action === 'drop' || ((inbound?.action === 'captured' || inbound?.action === 'held')
        && !hasRealAttachments && !exhaustedBodyPlaceholder)) {
      await finishEmailIngestionTransaction(persistenceDb, msgId, { internetMessageId: inetMsgId });
      transactionStarted = false;
      processedIds.push(msgId);
      if (inetMsgId) processedInternetIds.add(inetMsgId);
      totalProcessed++;
      if (inbound.action === 'drop') totalThreadSkipped++;
      log(`  ${describeInboundDiversion(inbound, email)}`);
      continue;
    }

    const realAttachmentCount = (attachments || []).filter(attachment => {
      const filePath = attachment.path || attachment.filePath;
      return filePath && !preFilterReasons.get(filePath);
    }).length;
    const waiverRequestTarget = !isDry && !exhaustedRetries && realAttachmentCount > 0
      ? await resolveWaiverRequestTarget(email, inbound, persistenceDb)
      : null;
    const inlineRescuedPaths = new Set((attachments || [])
      .filter(attachment => attachment.isInline)
      .map(attachment => attachment.path || attachment.filePath));

    if (exhaustedRetries) {
      const error = {
        stage: errorCheck.rows[0].error_stage || 'classification',
        message: errorCheck.rows[0].error_message || 'Pipeline retry limit reached',
      };
      const materialized = await materializeExhaustedRetryDocuments({
        db: persistenceDb,
        email,
        attachments,
        error,
        runId,
        fallbackToBody: exhaustedDownload && attachments.length === 0,
        inbound,
      });
      if (materialized.length === 0) {
        throw new Error('Max retries reached but no attachment error document could be materialized');
      }
      const materializedAttachmentIds = new Set();
      for (const entry of materialized) {
        if (!entry.sourceAttachmentId || materializedAttachmentIds.has(entry.sourceAttachmentId)) continue;
        await recordCompletedInboundPromotion({ db: persistenceDb, inbound, attachmentId: entry.sourceAttachmentId, documentId: entry.id });
        if (inbound?.correlationState === 'matched' && inbound.documentId) materializedAttachmentIds.add(entry.sourceAttachmentId);
      }
      if (!isDry && inbound?.auditEvent) await insertAuditEvent(inbound.auditEvent, persistenceDb);
      await finishEmailIngestionTransaction(persistenceDb, msgId, { internetMessageId: inetMsgId });
      transactionStarted = false;
      processedIds.push(msgId);
      if (inetMsgId) processedInternetIds.add(inetMsgId);
      totalQueued += materialized.length;
      totalProcessed++;
      log(`  Materialized ${materialized.length} reprocessable error document(s) after max retries`);
      continue;
    }
    
    // Handle case: no attachments — save email body as reference
    if (!attachments || attachments.length === 0) {
      // --- Thread-aware dedup (Bug 1 fix) ---
      // Skip attachment-less emails when the same conversation thread already has
      // a processed document with real attachments. Covers RE:/FW: replies that
      // add no new files but still get ingested as separate messages.
      const convId = email.conversationId || null;
      let skipAsThreadReply = false;

      // Replies to Toolbox mail were already captured or held above, so an
      // RE:/FW: reaching this point is not tied to Toolbox and is queued like
      // new mail. Only automatic-reply subjects are discarded here.
      const rawSubject = (email.subject || '').trim();
      if (/^automatic reply\s*:/i.test(rawSubject)) {
        skipAsThreadReply = true;
        totalThreadSkipped++;
        log('  Skipping — automatic reply with no attachments, discarding');
      }

      if (!skipAsThreadReply && convId) {
        try {
          const threadCheck = await persistenceDb.query(
            `SELECT COUNT(*) AS cnt FROM documents
             WHERE email_conversation_id = $1
               AND file_name IS NOT NULL
               AND deleted_at IS NULL`,
            [convId]
          );
          if (parseInt(threadCheck.rows[0]?.cnt || '0', 10) > 0) {
            skipAsThreadReply = true;
            totalThreadSkipped++;
            log('  Skipping — thread already has a processed document with attachments');
          }
        } catch (e) {
          log(`  WARNING: Thread dedup check failed: ${e.message}`);
        }
      }

      // Fallback: subject-based dedup when conversationId is unavailable
      // (e.g. emails fetched before conversationId was added to $select).
      // Narrows by sender domain to avoid false matches on common subjects.
      if (!skipAsThreadReply && !convId) {
        const subject = (email.subject || '').trim();
        const baseSubject = subject.replace(/^(RE:|Re:|re:|FW:|Fw:|fw:|Automatic reply:\s*)+/i, '').trim();
        const senderDomain = senderEmail.includes('@') ? senderEmail.split('@').pop().toLowerCase() : '';
        if (baseSubject !== subject && baseSubject.length > 3 && senderDomain) {
          try {
            // Escape SQL LIKE wildcards in the subject to prevent injection
            const escapedSubject = baseSubject.replace(/[%_\\]/g, '\\$&');
            const subjectCheck = await persistenceDb.query(
              `SELECT COUNT(*) AS cnt FROM documents
               WHERE email_subject LIKE $1 ESCAPE '\\'
                 AND LOWER(email_from) LIKE $2 ESCAPE '\\'
                 AND file_name IS NOT NULL
                 AND deleted_at IS NULL`,
              ['%' + escapedSubject, '%@' + senderDomain.replace(/[%_\\]/g, '\\$&')]
            );
            if (parseInt(subjectCheck.rows[0]?.cnt || '0', 10) > 0) {
              skipAsThreadReply = true;
              totalThreadSkipped++;
              log(`  Skipping \u2014 reply/forward to already-processed email: "${baseSubject}" (domain: ${senderDomain})`);
            }
          } catch (e) {
            log(`  WARNING: Subject dedup check failed: ${e.message}`);
          }
        }
      }

      if (!skipAsThreadReply) {
        log('  No attachments found — queuing email body for review');
        if (!isDry) {
          await insertDocument({
            id: `doc-${Date.now()}-body`,
            runId,
            classification: 'no-attachment',
            file: null,
            email: {
              messageId: msgId,
              conversationId: convId,
              from: senderEmail,
              subject: email.subject || '',
              receivedAt: email.receivedDateTime || '',
              bodyPreview: (email.bodyPreview || '').slice(0, 500),
              body: email.body?.content || null,
              bodyContentType: email.body?.contentType || 'html',
            },
            status: 'pending',
            queuedAt: new Date().toISOString(),
          }, persistenceDb);
        }
        totalQueued++;
      }
    }

    // Process each attachment
    let filesToProcess = [];
    const originalFileNames = new Map(); // filePath -> original unsanitized filename (for Graph refetch)
    for (const att of (attachments || [])) {
      const filePath = att.path || att.filePath;
      if (!filePath) continue;
      
      // Track original filename for corruption retry refetch
      if (att.filename) originalFileNames.set(filePath, att.filename);

      // Skip Outlook artifacts (inline images, embedded objects from forwarded emails)
      const baseName = path.basename(filePath);
      if (/^Outlook-[a-z0-9]+(\.(png|jpg|jpeg|gif))?$/i.test(baseName)) {
        log(`  Skipping Outlook artifact: ${baseName}`);
        if (!isDry) {
          await junkFilter.logSkip({
            fileName: baseName,
            fileSizeBytes: att.size ?? null,
            sha256: junkFilter.sha256File(filePath),
            reason: `outlook-artifact (${baseName})`,
            emailFrom: senderEmail,
            emailSubject: email.subject || '',
            emailMessageId: msgId,
          });
        }
        continue;
      }
      
      // Handle ZIPs
      if (filePath.toLowerCase().endsWith('.zip')) {
        const zipDir = path.join(emailDir, 'unzipped_' + Date.now());
        const extracted = extractZip(filePath, zipDir);
        filesToProcess.push(...extracted);
        for (const extractedPath of extracted) attachmentIdsByPath.set(extractedPath, att.attachmentId || null);
      } else {
        filesToProcess.push(filePath);
      }
    }

    // Parse email body for job/project data (done once per email, used for all attachments)
    const emailJobData = parseEmailBodyForJobData(email.body?.content, email.subject);
    if (emailJobData.jobNumber || emailJobData.projectName || emailJobData.subcontractNumber) {
      log(`  → Email body data: job=${emailJobData.jobNumber || 'n/a'}, project=${emailJobData.projectName || 'n/a'}, SC=${emailJobData.subcontractNumber || 'n/a'}`);
    }

    // Classify + extract each document
    let skippedFiles = [];
    let hasNonSkipped = false;

    // Use a mutable queue so split PDFs can be appended and processed inline
    const fileQueue = [...filesToProcess];
    const splitFromIds = new Map(); // filePath -> origId (for split PDFs)
    const recordedPromotionAttachmentIds = new Set();
    let fqIdx = 0;

    while (fqIdx < fileQueue.length) {
      const filePath = fileQueue[fqIdx++];
      log(`  Classifying: ${path.basename(filePath)}`);

      // Junk fingerprint cache — check BEFORE any classification/Haiku work.
      // Known signature footers/logos repeat across emails (same bytes); a
      // hash hit skips the file entirely and never queues a document row.
      const junkCheck = isDry
        ? { sha256: junkFilter.sha256File(filePath), reason: null, hitCount: null }
        : await junkFilter.evaluateJunkHash(filePath);
      const fileSha256 = junkCheck.sha256;
      if (junkCheck.reason) {
        log(`  → Skipped (junk hash cache): ${junkCheck.reason}`);
        if (!isDry) {
          await junkFilter.logSkip({
            fileName: path.basename(filePath),
            fileSizeBytes: (() => { try { return fs.statSync(filePath).size; } catch { return null; } })(),
            sha256: fileSha256,
            reason: junkCheck.reason,
            emailFrom: senderEmail,
            emailSubject: email.subject || '',
            emailMessageId: msgId,
          });
        }
        skippedFiles.push({ file: path.basename(filePath), reason: junkCheck.reason });
        // Trash-tab exposure: first hit of a hash gets a pre-discarded doc row.
        if (!isDry && await junkFilter.shouldCreateTrashRow({ sha256: fileSha256, hitCount: junkCheck.hitCount })) {
          const trashId = await insertFilteredTrashDocument({
            filePath,
            reason: junkCheck.reason,
            discardSource: 'junk-hash',
            sha256: fileSha256,
            email: {
              messageId: msgId,
              conversationId: email.conversationId || null,
              from: senderEmail,
              subject: email.subject || '',
              receivedAt: email.receivedDateTime || '',
              bodyPreview: (email.bodyPreview || '').slice(0, 500),
            },
            db: persistenceDb,
            sourceIdentity: { sourceDocumentId: inbound?.documentId || null, sourceEmailMessageId: inbound?.messageId || null,
              sourceAttachmentId: attachmentIdsByPath.get(filePath) || null },
          });
          log(`  → Trash row created for first junk-hash hit: ${trashId}`);
        }
        totalProcessed++;
        continue;
      }

      // ── Automatic split detection DISABLED (2026-07-01) ──
      // Split is now a manual-only action via POST /api/invoices/:id/flag-for-split.
      // detectSplitCandidacy() is preserved for on-demand analysis via POST /api/splits/:id/analyze.
      // See: docs/specs/2026-07-01-manual-split-only.md
      const fileExt = path.extname(filePath).toLowerCase();
      const splitFromId = splitFromIds.get(filePath) || null;

      const preFilterReason = preFilterReasons.has(filePath)
        ? preFilterReasons.get(filePath)
        : junkFilter.preFilterRealFile(filePath, originalFileNames.get(filePath) || path.basename(filePath));
      const forceR9 = waiverRequestTarget && !inlineRescuedPaths.has(filePath);
      const classResult = preFilterReason
        ? { classification: 'skipped', file: path.basename(filePath), reason: preFilterReason }
        : await classifyDocument(filePath, { subject: email.subject, body: email.body?.content, messageId: msgId,
          fileName: originalFileNames.get(filePath) || path.basename(filePath),
          forceClassification: forceR9 ? 'lien-waiver' : null,
          ...(forceR9 ? { forcedMethod: 'waiver-request-ref' } : {}) });
      log(`  → ${classResult.classification} (${classResult.method || 'unknown'}, confidence: ${classResult.confidence || 'n/a'})`);

      // Skip junk items (signature images, tiny files) — don't queue individually
      if (classResult.classification === 'skipped') {
        skippedFiles.push({ file: path.basename(filePath), reason: classResult.reason });
        log(`  → Skipped (not queued): ${classResult.reason}`);
        if (!isDry) {
          await junkFilter.logSkip({
            fileName: path.basename(filePath),
            fileSizeBytes: (() => { try { return fs.statSync(filePath).size; } catch { return null; } })(),
            sha256: fileSha256,
            reason: classResult.reason,
            emailFrom: senderEmail,
            emailSubject: email.subject || '',
            emailMessageId: msgId,
          });
        }
        // Trash-tab exposure: first time this content is rule-filtered
        // (name pattern / dimensions / size floor), insert a pre-discarded
        // doc row; repeats of the same bytes stay log-only.
        if (!isDry && await junkFilter.shouldCreateTrashRow({ sha256: fileSha256 })) {
          const trashId = await insertFilteredTrashDocument({
            filePath,
            reason: classResult.reason,
            discardSource: 'rule-filter',
            sha256: fileSha256,
            email: {
              messageId: msgId,
              conversationId: email.conversationId || null,
              from: senderEmail,
              subject: email.subject || '',
              receivedAt: email.receivedDateTime || '',
              bodyPreview: (email.bodyPreview || '').slice(0, 500),
            },
            db: persistenceDb,
            sourceIdentity: { sourceDocumentId: inbound?.documentId || null, sourceEmailMessageId: inbound?.messageId || null,
              sourceAttachmentId: attachmentIdsByPath.get(filePath) || null },
          });
          log(`  → Trash row created for first rule-filter hit: ${trashId}`);
        }
        totalProcessed++;
        continue;
      }
      hasNonSkipped = true;

      // Base64 encode the file for ALL entries (so dashboard can always show the attachment)
      let entryBase64 = null;
      let entryFileSize = 0;
      try {
        entryBase64 = fs.readFileSync(filePath).toString('base64');
        entryFileSize = fs.statSync(filePath).size;
      } catch (e) {
        log(`  WARNING: Could not base64 encode file: ${e.message}`);
      }

      const queueEntry = {
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        runId,
        classification: classResult.classification,
        confidence: classResult.confidence || null,
        splitFrom: splitFromId || null,
        file: path.basename(filePath),
        filePath: filePath,
        email: {
          messageId: msgId,
          conversationId: email.conversationId || null,
          from: senderEmail,
          subject: email.subject || '',
          receivedAt: email.receivedDateTime || '',
          bodyPreview: (email.bodyPreview || '').slice(0, 500),
          body: typeof email.body === 'string' ? email.body : (email.body?.content || null),
          bodyContentType: typeof email.body === 'string' ? null : (email.body?.contentType || null),
          internetMessageId: email.internetMessageId || null,
          internetMessageHeaders: email.internetMessageHeaders || null,
        },
        sourceDocumentId: inbound?.documentId || null,
        sourceEmailMessageId: inbound?.messageId || null,
        sourceAttachmentId: attachmentIdsByPath.get(filePath) || null,
        targetInvoiceId: waiverRequestTarget?.id || null,
        targetLinkSource: waiverRequestTarget?.refSource || null,
        attachmentCount: realAttachmentCount,
        reason: classResult.reason || null,
        status: 'pending',
        queuedAt: new Date().toISOString(),
        pdfBase64: entryBase64,
        pdfSize: entryFileSize,
      };

      // Add structured error details when classification failed
      if (classResult.classification === 'error') {
        queueEntry.error = {
          stage: classResult.stage || 'classification',
          message: classResult.reason || 'Unknown error',
          timestamp: new Date().toISOString(),
        };
        queueEntry.flagged = true;
        queueEntry.notes = `[${queueEntry.error.stage}] ${queueEntry.error.message}`;
        totalErrors++;
        log(`  ⚠ ERROR: [${queueEntry.error.stage}] ${queueEntry.error.message}`);
      } else if (classResult.notes === DETAILS_UNREADABLE_NOTE) {
        // Type known, details blank: flag for review, not an error.
        queueEntry.flagged = true;
        queueEntry.notes = DETAILS_UNREADABLE_NOTE;
        queueEntry.flaggedAt = queueEntry.queuedAt;
        queueEntry.flaggedBy = 'pipeline';
        queueEntry.flagReason = DETAILS_UNREADABLE_NOTE;
      }

      // If invoice-like: add extraction + matching data
      if (isInvoiceLikeClassification(classResult.classification) && classResult.extracted) {
        normalizeExtractedDates(classResult.extracted, email.receivedDateTime);

        // Normalize invoice number: strip common prefixes and internal spaces.
        // Haiku often extracts "INV407882" or "26 00287" but Spectrum and
        // Dana expect "407882" and "2600287".
        if (classResult.extracted.invoiceNumber) {
          let inv = classResult.extracted.invoiceNumber.trim();
          // Strip common prefixes: INV, INVOICE, #, No., No
          inv = inv.replace(/^(INV(OICE)?|#|No\.?\s*)/i, '').trim();
          // Remove internal spaces in numeric-looking invoice numbers
          // (e.g., "26 00287" → "2600287" but leave "ABC 123" alone)
          if (/^\d[\d\s]+\d$/.test(inv)) {
            inv = inv.replace(/\s+/g, '');
          }
          classResult.extracted.invoiceNumber = inv;
        }

        // Supplement extraction with email body data (don't override PDF data)
        if (emailJobData.jobNumber && !classResult.extracted.jobNumber) {
          classResult.extracted.jobNumber = emailJobData.jobNumber;
        }
        if (emailJobData.projectName && !classResult.extracted.projectName) {
          classResult.extracted.projectName = emailJobData.projectName;
        }

        const matching = await matchInvoice(classResult.extracted, senderEmail, email.subject, emailJobData);

        // Reuse the base64 already encoded above
        const fileBase64 = entryBase64;
        const fileSize = entryFileSize;

        queueEntry.extracted = classResult.extracted;
        queueEntry.matching = matching;
        queueEntry.overallConfidence = matching.overallConfidence || 0;
        queueEntry.pdfBase64 = fileBase64;
        queueEntry.pdfSize = fileSize;

        log(`  → Vendor: ${matching.vendor?.vendorCode || 'UNMATCHED'} (${matching.vendor?.confidence || 0})`);
        log(`  → Job: ${matching.job?.jobNumber || 'NONE'} (${matching.job?.method || 'n/a'})`);
        log(`  → Subcontract: ${matching.subcontract?.subcontractNumber || 'UNMATCHED'} (${matching.subcontract?.confidence || 0})`);

        // Pay-app numbering convention (B4) — must run before duplicate
        // flagging so the check sees the final invoice number.
        await applyPayAppNumbering(queueEntry, log);

        // Multi-phase detection: if the matched subcontract has 2+ distinct phases,
        // flag the invoice so the user MUST allocate via the new UI before submission.
        if (matching.subcontract?.subcontractNumber) {
          try {
            const { getSubcontractPhaseInfo } = require('./matcher');
            const phaseInfo = getSubcontractPhaseInfo(matching.subcontract.subcontractNumber);
            if (phaseInfo && phaseInfo.isMultiPhase) {
              queueEntry._multiPhaseCandidate = true;
              queueEntry._multiPhaseInfo = phaseInfo;
              log(`  ⚠ Multi-phase subcontract — ${phaseInfo.distinctPhaseCount} phases: ${phaseInfo.phases.map(p => p.phase_code).join(', ')} (user must allocate)`);
            }
          } catch (phaseErr) {
            log(`  ⚠ Multi-phase check failed (non-fatal): ${phaseErr.message}`);
          }
        }
      } else if (classResult.extracted && isExtractionEnabledForClassification(classResult.classification)) {
        attachExtractedPayloadToQueueEntry(queueEntry, classResult);
        const matching = await matchPerTypeDocumentData(classResult.classification, classResult.extracted, {
          emailSubject: email.subject,
          documentId: queueEntry.id,
        });
        if (matching) {
          if (classResult.classification === 'statement' && Array.isArray(matching.statementLines)) {
            classResult.extracted.statementLines = matching.statementLines;
          }
          queueEntry.matching = matching;
          queueEntry.overallConfidence = matching.overallConfidence;
        }
      }

      // Lien waiver check: for invoices, check if any page in the same PDF was a lien waiver
      if (['invoice', 'receipt', 'credit-memo', 'pay-application'].includes(queueEntry.classification)) {
        const pageClasses = classResult.pageClassifications || [];
        const hasLienWaiver = pageClasses.some(c => c === 'lien-waiver');
        queueEntry.lienWaiverStatus = hasLienWaiver ? 'attached' : null;
        if (!hasLienWaiver) {
          log(`  ⚠ Lien waiver: MISSING (pages classified as: ${pageClasses.join(', ') || 'n/a'})`);
        } else {
          log(`  ✓ Lien waiver: attached (found in same PDF)`);
        }
      }

      // Persist per-page classification array
      if (classResult.pageClassifications && classResult.pageClassifications.length > 0) {
        queueEntry.pageClassifications = classResult.pageClassifications;
      }

      // Flag OCR-processed documents so reviewers know
      if (classResult.ocrApplied) {
        queueEntry.notes = queueEntry.notes ? `${queueEntry.notes}; OCR applied` : 'OCR applied';
      }

      // Track Haiku token usage
      if (classResult.tokensUsed) {
        queueEntry.tokensUsed = classResult.tokensUsed;
      }

      // Layer 4: auto-discard high-confidence 'other' IMAGES. The document row
      // still inserts (nothing vanishes) but arrives pre-discarded so it never
      // hits the review queue, and its hash is junk-cached so future copies
      // skip before classification. PDFs classified 'other' stay pending.
      let autoDiscardedOther = false;
      if (junkFilter.shouldAutoDiscardOther({
        classification: queueEntry.classification,
        confidence: queueEntry.confidence,
        isImage: detectFileType(filePath).isImage,
      })) {
        autoDiscardedOther = true;
        queueEntry.status = 'discarded';
        queueEntry.discardSource = 'auto-ai';
        queueEntry.sha256 = fileSha256 || junkFilter.sha256File(filePath);
        const autoNote = 'Auto-discarded: high-confidence non-document image (signature/logo)';
        queueEntry.notes = queueEntry.notes ? `${queueEntry.notes}; ${autoNote}` : autoNote;
        log(`  → Auto-discarding 'other' image (confidence ${queueEntry.confidence})`);
      }

      // Flag possible duplicates — user decides what to do
      if (!isDry) {
        if (queueEntry.classification === 'error') {
          const existingErrorDoc = await findExistingErrorDoc({
            emailFrom: queueEntry.email.from,
            emailSubject: queueEntry.email.subject,
            fileName: queueEntry.file,
            fileSizeBytes: queueEntry.pdfSize,
            db: persistenceDb,
          });
          if (existingErrorDoc) {
            await touchExistingErrorDoc(existingErrorDoc.id, queueEntry.error, persistenceDb);
            log(`  → Duplicate error suppressed; updated existing error doc ${existingErrorDoc.id}`);
            totalProcessed++;
            continue;
          }
        } else {
          const entryInvNum = queueEntry.extracted?.invoiceNumber || queueEntry.invoiceNumber;
          const entryVendorCode = queueEntry.matching?.vendor?.vendorCode || queueEntry.vendorCode;
          const entryVendorEmail = (senderEmail || '').split('@')[1];
          if (entryInvNum && (entryVendorCode || entryVendorEmail)) {
            const duplicate = await findDuplicate(entryInvNum, entryVendorCode, entryVendorEmail, persistenceDb);
            if (duplicate) {
              queueEntry.flagged = true;
              queueEntry.duplicateOf = duplicate.id;
              queueEntry.notes = `Possible duplicate of ${duplicate.id} (earlier copy: ${duplicate.status}) — Invoice #${entryInvNum}`;
              log(`  ⚠ POSSIBLE DUPLICATE: Invoice #${entryInvNum} already exists (${duplicate.id}, ${duplicate.status})`);
            } else if (entryVendorCode) {
              // Spectrum-side duplicate check (2026-09-02). findDuplicate above
              // only knows documents that came through this pipeline — invoices
              // entered or paid directly in Spectrum (e.g. pre-Toolbox history)
              // are invisible to it and sailed through unflagged (first caught
              // case: doc-1700000000000-demo, a resend of VEND07 #1920 paid
              // 2026-06-08). Reuse the statement reconciler's lookup
              // (spectrum.findSpectrumInvoice): normalized invoice-number +
              // exact vendor-code match across all three AP tables — open
              // items, in-approval, payment history. Deliberately NOT a new
              // matcher: one shared lookup, two consumers, no drift.
              // Gated on a resolved vendor code because the Spectrum match is
              // vendor-code-keyed; a sender email domain alone can't be
              // checked there. Fails open inside the lookup: Spectrum
              // downtime/slowness → null → no flag, ingestion never blocks.
              // No duplicateOf is set — there is no Toolbox document to link.
              const { findSpectrumInvoice } = require('./spectrum');
              const spectrumCopy = await findSpectrumInvoice({ invoiceNumber: entryInvNum, vendorCode: entryVendorCode });
              if (spectrumCopy) {
                const sourceLabel = {
                  OPEN_ITEMS: 'open items',
                  APPROVAL: 'in approval',
                  PAYMENT_HIST: 'paid — payment history',
                }[spectrumCopy.source] || spectrumCopy.source;
                queueEntry.flagged = true;
                const amountText = spectrumCopy.amount == null ? '' : `, $${spectrumCopy.amount.toFixed(2)}`;
                const spectrumNote = `Possible duplicate: Invoice #${entryInvNum} already in Spectrum (${sourceLabel}${amountText})`;
                queueEntry.notes = queueEntry.notes ? `${queueEntry.notes}; ${spectrumNote}` : spectrumNote;
                log(`  ⚠ POSSIBLE DUPLICATE (Spectrum): Invoice #${entryInvNum} found in ${spectrumCopy.source}${amountText}`);
              }
            }
          }
        }
        await insertDocument(queueEntry, persistenceDb);
        if (queueEntry.sourceAttachmentId && !recordedPromotionAttachmentIds.has(queueEntry.sourceAttachmentId)) {
          await recordCompletedInboundPromotion({
            db: persistenceDb,
            inbound,
            attachmentId: queueEntry.sourceAttachmentId,
            documentId: queueEntry.id,
          });
          if (inbound?.correlationState === 'matched' && inbound.documentId) {
            recordedPromotionAttachmentIds.add(queueEntry.sourceAttachmentId);
          }
        }

        if (autoDiscardedOther) {
          await junkFilter.insertJunkHash({
            sha256: fileSha256 || junkFilter.sha256File(filePath),
            fileName: path.basename(filePath),
            fileSizeBytes: queueEntry.pdfSize || null,
            reason: `auto-discarded 'other' image (confidence ${queueEntry.confidence})`,
            source: 'auto-other',
          });
        }

        // Auto-link newly ingested lien waivers to an invoice on the same
        // email thread (unambiguous single-invoice match only; multi-waiver
        // bundles and ambiguous threads fall back to manual suggestions).
        // Unreadable-details waivers are linked by a person instead.
        if (queueEntry.classification === 'lien-waiver' && queueEntry.flagReason !== DETAILS_UNREADABLE_NOTE) {
          waiversToAutoLink.push({
            id: queueEntry.id,
            email: queueEntry.email,
            pageClassifications: queueEntry.pageClassifications,
            targetInvoiceId: queueEntry.targetInvoiceId,
            targetLinkSource: queueEntry.targetLinkSource,
            attachmentCount: queueEntry.attachmentCount,
          });
        }

        // Automatic split flagging removed (2026-07-01). Split is manual-only now.

        // If the matched subcontract has multiple phases, flag the invoice
        // for multi-phase allocation review.
        if (queueEntry._multiPhaseCandidate) {
          try {
            await persistenceDb.query(
              `UPDATE documents
               SET multi_phase_candidate = true,
                   updated_at = NOW()
               WHERE id = $1`,
              [queueEntry.id]
            );
            log(`  → Flagged ${queueEntry.id} as multi_phase_candidate (${queueEntry._multiPhaseInfo.distinctPhaseCount} phases on sub ${queueEntry._multiPhaseInfo.subcontractNumber})`);
          } catch (phaseErr) {
            log(`  ⚠ Failed to apply multi-phase flag: ${phaseErr.message}`);
          }
        }
      }
      totalQueued++;
      totalProcessed++;
    }

    // If ALL attachments were skipped, queue one email-level entry for review
    if (skippedFiles.length > 0 && !hasNonSkipped) {
      log(`  → All ${skippedFiles.length} attachments skipped — queuing email for review`);
      if (!isDry) {
        await insertDocument({
          id: `doc-${Date.now()}-skipped`,
          runId,
          classification: 'all-skipped',
          file: null,
          email: {
            messageId: msgId,
            conversationId: email.conversationId || null,
            from: senderEmail,
            subject: email.subject || '',
            receivedAt: email.receivedDateTime || '',
            bodyPreview: (email.bodyPreview || '').slice(0, 500),
            body: email.body?.content || null,
            bodyContentType: email.body?.contentType || null,
          },
          sourceDocumentId: inbound?.documentId || null,
          sourceEmailMessageId: inbound?.messageId || null,
          sourceAttachmentId: attachments.length === 1 ? (attachments[0].attachmentId || null) : null,
          status: 'pending',
          queuedAt: new Date().toISOString(),
        }, persistenceDb);
      }
      totalQueued++;
    }

    // Matched-route correlation audit is deliberately last in the same email
    // transaction so a failed document insert cannot leave an orphan event.
    if (!isDry && inbound?.auditEvent) await insertAuditEvent(inbound.auditEvent, persistenceDb);

    // A successful email's attachment set, marker, and resolved retry state
    // commit together; failures roll all of them back in the catch below.
    if (!isDry) {
      await persistenceDb.query(
        'UPDATE pipeline_errors SET resolved = true WHERE email_message_id = $1 AND resolved = false',
        [msgId]
      );
      await finishEmailIngestionTransaction(persistenceDb, msgId, { internetMessageId: inetMsgId });
      transactionStarted = false;
      processedIds.push(msgId);
      if (inetMsgId) processedInternetIds.add(inetMsgId);
      await autoLinkCommittedWaivers(waiversToAutoLink, linkCommittedWaiver, dependencies.log || log);
    }
    } catch (emailError) {
      // Per-email error handler — log, track, continue to next email
      log(`  ✗ ERROR processing email: ${emailError.message}`);
      totalErrors++;
      if (transactionStarted) {
        await rollbackEmailIngestionTransaction(emailDb);
        transactionStarted = false;
      }

      // Determine error stage from the error
      let stage = emailError.stage || 'unknown';
      if (!emailError.stage && (emailError.message.includes('classify') || emailError.message.includes('vision'))) stage = 'classify';
      else if (!emailError.stage && emailError.message.includes('extract')) stage = 'extract';
      else if (!emailError.stage && emailError.message.includes('match')) stage = 'match';
      else if (!emailError.stage && (emailError.message.includes('INSERT') || emailError.message.includes('insert') || emailError.message.includes('violates'))) stage = 'insert';

      if (!isDry) {
        // Upsert error record
        const existing = await pool.query(
          'SELECT id, retry_count, max_retries FROM pipeline_errors WHERE email_message_id = $1 AND resolved = false',
          [msgId]
        );
        let retryCount = 1;
        let maxRetries = 3;
        if (existing.rows.length > 0) {
          retryCount = existing.rows[0].retry_count + 1;
          maxRetries = existing.rows[0].max_retries || maxRetries;
          await pool.query(
            'UPDATE pipeline_errors SET retry_count = retry_count + 1, error_message = $1, error_stage = $2, last_retry_at = NOW() WHERE id = $3',
            [emailError.message.slice(0, 500), stage, existing.rows[0].id]
          );
          log(`    Retry ${retryCount}/${maxRetries} logged`);
        } else {
          await pool.query(
            'INSERT INTO pipeline_errors (email_message_id, email_subject, email_from, error_message, error_stage) VALUES ($1, $2, $3, $4, $5)',
            [msgId, (email.subject || '').slice(0, 200), senderEmail, emailError.message.slice(0, 500), stage]
          );
          log(`    Error logged (attempt 1/3)`);
        }
        if (retryCount >= maxRetries && attachments.length > 0) {
          const materialized = await runEmailIngestionTransaction({
            db: emailDb,
            emailId: msgId,
            persist: (db) => materializeExhaustedRetryDocuments({
              db,
              email,
              attachments,
              error: { stage, message: emailError.message },
              runId,
            }),
          });
          if (!materialized.alreadyProcessed && materialized.value.length > 0) {
            processedIds.push(msgId);
            totalQueued += materialized.value.length;
            totalProcessed++;
            log(`    Materialized ${materialized.value.length} reprocessable error document(s)`);
          }
        }
      }
      continue; // Move to next email — don't crash the pipeline
    } finally {
      if (emailDb) emailDb.release();
    }


  }

  // Save state
  if (!isDry) {
    const queueTotal = await countQueuedDocuments();
    log(`\nState saved to Supabase. Queue now has ${queueTotal} items.`);
  } else {
    log(`\nDry run complete — no DB writes.`);
  }

  const queueTotal = isDry ? 0 : await countQueuedDocuments();
  const summary = {
    runId,
    processed: totalProcessed,
    queued: totalQueued,
    errors: totalErrors,
    threadSkipped: totalThreadSkipped,
    inlineRescued: totalInlineRescued,
    queueTotal,
  };

  log(`\n=== Pipeline complete: ${totalProcessed} docs processed, ${totalQueued} queued, ${totalErrors} errors ===`);

  // ── Amazon GL auto-classification (ZAMA92 invoices only) ──
  if (!isDry && totalQueued > 0 && shouldRunPostProcessing) {
    try {
      const amazonDocs = await pool.query(
        `SELECT id, description, line_items, job_match_number, gl_account, cost_type
         FROM documents
         WHERE vendor_code = 'ZAMA92'
           AND classification = 'invoice'
           AND gl_account IS NULL
           AND queued_at > NOW() - INTERVAL '10 minutes'
           AND status = 'pending'`
      );
      for (const doc of amazonDocs.rows) {
        try {
          const result = await classifyAmazonGL(doc);
          if (result) {
            // Job materials requires a job code — skip GL/cost type if no job matched
            if (result.category === 'job_materials' && !doc.job_match_number) {
              log(`  → Amazon GL classification: ${doc.id} → job_materials but no job code, leaving empty for manual coding`);
              continue;
            }
            await applyAmazonGLClassification(doc, result, pool);
            log(`  → Amazon GL classification: ${doc.id} → GL ${result.gl}${result.costType ? `, cost type ${result.costType}` : ''} (${result.category})`);
          } else {
            log(`  → Amazon GL classification: ${doc.id} → no match, leaving empty`);
          }
        } catch (classErr) {
          log(`  ⚠ Amazon GL classification failed for ${doc.id}: ${classErr.message}`);
        }
      }
    } catch (amazonErr) {
      log(`Amazon GL classification query error: ${amazonErr.message}`);
    }
  }

  // ── Apply active rules to newly queued documents ──
  if (!isDry && totalQueued > 0 && shouldRunPostProcessing) {
    const MAX_RULES_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RULES_RETRIES; attempt++) {
      try {
        const { buildPatchUpdate, evaluateBatch } = require('../scripts/rules-engine');
        const rulesResult = await pool.query(`SELECT * FROM rules WHERE is_active = true ORDER BY rule_order ASC`);
        if (rulesResult.rows.length > 0) {
          // Get docs from this run
          const newDocs = await pool.query(
            `SELECT * FROM documents WHERE queued_at > NOW() - INTERVAL '10 minutes' AND status = 'pending'`
          );
          const results = evaluateBatch(newDocs.rows, rulesResult.rows);
          const documentsById = new Map(newDocs.rows.map((doc) => [doc.id, doc]));
          const { applyRulePatch } = require('./rulesService');
          for (const { docId, patches, matchedRules } of results) {
            // Rules may only set existing active classifications.
            if (patches.classification) {
              patches.classification = await enforceActiveClassification(patches.classification, 'pipeline-rules');
            }
            const patchUpdate = buildPatchUpdate(patches, 2);
            if (!patchUpdate.setClauses) continue;

            await applyRulePatch({ documentId: docId, patchUpdate, matchedRules, db: pool });
            await emitPipelineRulesAppliedEvent({
              document: documentsById.get(docId), patchUpdate, matchedRules, db: pool,
            });
            log(`  → Rules applied to ${docId}: ${JSON.stringify(patchUpdate.patches)}`);
          }
          if (results.length > 0) log(`Rules engine: ${results.length} documents updated`);
        }
        break; // success — exit retry loop
      } catch (rulesErr) {
        log(`Rules engine warning (attempt ${attempt}/${MAX_RULES_RETRIES}): ${rulesErr.message}`);
        if (attempt < MAX_RULES_RETRIES) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
    }
  }

  // Auto-archive new files to Box (non-blocking — errors logged but don't fail the pipeline)
  if (!isDry && totalQueued > 0 && shouldRunPostProcessing) {
    try {
      log('Archiving new files to Box...');
      const { execSync } = require('child_process');
      const archiveScript = require('path').join(__dirname, '..', 'scripts', 'box-archive.js');
      const out = execSync(`node "${archiveScript}"`, { encoding: 'utf8', timeout: 120000 });
      const uploadMatch = out.match(/(\d+) uploaded/);
      if (uploadMatch) log(`Box archive: ${uploadMatch[1]} files uploaded`);
    } catch (archiveErr) {
      log(`Box archive warning: ${archiveErr.message}`);
    }
  }

  // Write pipeline status for dashboard endpoint. Uses the shared config
  // PIPELINE_STATUS_PATH — the same file the /api/pipeline routes read.
  try {
    const statusPath = PIPELINE_STATUS_PATH;
    const statusData = {
      lastRun: new Date().toISOString(),
      lastResult: {
        runId,
        processed: totalProcessed,
        queued: totalQueued,
        errors: totalErrors,
        durationMs: Date.now() - startTime,
        isDry,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));
  } catch (statusErr) {
    log(`Status file warning: ${statusErr.message}`);
  }

  // ── Inbox sanity check ──
  // Compares recent inbox emails against processed_emails to detect any
  // that the pipeline should have picked up but didn't.
  if (!isDry && shouldRunPostProcessing) {
    try {
      if (totalQueued === 0 && emails.length === 0) {
        log('Zero items queued this run — no new emails found (normal quiet period)');
      }
    } catch (alertErr) {
      log(`Inbox sanity check failed (non-fatal): ${alertErr.message}`);
    }
  }

  // ── Post formatted report to #accounting via Discord webhook ──
  if (!isDry && shouldRunPostProcessing) {
    try {
      const { WEBHOOKS_JSON } = require('/etc/toolbox/paths.js');
      const webhooksPath = WEBHOOKS_JSON;
      const webhooks = JSON.parse(fs.readFileSync(webhooksPath, 'utf8'));
      const webhookUrl = webhooks.WEBHOOK_ACCOUNTING;
      if (webhookUrl) {
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          timeZone: 'America/New_York',
        });
        const timeStr = now.toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
        });
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const statusEmoji = totalErrors > 0 ? '\u26a0\ufe0f' : '\u2705';
        const statusText = totalErrors > 0 ? 'completed with errors' : 'executed successfully';

        const lines = [
          `**NCG AP Invoice Pipeline \u2014 Scan Complete**`,
          ``,
          `${statusEmoji} **Pipeline ${statusText}** \u2014 ${dateStr} at ${timeStr} ET`,
          ``,
          `**Results:**`,
          `- **Emails processed:** ${totalProcessed} total`,
          `- **New invoices queued:** ${totalQueued}${totalQueued === 0 ? ' (all emails were already in the system)' : ''}`,
          `- **Processing errors:** ${totalErrors}`,
          `- **Queue status:** ${queueTotal} items in pipeline`,
          `- **Duration:** ${durationSec}s`,
        ];

        if (totalQueued > 0) {
          lines.push(``);
          lines.push(`**Summary:** ${totalQueued} new document${totalQueued === 1 ? '' : 's'} queued for review.`);
        } else if (totalErrors === 0) {
          lines.push(``);
          lines.push(`**Summary:** No new invoices this cycle. All inbox emails already tracked.`);
        }

        if (totalErrors > 0) {
          lines.push(``);
          lines.push(`\u26a0\ufe0f **${totalErrors} error${totalErrors === 1 ? '' : 's'}** \u2014 check pipeline logs for details.`);
        }

        const content = lines.join('\n');
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, username: 'Invoice Pipeline' }),
        });
        log('Discord report posted to #accounting');
      }
    } catch (discordErr) {
      log(`Discord report failed (non-fatal): ${discordErr.message}`);
    }
  }

  return summary;
}

// --- Status ---
async function showStatus() {
  const classResult = await pool.query('SELECT classification, COUNT(*) as count FROM documents GROUP BY classification');
  const statusResult = await pool.query('SELECT status, COUNT(*) as count FROM documents GROUP BY status');
  const totalResult = await pool.query('SELECT COUNT(*) FROM documents');
  const processedResult = await pool.query('SELECT COUNT(*) FROM processed_emails');

  const byClassification = {};
  for (const r of classResult.rows) byClassification[r.classification] = parseInt(r.count, 10);
  const byStatus = {};
  for (const r of statusResult.rows) byStatus[r.status] = parseInt(r.count, 10);

  process.stdout.write(`${JSON.stringify({
    queueSize: parseInt(totalResult.rows[0].count, 10),
    processedEmails: parseInt(processedResult.rows[0].count, 10),
    byClassification,
    byStatus,
  }, null, 2)}\n`);

  await pool.end();
}

// --- CLI ---
if (require.main === module) {
  const cmd = process.argv[2];
  const isDry = process.argv.includes('--dry');

  switch (cmd) {
    case 'run':
      runPipeline({ dry: isDry })
        .then(async summary => {
          process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
          await pool.end();
        })
        .catch(async e => {
          logger.error({ err: e }, 'Pipeline error');
          await pool.end();
          process.exit(1);
        });
      break;
    case 'status':
      showStatus().catch((e) => { logger.error({ err: e }, 'Pipeline status command failed'); process.exit(1); });
      break;
    default:
      process.stdout.write('Usage:\n');
      process.stdout.write('  node modules/invoices/services/pipeline.js run          — full pipeline run\n');
      process.stdout.write('  node modules/invoices/services/pipeline.js run --dry    — dry run\n');
      process.stdout.write('  node modules/invoices/services/pipeline.js status       — queue status\n');
  }
}

module.exports = {
  applyPayAppNumbering,
  applyAmazonGLClassification,
  emitPipelineRulesAppliedEvent,
  attachExtractedPayloadToQueueEntry,
  autoLinkCommittedWaivers,
  beginEmailIngestionTransaction,
  buildCoiExtractionPrompt,
  buildStatementExtractionPrompt,
  enforceActiveClassification,
  normalizeClassificationName,
  buildExtractionPromptForClassification,
  classifyAndExtract,
  findJobRefInText,
  insertDocument,
  insertFilteredTrashDocument,
  isExtractionEnabledForClassification,
  isInvoiceLikeClassification,
  matchInvoiceData,
  matchPerTypeDocumentData,
  normalizeExtractedDates,
  normalizeExtractedFieldsForClassification,
  parseEmailBodyForJobData,
  materializeExhaustedRetryDocuments,
  runEmailIngestionTransaction,
  runPipeline,
  detectSplitCandidacy,
  downloadAttachments,
  shouldUseCombinedSinglePageInvoiceExtraction,
};
