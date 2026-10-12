'use strict';

/**
 * Lien Waiver Request Service
 *
 * Sends a waiver request email as a reply on the original invoice email thread
 * via Microsoft Graph. The vendor sees the request in context of their original
 * invoice submission, with the fillable waiver PDF attached directly.
 *
 * Business rule (per Dana, 2026-07-14): Both interim and final waivers are
 * conditional. Unconditional waivers are only requested when the customer
 * requires it post-payment — not part of this automated flow.
 */

const path = require('path');
const fs = require('fs');
const { graphFetch } = require('../../../lib/graph');
const { emitInvoiceAuditEvent } = require('../../../lib/auditEvents');
const { pool, audit } = require('./supabase');
const { recordOutboundMessage } = require('./inboundCorrelationService');
const { stampSubjectRefTag, buildBodyToken } = require('./refTag');
const logger = require('../../../lib/logger');
const {
  validateRecipientOverride,
} = require('./waiverRecipientParsing');

// Load email template once at startup
const TEMPLATE_PATH = path.resolve(__dirname, '../../../templates/lien-waiver-request.html');
let EMAIL_TEMPLATE;
try {
  EMAIL_TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
} catch (err) {
  logger.error(`Failed to load lien waiver email template from ${TEMPLATE_PATH}: ${err.message}`);
  EMAIL_TEMPLATE = null;
}

const MAILBOX = process.env.INVOICE_MAILBOX || 'invoices@northwindcg.example';

/**
 * Strip any leading RE:/FW:/FWD: chains from a subject so we don't stack
 * prefixes (vendor subjects frequently already start with RE: or FW:).
 */
