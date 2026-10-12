'use strict';

/**
 * Attach File Service — manual PDF upload for link-only emails
 *
 * Some invoicing platforms (Skynova, etc.) send emails containing only a
 * download link instead of an attached PDF. The pipeline queues these as
 * classification='no-attachment' with the email body preserved. The user
 * opens the email preview, clicks the link (human passes Cloudflare),
 * downloads the PDF, and drops it on the document's upload zone.
 *
 * This service:
 *   1. Validates the document is eligible (no existing file)
 *   2. Stores the file using pipeline storage conventions (FILES_DIR)
 *   3. Runs the SAME classify → extract → match logic as the email pipeline
 *      (reused via pipeline.js exports — zero duplicated logic)
 *   4. Updates the SAME document row in place (id, email context, audit
 *      history all preserved)
 *   5. Best-effort: appends the PDF to the original email in the shared
 *      mailbox via Graph, so the email permanently carries the attachment.
 *      Graph failure does NOT fail the upload — the stored file is the
 *      processing source of truth.
 *
 * Multi-job invoices: the email pipeline splits multi-job invoices into
 * one document per line item. That split path requires creating NEW rows,
 * which conflicts with in-place reprocessing. For simplicity and safety,
 * a multi-job invoice uploaded through this path is processed as a single
 * document and flagged for manual split (same as the manual-split-only
 * policy from 2026-07-01).
 */

const fs = require('fs');
const path = require('path');

const { pool, audit } = require('./supabase');
const { graphFetch } = require('../../../lib/graph');
const logger = require('../../../lib/logger');
const { detectFileType, buildStoredFilename } = require('./file-types');
const { convertToPdf, isWordDoc } = require('./docConvert');
const { mergeReextractedStatementAttributes } = require('./statementAttributes');
const { sanitizeFilename } = require('./sanitize');

// Same storage location + mailbox the pipeline uses
const { FILES_DIR, INVOICE_MAILBOX: MAILBOX } = require('../../../config');

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB — Graph attachment single-shot limit is 3MB base64; larger files skip the Graph append
const GRAPH_ATTACH_LIMIT_BYTES = 3 * 1024 * 1024;

// Classifications that may NOT receive a manual file upload.  Submitted/approved
// docs are excluded via the status check below; this blocks only classifications
// where an upload makes no semantic sense (e.g. 'skipped' junk).
const INELIGIBLE_CLASSIFICATIONS = new Set(['skipped']);

/**
 * Attach an uploaded file to an existing document and reprocess it in place.
 *
 * @param {string} documentId - Target document (must be attachment-less)
 * @param {object} file - Multer file object ({ buffer, originalname, size, mimetype })
 * @param {object} user - Requesting user (needs .id or .email)
 * @param {object} [opts]
 * @param {object} [opts.req] - Express req (for structured audit events)
 * @param {object} [opts.res] - Express res (for structured audit events)
 * @returns {{ success: true, documentId, classification, extracted, matching }}
 */
