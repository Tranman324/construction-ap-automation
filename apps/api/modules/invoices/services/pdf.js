'use strict';
/**
 * PDF utilities
 * - mergePdfs: merge invoice + waiver pages
 * - ensurePdf: recover missing PDFs from Graph API
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { pool } = require('./supabase');
const { INCOMING_DIR, INVOICE_MAILBOX: SHARED_MAILBOX } = require('../../../config');
const logger = require('../../../lib/logger');
const graph = require('../../../lib/graph');

/**
 * Merge two PDFs (invoice pages first, then waiver pages) into outputPath.
 */
async function mergePdfs(invoiceFilePath, waiverFilePath, outputPath) {
  const [invoiceBuf, waiverBuf] = await Promise.all([
    fs.promises.readFile(invoiceFilePath),
    fs.promises.readFile(waiverFilePath),
  ]);
  const [invoicePdf, waiverPdf] = await Promise.all([
    PDFDocument.load(invoiceBuf),
    PDFDocument.load(waiverBuf),
  ]);
  const merged = await PDFDocument.create();
  const invoicePages = await merged.copyPages(invoicePdf, invoicePdf.getPageIndices());
  for (const p of invoicePages) merged.addPage(p);
  const waiverPages = await merged.copyPages(waiverPdf, waiverPdf.getPageIndices());
  for (const p of waiverPages) merged.addPage(p);
  const mergedBytes = await merged.save();
  await fs.promises.writeFile(outputPath, mergedBytes);
  return outputPath;
}

/**
 * Recover a missing PDF from Microsoft Graph by re-downloading the email attachment.
 * Returns the file path on success, null on failure.
 */
async function recoverPdfFromGraph(docRow) {
  const messageId = docRow.email_message_id;
  const fileName = docRow.file_name;
  const docId = docRow.id;

  if (!messageId) {
    logger.warn({ docId }, 'Cannot recover PDF without email_message_id');
    return null;
  }

  try {
    logger.info({ docId, messageId }, 'Attempting PDF recovery from Graph');

    if (!fs.existsSync(INCOMING_DIR)) fs.mkdirSync(INCOMING_DIR, { recursive: true });

    const allAttachments = await graph.getAttachments(SHARED_MAILBOX, messageId);

    const attachments = allAttachments.filter(a =>
      a['@odata.type'] === '#microsoft.graph.fileAttachment'
    );
    let target = fileName
      ? attachments.find(a => a.name === fileName)
      : attachments.find(a => a.name && a.name.toLowerCase().endsWith('.pdf'));

    if (!target && attachments.length > 0) target = attachments[0];

    if (!target) {
      logger.warn({ docId, messageId }, 'No matching attachment found during PDF recovery');
      return null;
    }

    const recoveredPath = docRow.file_path || path.join(INCOMING_DIR, target.name);
    fs.writeFileSync(recoveredPath, Buffer.from(target.contentBytes, 'base64'));

    const stat = fs.statSync(recoveredPath);
    await pool.query(
      'UPDATE documents SET file_path = $1, file_size = $2, updated_at = $3 WHERE id = $4',
      [recoveredPath, stat.size, new Date().toISOString(), docId]
    );
    logger.info({ docId, fileName: target.name, fileSize: stat.size, recoveredPath }, 'Recovered PDF from Graph');
    await pool.query(
      'INSERT INTO audit_log (document_id, action, actor, changes) VALUES ($1, $2, $3, $4)',
      [docId, 'pdf-recovered', 'system', JSON.stringify({
        source: 'graph-api',
        emailMessageId: messageId,
        recoveredFile: target.name,
        fileSize: stat.size,
        originalPath: docRow.file_path || null,
        recoveredPath,
      })]
    );
    return recoveredPath;
  } catch (err) {
    logger.error({ err, docId, messageId }, 'PDF recovery failed');
    await pool.query(
      'INSERT INTO audit_log (document_id, action, actor, changes) VALUES ($1, $2, $3, $4)',
      [docId, 'pdf-recovery-failed', 'system', JSON.stringify({
        emailMessageId: messageId,
        error: err.message,
      })]
    ).catch(() => {});
    return null;
  }
}

/**
 * Ensure a document's PDF exists on disk, recovering from Graph if needed.
 * Returns the valid file path or null.
 */
async function ensurePdf(docRow) {
  if (docRow.file_path && fs.existsSync(docRow.file_path)) {
    return docRow.file_path;
  }
  return recoverPdfFromGraph(docRow);
}

module.exports = { mergePdfs, recoverPdfFromGraph, ensurePdf };