function baseSubject(subject) {
  return (subject || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim();
}

/**
 * True when a Graph error indicates the source message no longer exists
 * (deleted or moved out of the mailbox) — a 404 on the reply-creation call.
 * `graphFetch` throws `Error('Graph 404 Not Found: ...')` on non-2xx responses;
 * only a 404 triggers the fresh-email fallback. Any other Graph error still
 * propagates as before.
 */
function isSourceMessageGone(err) {
  return Boolean(err && typeof err.message === 'string' && /Graph 404\b/.test(err.message));
}

/**
 * Send a waiver request email as a reply on the original invoice email thread.
 * Subject: "RE: {original subject, prefixes stripped} — Lien Waiver Request".
 *
 * Double-send guard: if a request was already sent (waiver_requested_at set),
 * the call is rejected with 409 unless opts.resend is true — the frontend
 * "Resend Request" button passes resend explicitly.
 *
 * @param {string} documentId - Document ID from the documents table
 * @param {object} user - Requesting user (needs .id or .email)
 * @param {object} [opts]
 * @param {boolean} [opts.resend] - Allow re-sending after a prior request
 * @param {string} [opts.recipientOverride] - Confirmed external vendor email
 * @param {object} [opts.req] - Express req (for structured audit events)
 * @param {object} [opts.res] - Express res (for structured audit events)
 * @returns {{success: boolean, sentTo: string, requestedAt: string, invoiceRow: object}}
 */
async function requestWaiver(documentId, user, opts = {}) {
  if (!EMAIL_TEMPLATE) {
    const err = new Error('Lien waiver email template not found. Check templates/lien-waiver-request.html');
    err.statusCode = 500;
    throw err;
  }

  const docResult = await pool.query(
    `SELECT id, email_message_id, email_from, email_subject, vendor_name,
            vendor_code, job_match_number, waiver_requested_at, classification,
            waiver_request_conversation_id
     FROM documents WHERE id = $1`,
    [documentId]
  );

  const doc = docResult.rows[0];
  if (!doc) {
    const err = new Error('Document not found');
    err.statusCode = 404;
    throw err;
  }

  const WAIVER_ELIGIBLE_CLASSIFICATIONS = new Set(['invoice', 'pay-application']);
  if (!WAIVER_ELIGIBLE_CLASSIFICATIONS.has(doc.classification)) {
    const err = new Error(
      `Waiver requests can only be sent for invoice or pay-application documents (got: ${doc.classification})`
    );
    err.statusCode = 422;
    throw err;
  }

  if (!doc.email_message_id) {
    const err = new Error(
      'No source email on file for this document. Waiver must be requested manually.'
    );
    err.statusCode = 422;
    throw err;
  }

  // Double-send guard: block accidental duplicates; explicit resend allowed.
  if (doc.waiver_requested_at && opts.resend !== true) {
    const err = new Error(
      `A waiver request was already sent ${new Date(doc.waiver_requested_at).toISOString()}. Pass resend to send another.`
    );
    err.statusCode = 409;
    throw err;
  }

  const recipientOverride = opts.recipientOverride
    ? validateRecipientOverride(opts.recipientOverride)
    : null;
  // Trust gate (2026-07-15): without an explicit recipientOverride, the sender
  // must be positively linked to the document's vendor (domain in
  // vendor_mappings or cached vendor_email). Blocklist alone is not enough —
  // unknown billing platforms (e.g. Skynova pre-2026-07-15) would pass it and
  // the request would go to a dead noreply/support address.
  if (!recipientOverride) {
    const { checkSenderTrust } = require('./waiverRecipientService');
    const { trusted } = await checkSenderTrust(doc);
    if (!trusted) {
      const err = new Error('Confirm a vendor recipient before requesting this waiver');
      err.statusCode = 422;
      throw err;
    }
  }
  const sentTo = recipientOverride || doc.email_from;

  const actor = user?.id || user?.email || 'system';

  // Build the subject: RE: {original subject} — Lien Waiver Request
  // (leading RE:/FW: chains stripped so prefixes don't stack). The fresh-email
  // fallback drops the RE: prefix since there is no thread being replied to.
  const originalSubject = baseSubject(doc.email_subject) || 'Invoice';
  const replySubject = stampSubjectRefTag(`RE: ${originalSubject} — Lien Waiver Request`, documentId);
  const freshSubject = stampSubjectRefTag(`${originalSubject} — Lien Waiver Request`, documentId);
  let sentGraphMessageId = null;
  let sentInternetMessageId = null;

  // Send a fresh (non-reply) templated message to the resolved recipient when
  // the original thread is gone. No quoted chain; best-effort draft cleanup on
  // send failure, mirroring the reply path.
  async function sendFreshWaiverEmail(recipient, subject) {
    const created = await graphFetch(`/users/${MAILBOX}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        subject,
        body: { contentType: 'HTML', content: EMAIL_TEMPLATE + buildBodyToken(documentId) },
        toRecipients: [{ emailAddress: { address: recipient } }],
      }),
    });
    if (!created?.id) {
      throw new Error('Graph createMessage did not return a message id');
    }
    sentGraphMessageId = created.id;
    try {
      await graphFetch(`/users/${MAILBOX}/messages/${created.id}/send`, { method: 'POST' });
    } catch (sendErr) {
      try {
        await graphFetch(`/users/${MAILBOX}/messages/${created.id}`, { method: 'DELETE' });
      } catch (cleanupErr) {
        logger.error(`Failed to delete stranded fresh waiver draft ${created.id}: ${cleanupErr.message}`);
      }
      throw sendErr;
    }
    return typeof created.conversationId === 'string' && created.conversationId.trim()
      ? created.conversationId
      : null;
  }

  let sendMethod = 'email-reply';
  let sentSubject = replySubject;
  let requestConversationId = null;

  // Create a reply DRAFT so Graph builds the quoted original chain (From/
  // Sent/To/Subject header + prior thread) exactly like a normal Outlook
  // reply, then prepend our template above the quote and send. Overriding
  // message.body on a direct /reply call would REPLACE the body and drop the
  // vendor's original email — the whole point of replying is that context.
  let draft = null;
  try {
    draft = await graphFetch(
      `/users/${MAILBOX}/messages/${doc.email_message_id}/createReply`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  } catch (replyErr) {
    if (!isSourceMessageGone(replyErr)) throw replyErr;
    // Source email was deleted/moved in Graph: the reply thread no longer
    // exists. Send a fresh templated request instead of failing (M-085).
    logger.info(
      {
        operation: 'invoice.waiver.fresh_email_fallback',
        context: { documentId, sentTo, emailMessageId: doc.email_message_id, reason: 'source_message_gone' },
      },
      'Waiver source email missing in Graph; sent fresh templated request'
    );
    sendMethod = 'email-fresh';
    sentSubject = freshSubject;
    requestConversationId = await sendFreshWaiverEmail(sentTo, freshSubject);
  }

  if (draft) {
    if (!draft.id) {
      throw new Error('Graph createReply did not return a draft id');
    }
    requestConversationId = typeof draft.conversationId === 'string' && draft.conversationId.trim()
      ? draft.conversationId
      : null;
    sentGraphMessageId = draft.id;
    try {
      const quotedChain = draft.body?.content || '';
      await graphFetch(`/users/${MAILBOX}/messages/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          subject: replySubject,
          ...(recipientOverride ? {
            toRecipients: [{ emailAddress: { address: recipientOverride } }],
          } : {}),
          body: {
            contentType: 'HTML',
            content: `${EMAIL_TEMPLATE}${buildBodyToken(documentId)}${quotedChain}`,
          },
        }),
      });

      await graphFetch(`/users/${MAILBOX}/messages/${draft.id}/send`, {
        method: 'POST',
      });
    } catch (sendErr) {
      // Best-effort cleanup so failed requests don't strand drafts in the
      // invoices@ Drafts folder.
      try {
        await graphFetch(`/users/${MAILBOX}/messages/${draft.id}`, { method: 'DELETE' });
      } catch (cleanupErr) {
        logger.error(`Failed to delete stranded waiver request draft ${draft.id}: ${cleanupErr.message}`);
      }
      throw sendErr;
    }
  }

  // The exact sent copy is the correlation anchor for inbound References.
  // This read is best-effort and does not change the established waiver send
  // success/failure boundary when Graph omits the metadata.
  if (sentGraphMessageId) {
    try {
      const sent = await graphFetch(`/users/${MAILBOX}/messages/${sentGraphMessageId}?$select=id,internetMessageId`);
      sentInternetMessageId = sent?.internetMessageId || null;
    } catch (identityErr) {
      logger.warn(`Could not read waiver sent-message identity: ${identityErr.message}`);
    }
  }

  const now = new Date().toISOString();

  // Record the request + legacy audit atomically. The email is already out
  // at this point (Graph has no transaction), but this guarantees we never
  // have a sent email without BOTH the timestamp and the audit trail.
  const changes = {
    sentTo,
    originalEmailFrom: doc.email_from,
    method: sendMethod,
    emailMessageId: doc.email_message_id,
    subject: sentSubject,
    resend: opts.resend === true,
    mailbox: MAILBOX,
    requestConversationId,
  };
  const client = await pool.connect();
  let invoiceRow = null;
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE documents
       SET waiver_requested_at = NOW(),
           waiver_requested_by = $2,
           waiver_request_conversation_id = $3,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [documentId, actor, requestConversationId]
    );
    invoiceRow = updated.rows[0];
    if (doc.vendor_code) {
      await client.query(
        `UPDATE vendor_mappings
         SET vendor_email = $2
         WHERE vendor_code = $1 AND (vendor_email IS NULL OR vendor_email <> $2)`,
        [doc.vendor_code, sentTo]
      );
      // W5 organic capture: a confirmed send is the strongest signal an
      // address is a real vendor contact — record it in the directory.
      // Directory write only; recipient trust never reads this table.
      const { upsertVendorContact } = require('./vendorContactsService');
      await upsertVendorContact({
        vendorCode: doc.vendor_code,
        email: sentTo,
        source: 'confirmed_send',
        addedBy: actor,
        lastSeenAt: now,
      }, client);
    }
    await client.query(
      'INSERT INTO audit_log (document_id, action, actor, changes) VALUES ($1, $2, $3, $4)',
      [documentId, 'waiver-requested', actor, JSON.stringify(changes)]
    );
    await client.query('COMMIT');
  } catch (recordErr) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error(`Waiver request email SENT for ${documentId} but recording failed: ${recordErr.message}`);
    throw recordErr;
  } finally {
    client.release();
  }

  try {
    await recordOutboundMessage({ db: pool, documentId, kind: 'reply', graphMessageId: sentGraphMessageId,
      internetMessageId: sentInternetMessageId, conversationId: requestConversationId, fromAddress: MAILBOX,
      to: [sentTo], subject: sentSubject, actorUserId: actor });
  } catch (recordErr) {
    // Correlation is additive; never turn a committed waiver request into a
    // failed request because the optional message record was unavailable.
    logger.warn(`Could not record waiver email correlation: ${recordErr.message}`);
  }

  // Structured audit event for the UI activity feed (best-effort; the
  // legacy audit row above is the durable record).
  if (opts.req && opts.res) {
    try {
      await emitInvoiceAuditEvent(opts.req, opts.res, {
        type: 'invoice.waiver_requested',
        invoiceId: documentId,
        row: doc,
        changes,
        beforeState: { waiver_requested_at: doc.waiver_requested_at || null },
        afterState: { waiver_requested_at: now, waiver_requested_by: actor, waiver_request_conversation_id: requestConversationId },
        undoable: false,
        summary: opts.resend === true ? 'Lien waiver request re-sent' : 'Lien waiver requested',
        severity: 'info',
      });
    } catch (eventErr) {
      logger.error(`Structured audit event failed for waiver request ${documentId}: ${eventErr.message}`);
    }
  }

  logger.info(`Waiver request sent for document ${documentId} to ${sentTo} by ${actor}`);

  return {
    success: true,
    sentTo,
    requestedAt: now,
    invoiceRow,
  };
}

module.exports = { requestWaiver };
