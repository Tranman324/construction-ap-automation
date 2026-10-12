'use strict';
const { EmailError } = require('./errors');
const { directory, defaults, validAddress } = require('./directory');
const { attachment, content } = require('./content');
const { createOutbox } = require('./outbox');
const { sendCore } = require('./sendCore');
const { createReconciliationService } = require('./reconciliation');
const { resolveDocumentRecipient } = require('../recipientResolutionService');
const { isBlockedRecipient } = require('../recipientResolutionParsing');
const { touchVendorContact } = require('../vendorContactsService');
function createEmailService(deps) {
  const { pool, graph, fs, logger, config, loadJobPmMap, insertAuditEvent, touchVendorContact: touchContact = touchVendorContact } = deps;
  const outbox = createOutbox(pool, config);
  const reconciliation = createReconciliationService({ pool, graph, config, logger, insertAuditEvent });
  async function document(id) {
    const result = await pool.query(`SELECT id,email_message_id,email_from,email_subject,email_body,file_path,file_name,
      invoice_number,doc_title,vendor_name,amount,job_match_number,vendor_code FROM documents WHERE id=$1`, [id]);
    if (!result.rows[0]) throw new EmailError(404, 'Document not found', 'DOCUMENT_NOT_FOUND');
    return result.rows[0];
  }
  async function replyRecipient(doc, input) {
    const resolution = await resolveDocumentRecipient(doc, pool);
    if (resolution.recipientType === 'direct') return resolution.directEmail;
    const selected = String(input.recipient || '').trim().toLowerCase();
    if (!selected || !validAddress(selected)) {
      throw new EmailError(422, 'Choose a recipient before replying', 'EMAIL_RECIPIENT_SELECTION_REQUIRED', resolution);
    }
    // Manual entries are allowed, but never to billing platforms or automated mailboxes.
    if (isBlockedRecipient(selected)) {
      throw new EmailError(422, 'That address cannot receive replies (automated or platform mailbox)', 'EMAIL_RECIPIENT_BLOCKED', resolution);
    }
    return selected;
  }
  async function send(id, actor, input, token, kind) {
    if (config.disabled()) throw new EmailError(503, 'email_sends_disabled');
    actor = { ...actor, id: actor?.userId || actor?.id };
    if (!actor.id) throw new EmailError(401, 'Authentication required');
    const doc = await document(id);
    const identity = await pool.query('SELECT name FROM toolbox_users WHERE id=$1', [actor.id]);
    actor.name = identity.rows[0]?.name || actor.email;
    let recipients;
    if (kind === 'reply') {
      if (!doc.email_message_id) throw new EmailError(409, 'No source email thread', 'EMAIL_NO_THREAD');
      if (!validAddress(doc.email_from)) throw new EmailError(422, 'Invalid original sender', 'EMAIL_INVALID_SENDER');
      recipients = [await replyRecipient(doc, input)];
    } else {
      const users = await directory(graph, config);
      recipients = [...new Set(input.recipients)].map(id => users.find(u => u.userId === id)?.email);
      if (!recipients.length || recipients.some(u => !u)) throw new EmailError(400, 'Invalid internal recipients', 'EMAIL_INVALID_RECIPIENTS');
    }
    const { file, oversized } = await attachment(doc, fs);
    const message = { ...content(doc, actor, input, kind, oversized, config), preview: input.body.slice(0, 200) };
    const attemptId = await outbox.reserve(doc, actor, token, kind, message, recipients, Boolean(file));
    const outcome = await sendCore({ graph, outbox, logger, config, doc, kind, message, recipients, file, attemptId, actorId: actor.id });
    if (kind === 'reply' && doc.vendor_code) {
      try { await touchContact(doc.vendor_code, recipients[0], pool); }
      catch { logger.warn({ operation: 'email.vendor_contact_touch_failed', documentId: doc.id }, 'Confirmed reply contact touch failed'); }
    }
    // Pending sends skip the immediate audit event: the reconciliation sweep emits
    // the identical event when it confirms the attempt (avoids duplicate activity).
    if (!outcome?.pending) {
      try {
        await insertAuditEvent({ type: kind === 'reply' ? 'invoice.email_replied' : 'invoice.email_forwarded',
          actor: { userId: actor.id, name: actor.name || actor.email, role: actor.role?.name || actor.role },
          target: { type: 'invoice', id }, module: 'invoices', severity: 'info', undoable: false,
          summary: kind === 'reply' ? 'Email replied' : 'Email forwarded',
          changes: { to: recipients, subject: message.subject, bodyPreview: message.preview, attachedPdf: Boolean(file), attemptId },
        });
      } catch { logger.error({ operation: 'email.audit_failed', attemptId }, 'Confirmed email audit failed'); }
    }
    return { ok: true, sentTo: kind === 'reply' ? recipients[0] : recipients, ...(outcome?.pending ? { pending: true } : {}) };
  }
  return {
    sendReply: (id, actor, input, token) => send(id, actor, input, token, 'reply'),
    sendForward: (id, actor, input, token) => send(id, actor, input, token, 'forward'),
    getReplyRecipient: async id => resolveDocumentRecipient(await document(id), pool),
    getForwardDefaults: async id => defaults(await document(id), graph, config, loadJobPmMap),
    getEmailAttemptStatus: reconciliation.getStatus,
    reconcileEmailAttempt: reconciliation.reconcileAttempt,
    reconcileEmailSweep: reconciliation.reconcileSweep,
  };
}
let service;
function getService() {
  if (!service) service = createEmailService({ pool: require('../../../../lib/db'),
    graph: require('../../../../lib/graph').graphFetch, fs: require('node:fs/promises'),
    logger: require('../../../../lib/logger'), config: require('../../../../config').DOCUMENT_EMAIL,
    loadJobPmMap: require('../submitRouting').loadJobPmMap,
    insertAuditEvent: require('../../../../lib/auditEvents').insertAuditEvent });
  return service;
}
module.exports = { EmailError, createEmailService,
  sendReply: (...args) => getService().sendReply(...args),
  sendForward: (...args) => getService().sendForward(...args),
  getReplyRecipient: (...args) => getService().getReplyRecipient(...args),
  getForwardDefaults: (...args) => getService().getForwardDefaults(...args),
  getEmailAttemptStatus: (...args) => getService().getEmailAttemptStatus(...args),
  reconcileEmailAttempt: (...args) => getService().reconcileEmailAttempt(...args),
  reconcileEmailSweep: (...args) => getService().reconcileEmailSweep(...args) };
