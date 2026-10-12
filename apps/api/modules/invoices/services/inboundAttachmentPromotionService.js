'use strict';
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../../../lib/db');
const graph = require('../../../lib/graph');
const { insertAuditEvent } = require('../../../lib/auditEvents');
const { resolveActor } = require('../../../lib/invoiceAuditActor');
const { withTransaction } = require('./transaction');
const { INVOICE_MAILBOX: MAILBOX } = require('../../../config');
const { InboundAttachmentError, processAttachment } = require('./inboundAttachmentPromotionProcessing');
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const FILES_DIR = path.join(__dirname, '..', 'data', 'files');

function actorId(actor) { return actor?.userId || actor?.id || actor?.email || 'system'; }

async function loadSource(documentId, db) {
  const result = await db.query(`SELECT d.id AS source_document_id, m.id AS source_email_message_id,
      m.graph_message_id, m.internet_message_id, m.conversation_id, m.kind,
      m.direction, m.correlation_state, m.correlation_reason, m.from_address,
      m.subject, m.body_preview, m.sanitized_body_html, m.received_at,
      m.has_attachments, m.attachment_reviewed
    FROM documents d JOIN document_email_messages m ON m.document_id = d.id
    WHERE d.id = $1 AND d.deleted_at IS NULL AND m.direction = 'in'
    ORDER BY m.received_at DESC NULLS LAST, m.created_at DESC, m.id DESC LIMIT 1`, [documentId]);
  const source = result.rows[0];
  if (!source) throw new InboundAttachmentError(404, 'Inbound message not found', 'INBOUND_MESSAGE_NOT_FOUND');
  if (source.kind === 'ndr') throw new InboundAttachmentError(422, 'Delivery-failure messages cannot be promoted', 'INBOUND_NDR_NOT_PROMOTABLE');
  if (source.correlation_state === 'ambiguous') {
    throw new InboundAttachmentError(409, 'Ambiguous inbound message is held for review', 'INBOUND_MESSAGE_AMBIGUOUS', {
      reason: source.correlation_reason || 'ambiguous-correlation',
    });
  }
  if (source.correlation_state !== 'matched') {
    throw new InboundAttachmentError(409, 'Inbound message is not eligible for attachment promotion', 'INBOUND_MESSAGE_NOT_CORRELATED');
  }
  if (!source.has_attachments) {
    throw new InboundAttachmentError(422, 'Inbound message has no attachments', 'INBOUND_MESSAGE_NO_ATTACHMENTS');
  }
  if (!source.graph_message_id) {
    throw new InboundAttachmentError(410, 'The mailbox source is no longer available', 'INBOUND_SOURCE_UNAVAILABLE');
  }
  return source;
}

function fileAttachment(item) {
  return item && item['@odata.type'] === '#microsoft.graph.fileAttachment' && item.id ? item : null;
}

async function listSourceAttachments(documentId, options = {}) {
  const db = options.db || pool;
  const source = await loadSource(documentId, db);
  let items;
  try { items = await (options.mailbox || graph).getAttachments(options.mailboxName || MAILBOX, source.graph_message_id); }
  catch { throw new InboundAttachmentError(410, 'The mailbox source is no longer available', 'INBOUND_SOURCE_UNAVAILABLE'); }
  const attachments = (items || []).map(fileAttachment).filter(Boolean).map((item) => ({
    attachmentId: item.id,
    name: String(item.name || 'attachment'),
    contentType: item.contentType || 'application/octet-stream',
    sizeBytes: Number.isFinite(item.size) ? item.size : null,
    isInline: Boolean(item.isInline),
    eligible: true,
  }));
  return { documentId, messageId: source.source_email_message_id, attachments };
}

async function fetchAttachment(source, attachmentId, options) {
  let listed;
  try {
    const items = await (options.mailbox || graph).getAttachments(options.mailboxName || MAILBOX, source.graph_message_id);
    listed = (items || []).find(item => item?.id === attachmentId);
  } catch {
    throw new InboundAttachmentError(410, 'The mailbox source is no longer available', 'INBOUND_SOURCE_UNAVAILABLE');
  }
  if (!listed || !fileAttachment(listed)) {
    throw new InboundAttachmentError(404, 'Attachment not found', 'INBOUND_ATTACHMENT_NOT_FOUND');
  }

  let item;
  try {
    item = await (options.mailbox || graph).downloadAttachment(options.mailboxName || MAILBOX, source.graph_message_id, attachmentId);
  } catch { throw new InboundAttachmentError(410, 'The mailbox source is no longer available', 'INBOUND_SOURCE_UNAVAILABLE'); }
  if (!item) throw new InboundAttachmentError(410, 'The attachment content is no longer available', 'INBOUND_ATTACHMENT_UNAVAILABLE');
  if (!fileAttachment(item) || item.id !== attachmentId) {
    throw new InboundAttachmentError(404, 'Attachment not found', 'INBOUND_ATTACHMENT_NOT_FOUND');
  }
  const buffer = Buffer.isBuffer(item.buffer)
    ? item.buffer
    : item.contentBytes ? Buffer.from(item.contentBytes, 'base64') : null;
  if (!buffer) throw new InboundAttachmentError(410, 'The attachment content is no longer available', 'INBOUND_ATTACHMENT_UNAVAILABLE');
  if (buffer.length > MAX_FILE_BYTES) throw new InboundAttachmentError(413, 'Attachment exceeds the 25 MB limit', 'INBOUND_ATTACHMENT_TOO_LARGE');
  return { item, buffer };
}

