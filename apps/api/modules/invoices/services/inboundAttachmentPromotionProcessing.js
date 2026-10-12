'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { convertToPdf, isWordDoc } = require('./docConvert');
const { sanitizeFilename } = require('./sanitize');
const { buildStoredFilename } = require('./file-types');
const { plainPreview } = require('./inboundCorrelationService');
const FILES_DIR = path.join(__dirname, '..', 'data', 'files');

class InboundAttachmentError extends Error {
  constructor(statusCode, message, code, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function normalizeInvoiceNumber(value) {
  if (!value) return value;
  const result = String(value).trim().replace(/^(INV(OICE)?|#|No\.?\s*)/i, '').trim();
  return /^\d[\d\s]+\d$/.test(result) ? result.replace(/\s+/g, '') : result;
}

async function processAttachment(source, item, buffer, dependencies) {
  const pipeline = dependencies.pipeline || require('./pipeline');
  const converter = dependencies.docConvert || { convertToPdf, isWordDoc };
  const safeName = sanitizeFilename(item.name || 'inbound-attachment');
  const tempPath = path.join(os.tmpdir(), `inbound-promotion-${randomUUID()}-${safeName}`);
  let classificationPath = tempPath;
  try {
    fs.writeFileSync(tempPath, buffer);
    if (converter.isWordDoc(tempPath)) classificationPath = converter.convertToPdf(tempPath);
    const emailContext = {
      subject: source.subject || '',
      body: plainPreview(source.sanitized_body_html || source.body_preview || ''),
      messageId: source.graph_message_id,
      fileName: safeName,
    };
    const result = await pipeline.classifyAndExtract(classificationPath, emailContext);
    if (['skipped', 'unsupported', 'error'].includes(result.classification)) {
      throw new InboundAttachmentError(422, 'Attachment could not be processed', 'INBOUND_ATTACHMENT_NOT_PROCESSABLE', { classification: result.classification });
    }
    const classification = await pipeline.enforceActiveClassification(result.classification, 'inbound-attachment-promotion');
    const entry = {
      id: `doc-${Date.now()}-${randomUUID().slice(0, 8)}`, runId: `inbound-promotion-${source.source_email_message_id}`,
      classification, confidence: result.confidence || null, file: path.basename(classificationPath),
      pdfBase64: fs.readFileSync(classificationPath).toString('base64'), pdfSize: fs.statSync(classificationPath).size,
      status: 'pending', queuedAt: new Date().toISOString(), sourceDocumentId: source.source_document_id,
      sourceEmailMessageId: source.source_email_message_id, sourceAttachmentId: item.id,
      email: { messageId: source.graph_message_id, conversationId: source.conversation_id, from: source.from_address,
        subject: source.subject, receivedAt: source.received_at, bodyPreview: emailContext.body, body: null },
      extracted: result.extracted || null,
    };
    if (pipeline.isInvoiceLikeClassification(classification) && result.extracted) {
      pipeline.normalizeExtractedDates(result.extracted, source.received_at);
      result.extracted.invoiceNumber = normalizeInvoiceNumber(result.extracted.invoiceNumber);
      const emailData = pipeline.parseEmailBodyForJobData(emailContext.body, source.subject || '');
      if (emailData.jobNumber && !result.extracted.jobNumber) result.extracted.jobNumber = emailData.jobNumber;
      if (emailData.projectName && !result.extracted.projectName) result.extracted.projectName = emailData.projectName;
      entry.matching = await pipeline.matchInvoiceData(result.extracted, source.from_address || '', source.subject || '', emailData);
    } else if (result.extracted && pipeline.isExtractionEnabledForClassification(classification)) {
      entry.extracted = pipeline.normalizeExtractedFieldsForClassification(classification, result.extracted, { emailSubject: source.subject, emailBody: emailContext.body });
      entry.matching = await pipeline.matchPerTypeDocumentData(classification, entry.extracted, { emailSubject: source.subject, documentId: entry.id });
    }
    return { entry, classification, storedFilePath: path.join(FILES_DIR, buildStoredFilename(entry.id, entry.file, classificationPath)) };
  } finally {
    fs.rmSync(tempPath, { force: true });
    if (classificationPath !== tempPath) fs.rmSync(classificationPath, { force: true });
  }
}

module.exports = { InboundAttachmentError, processAttachment };