async function attachFileAndReprocess(documentId, file, user, opts = {}) {
  const actor = user?.id || user?.email || 'system';

  // ── 1. Load + validate document ──────────────────────────────────────────
  const docResult = await pool.query(
    `SELECT id, classification, status, file_name, file_path,
            email_message_id, email_conversation_id, email_from, email_subject,
            email_received_at, email_body, email_body_preview, email_body_content_type,
            statement_attributes
     FROM documents WHERE id = $1 AND deleted_at IS NULL`,
    [documentId]
  );
  const doc = docResult.rows[0];
  if (!doc) {
    const err = new Error('Document not found');
    err.statusCode = 404;
    throw err;
  }
  if (doc.file_path || doc.file_name) {
    const err = new Error('Document already has a file attached');
    err.statusCode = 409;
    throw err;
  }
  if (INELIGIBLE_CLASSIFICATIONS.has(doc.classification)) {
    const err = new Error(
      `Documents classified as '${doc.classification}' cannot accept manual file uploads`
    );
    err.statusCode = 422;
    throw err;
  }
  if (!['pending', 'modified'].includes(doc.status)) {
    const err = new Error(`Document status must be pending or modified (currently '${doc.status}')`);
    err.statusCode = 422;
    throw err;
  }

  // ── 2. Validate + store the file ──────────────────────────────────────────
  if (!file?.buffer?.length) {
    const err = new Error('No file uploaded');
    err.statusCode = 400;
    throw err;
  }
  if (file.buffer.length > MAX_FILE_BYTES) {
    const err = new Error(`File too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)`);
    err.statusCode = 413;
    throw err;
  }

  const incomingName = file.originalname || 'upload.pdf';
  const incomingExtension = path.extname(incomingName);
  const safeExtension = /^\.[a-z0-9]{1,5}$/i.test(incomingExtension)
    ? incomingExtension.toLowerCase()
    : '';
  const originalStem = incomingExtension
    ? incomingName.slice(0, -incomingExtension.length)
    : incomingName;
  const sanitizedStem = sanitizeFilename(originalStem);
  const safeStem = sanitizedStem === 'unnamed' && originalStem.trim() !== 'unnamed'
    ? 'upload'
    : sanitizedStem;
  let originalName = `${safeStem.slice(0, 200 - safeExtension.length)}${safeExtension}`;

  // Write to a temp path first so detectFileType can sniff magic bytes
  fs.mkdirSync(FILES_DIR, { recursive: true });
  let storedName = buildStoredFilename(documentId, originalName, null);
  let storedPath = path.join(FILES_DIR, storedName);
  const tmpPath = `${storedPath}.uploading`;
  fs.writeFileSync(tmpPath, file.buffer);

  let fileType;
  let wordTmpPath = null;
  try {
    // Convert Word docs to PDF before the type gate
    if (/\.docx?$/i.test(originalName)) {
      // LO needs the correct extension to identify the format — rename from .uploading
      const wordExt = path.extname(originalName).toLowerCase();
      wordTmpPath = tmpPath.replace(/\.uploading$/, wordExt);
      fs.renameSync(tmpPath, wordTmpPath);
      const pdfPath = convertToPdf(wordTmpPath);
      // convertToPdf deletes the original; pdfPath is the new file
      originalName = originalName.replace(/\.docx?$/i, '.pdf');
      storedName = buildStoredFilename(documentId, originalName, null);
      storedPath = path.join(FILES_DIR, storedName);
      fs.renameSync(pdfPath, storedPath);
      fileType = detectFileType(storedPath, originalName);
    } else {
      fileType = detectFileType(tmpPath, originalName);
      if (!fileType.isPdf && !fileType.isImage) {
        const err = new Error(`Unsupported file type '${fileType.ext || 'unknown'}' — upload a PDF or image`);
        err.statusCode = 422;
        throw err;
      }
      fs.renameSync(tmpPath, storedPath);
    }
  } catch (e) {
    fs.rmSync(tmpPath, { force: true });
    if (wordTmpPath) fs.rmSync(wordTmpPath, { force: true });
    throw e;
  }

  // ── 3. Reprocess: classify → extract → match (pipeline exports) ──────────
  // Lazy-require: pipeline.js has module-level side effects (dir creation) and
  // a heavy dependency tree; only load it when an upload actually happens.
  const {
    classifyAndExtract,
    matchInvoiceData,
    normalizeExtractedDates,
    normalizeExtractedFieldsForClassification,
    parseEmailBodyForJobData,
    isInvoiceLikeClassification,
    enforceActiveClassification,
  } = require('./pipeline');

  let classResult;
  try {
    classResult = await classifyAndExtract(storedPath, {
      subject: doc.email_subject || '',
      body: doc.email_body || null,
      messageId: doc.email_message_id || null,
      fileName: originalName,
    });
  } catch (e) {
    // Classification blew up — keep the file but surface the error; the doc
    // stays eligible for another attempt.
    fs.rmSync(storedPath, { force: true });
    const err = new Error(`Document processing failed: ${e.message}`);
    err.statusCode = 500;
    throw err;
  }

  if (classResult.classification === 'skipped') {
    fs.rmSync(storedPath, { force: true });
    const err = new Error(`File rejected: ${classResult.reason || 'not a processable document'}`);
    err.statusCode = 422;
    throw err;
  }

  const classification = await enforceActiveClassification(
    classResult.classification,
    'attach-file'
  );

  // ── 4. Build the update ───────────────────────────────────────────────────
  const update = {
    classification,
    confidence: classResult.confidence || null,
    file_name: originalName,
    file_path: storedPath,
    file_size_bytes: file.buffer.length,
    flagged: false,
    notes: null,
    rejection_reason: null,
  };

  let matching = null;
  let statementExtracted = null;
  if (isInvoiceLikeClassification(classification) && classResult.extracted) {
    normalizeExtractedDates(classResult.extracted, doc.email_received_at);

    // Same invoice-number normalization as the pipeline (INV prefix, spaces)
    if (classResult.extracted.invoiceNumber) {
      let inv = classResult.extracted.invoiceNumber.trim();
      inv = inv.replace(/^(INV(OICE)?|#|No\.?\s*)/i, '').trim();
      if (/^\d[\d\s]+\d$/.test(inv)) inv = inv.replace(/\s+/g, '');
      classResult.extracted.invoiceNumber = inv;
    }

    // Supplement with email body job data (never override PDF data)
    const emailJobData = parseEmailBodyForJobData(doc.email_body || '', doc.email_subject || '') || {};
    if (emailJobData.jobNumber && !classResult.extracted.jobNumber) {
      classResult.extracted.jobNumber = emailJobData.jobNumber;
    }
    if (emailJobData.projectName && !classResult.extracted.projectName) {
      classResult.extracted.projectName = emailJobData.projectName;
    }

    matching = await matchInvoiceData(classResult.extracted, doc.email_from || '', doc.email_subject || '', emailJobData);

    const ext = classResult.extracted;
    Object.assign(update, {
      vendor_name: ext.vendorName || null,
      vendor_address: ext.vendorAddress || null,
      invoice_number: ext.invoiceNumber || null,
      invoice_date: ext.invoiceDate || null,
      due_date: ext.dueDate || null,
      amount: ext.amount || null,
      job_number: ext.jobNumber || null,
      project_name: ext.projectName || null,
      project_address: ext.projectAddress || null,
      description: ext.description || null,
      line_items: JSON.stringify(ext.lineItems || []),
      vendor_code: matching.vendor?.vendorCode || null,
      vendor_match_confidence: matching.vendor?.confidence || null,
      vendor_match_method: matching.vendor?.method || null,
      matched_vendor_name: matching.vendor?.vendorName || null,
      job_match_number: matching.job?.jobNumber || null,
      job_match_confidence: matching.job?.confidence || null,
      job_match_method: matching.job?.method || null,
      subcontract_number: matching.subcontract?.subcontractNumber || null,
      subcontract_match_confidence: matching.subcontract?.confidence || null,
      subcontract_match_method: matching.subcontract?.method || null,
      overall_confidence: matching.overallConfidence || null,
    });
  } else if (classResult.extracted) {
    // Non-invoice classification with extraction (receipt, COI, statement…)
    const normalized = normalizeExtractedFieldsForClassification(
      classification,
      classResult.extracted,
      { emailSubject: doc.email_subject, emailBody: doc.email_body }
    ) || classResult.extracted;
    Object.assign(update, {
      vendor_name: normalized.vendorName || null,
      invoice_number: normalized.invoiceNumber || null,
      invoice_date: normalized.invoiceDate || null,
      amount: normalized.amount || null,
      description: normalized.description || null,
    });
    if (classification === 'statement') {
      statementExtracted = normalized;
      update.statement_attributes = JSON.stringify(
        mergeReextractedStatementAttributes(doc.statement_attributes, normalized)
      );
    }
  }

  if (classResult.classification === 'error') {
    update.flagged = true;
    update.notes = `[${classResult.stage || 'classification'}] ${classResult.reason || 'Unknown error'}`;
  }

  // ── 5. Persist atomically ─────────────────────────────────────────────────
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (statementExtracted) {
      const locked = await client.query('SELECT statement_attributes FROM documents WHERE id = $1 FOR UPDATE', [documentId]);
      update.statement_attributes = JSON.stringify(mergeReextractedStatementAttributes(
        locked.rows[0]?.statement_attributes,
        statementExtracted
      ));
    }
    // Bind statement attributes after the lock so the write cannot reuse the
    // value loaded before extraction and matching completed.
    const setClauses = [];
    const values = [documentId];
    let i = 2;
    for (const [col, val] of Object.entries(update)) {
      setClauses.push(`${col} = $${i}`);
      values.push(val);
      i++;
    }
    // BE-G: attach-file values come from automated extraction + matching, not
    // user input — stamp 'derived' for FIELD_MAP-backed columns in the same
    // statement so a pre-attach manual edit that gets overwritten here can
    // never keep a stale 'manual' (violet) origin.
    const { FIELD_MAP } = require('./invoiceEditService');
    const columnToCamel = {};
    for (const [camel, col] of Object.entries(FIELD_MAP)) {
      if (!(col in columnToCamel)) columnToCamel[col] = camel; // first mapping wins (description over notes)
    }
    const originPatch = {};
    const originAt = new Date().toISOString();
    for (const col of Object.keys(update)) {
      const camel = columnToCamel[col];
      if (camel) originPatch[camel] = { origin: 'derived', at: originAt, by: 'attach-file' };
    }
    let originClause = '';
    if (Object.keys(originPatch).length > 0) {
      values.push(JSON.stringify(originPatch));
      originClause = `, field_origins = field_origins || $${values.length}::jsonb`;
    }
    await client.query(
      `UPDATE documents SET ${setClauses.join(', ')}${originClause}, updated_at = NOW() WHERE id = $1`,
      values
    );
    await client.query(
      'INSERT INTO audit_log (document_id, action, actor, changes) VALUES ($1, $2, $3, $4)',
      [documentId, 'file-attached', actor, JSON.stringify({
        fileName: originalName,
        fileSizeBytes: file.buffer.length,
        classification,
        previousClassification: doc.classification,
        vendorCode: matching?.vendor?.vendorCode || null,
        invoiceNumber: classResult.extracted?.invoiceNumber || null,
        method: 'manual-upload',
      })]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    fs.rmSync(storedPath, { force: true });
    throw e;
  } finally {
    client.release();
  }

  logger.info(`File attached to ${documentId} by ${actor}: ${originalName} → ${classification}`);

  // ── 6. Best-effort: append PDF to the original email via Graph ───────────
  let emailAttached = false;
  if (doc.email_message_id && file.buffer.length <= GRAPH_ATTACH_LIMIT_BYTES) {
    try {
      await graphFetch(`/users/${MAILBOX}/messages/${doc.email_message_id}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: originalName,
          contentType: fileType.isPdf ? 'application/pdf' : (file.mimetype || 'application/octet-stream'),
          contentBytes: file.buffer.toString('base64'),
        }),
      });
      emailAttached = true;
      logger.info(`Appended ${originalName} to email ${doc.email_message_id} in ${MAILBOX}`);
    } catch (e) {
      // Never fail the upload over this — the stored file is the source of truth
      logger.warn(`Could not append attachment to source email for ${documentId}: ${e.message}`);
    }
  } else if (doc.email_message_id) {
    logger.info(`Skipping Graph append for ${documentId} — file exceeds ${GRAPH_ATTACH_LIMIT_BYTES / 1024 / 1024}MB single-shot limit`);
  }

  return {
    success: true,
    documentId,
    classification,
    flagged: update.flagged,
    notes: update.notes,
    emailAttached,
    extracted: classResult.extracted || null,
    matching: matching ? {
      vendorCode: matching.vendor?.vendorCode || null,
      jobNumber: matching.job?.jobNumber || null,
      subcontractNumber: matching.subcontract?.subcontractNumber || null,
      overallConfidence: matching.overallConfidence || null,
    } : null,
  };
}

module.exports = { attachFileAndReprocess };