async function getAttachment(documentId, attachmentId, options = {}) {
  const db = options.db || pool;
  const source = await loadSource(documentId, db);
  const { item, buffer } = await fetchAttachment(source, attachmentId, options);
  return { source, item, buffer };
}

async function promoteAttachment(documentId, attachmentId, actor, options = {}) {
  const dependencies = options.dependencies || {};
  const dbPool = options.db || pool;
  return withTransaction(dbPool, async (db) => {
    const source = await loadSource(documentId, db);
    const reservationId = `promotion-${source.source_email_message_id}-${attachmentId}`;
    const reserved = await db.query(`INSERT INTO document_inbound_promotions
      (id, source_document_id, source_email_message_id, source_attachment_id, status, actor_user_id)
      VALUES ($1,$2,$3,$4,'reserved',$5) ON CONFLICT (source_email_message_id, source_attachment_id) DO NOTHING RETURNING id`,
    [reservationId, source.source_document_id, source.source_email_message_id, attachmentId, actorId(actor)]);
    if (!reserved.rows?.length) {
      const prior = await db.query(`SELECT status, resulting_document_id FROM document_inbound_promotions
        WHERE source_email_message_id=$1 AND source_attachment_id=$2 FOR UPDATE`, [source.source_email_message_id, attachmentId]);
      if (prior.rows[0]?.status === 'completed') return { promoted: true, duplicate: true, documentId: prior.rows[0].resulting_document_id,
        sourceDocumentId: source.source_document_id, sourceEmailMessageId: source.source_email_message_id };
      throw new InboundAttachmentError(409, 'Attachment promotion is already in progress', 'INBOUND_PROMOTION_IN_PROGRESS');
    }
    const { item, buffer } = await fetchAttachment(source, attachmentId, options);
    const processed = await processAttachment(source, item, buffer, dependencies);
    try {
      await (dependencies.insertDocument || require('./pipeline').insertDocument)(processed.entry, db);
      await db.query(`UPDATE documents SET source_document_id=$1, source_email_message_id=$2, source_attachment_id=$3 WHERE id=$4`,
        [source.source_document_id, source.source_email_message_id, item.id, processed.entry.id]);
      await db.query(`UPDATE document_inbound_promotions SET status='completed', resulting_document_id=$2, completed_at=NOW() WHERE id=$1`, [reservationId, processed.entry.id]);
      await db.query(`UPDATE document_email_messages SET attachment_reviewed=true WHERE id=$1`, [source.source_email_message_id]);
      const identity = dependencies.resolveActor ? await dependencies.resolveActor(actor, db) : await resolveActor(actor || {}, db);
      const audit = dependencies.insertAuditEvent || insertAuditEvent;
      await audit({ type: 'invoice.inbound_attachment_promoted', actor: identity, target: { type: 'invoice', id: documentId },
        module: 'invoices', severity: 'info', undoable: false, summary: 'Inbound attachment promoted',
        changes: { sourceDocumentId: documentId, sourceEmailMessageId: source.source_email_message_id, sourceAttachmentId: item.id, resultingDocumentId: processed.entry.id, classification: processed.classification } }, db);
      await db.query('INSERT INTO audit_log (document_id, action, actor, changes) VALUES ($1,$2,$3,$4)',
        [documentId, 'inbound-attachment-promoted', identity.userId || identity.name || actorId(actor), JSON.stringify({ sourceAttachmentId: item.id, resultingDocumentId: processed.entry.id, classification: processed.classification })]);
      return { promoted: true, duplicate: false, documentId: processed.entry.id, sourceDocumentId: documentId, sourceEmailMessageId: source.source_email_message_id };
    } catch (error) {
      fs.rmSync(processed.storedFilePath, { force: true });
      throw error;
    }
  });
}
module.exports = { InboundAttachmentError, getAttachment, listSourceAttachments, promoteAttachment };
