'use strict';

/**
 * Lien Waiver Auto-Link Service (agreed scope 2026-07-14, updated 2026-08-10)
 *
 * When a newly ingested document is classified as a lien waiver, attempt to
 * link it automatically using a two-tier matching cascade:
 *
 *   Tier 1 — Thread match (original logic):
 *     The waiver shares a conversation id with EXACTLY ONE eligible invoice
 *     (requires a waiver, unlinked, not discarded/submitted).
 *
 *   Tier 2 — Subject + vendor fallback (2026-08-10):
 *     The waiver's email subject contains "Lien Waiver Request", and its
 *     base subject (stripped of prefixes + the request suffix) matches an
 *     eligible invoice's email subject, with the same vendor code. Exactly
 *     one match required. This catches replies where Microsoft Graph assigned
 *     a new conversation ID due to subject modification.
 *
 * Common guards:
 *   - The waiver itself is not already linked.
 *   - The waiver attachment does not look like a multi-waiver bundle
 *     (multiple lien-waiver pages) — those are marked for splitting instead.
 *
 * Auto-links are reversible assistance: the existing unlink endpoint clears
 * them, and the submit-time gate (claimInvoicesForSubmit) re-blocks the
 * invoice immediately because gate state is evaluated at claim time.
 */

const { emitLegacyInvoiceAuditEvent } = require('../../../lib/auditEvents');
const { pool } = require('./supabase');
const { messageIds } = require('./inboundCorrelationService');
const { extractSubjectRefTag, extractBodyToken } = require('./refTag');
const { DOCUMENT_EMAIL } = require('../../../config');

// Invoice statuses eligible for auto-linking. Excludes discarded, submitted,
// submitting, and other terminal/transient states.
const ELIGIBLE_INVOICE_STATUSES = ['pending', 'modified', 'approved', 'reviewed'];
const FREEMAIL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'aol.com', 'icloud.com', 'me.com', 'msn.com', 'comcast.net', 'att.net', 'bellsouth.net']);

// The suffix appended by waiverRequestService when sending a request email.
const WAIVER_REQUEST_SUFFIX = /\s*—\s*Lien Waiver Request\s*$/i;

/**
 * Strip leading RE:/FW:/FWD: chains from a subject line.
 */
function stripReplyPrefixes(subject) {
  return (subject || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim();
}

/**
 * Extract the original invoice subject from a waiver-request reply subject.
 * "Re: Some Invoice — Lien Waiver Request" → "Some Invoice"
 * Returns null if the subject doesn't contain the request suffix.
 */
function extractBaseSubject(waiverSubject) {
  const stripped = stripReplyPrefixes(waiverSubject);
  if (!WAIVER_REQUEST_SUFFIX.test(stripped)) return null;
  const base = stripped.replace(WAIVER_REQUEST_SUFFIX, '').trim();
  return base || null;
}

function inboundCorrelationIds(waiverDoc) {
  const email = waiverDoc.email || {};
  return [...new Set([
    email.internetMessageId,
    waiverDoc.internet_message_id,
    waiverDoc.inbound_internet_message_id,
    ...messageIds(email),
  ].filter((value) => typeof value === 'string' && value.trim()))];
}

function emailDomain(address) {
  const match = String(address || '').trim().toLowerCase().match(/^[^@\s]+@([^@\s]+)$/);
  return match ? match[1] : null;
}

function isTrustedTargetSender(senderAddress, invoice, requestRecipients, config = DOCUMENT_EMAIL) {
  const sender = String(senderAddress || '').trim().toLowerCase();
  const senderDomain = emailDomain(sender);
  if (!sender || !senderDomain) return false;
  const invoiceSender = String(invoice.email_from || '').trim().toLowerCase();
  const recipients = (Array.isArray(requestRecipients) ? requestRecipients : [requestRecipients])
    .map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
  const allowedDomains = new Set([
    ...(config.internalDomains || []).map(value => String(value).trim().toLowerCase()),
    emailDomain(config.mailbox), emailDomain(invoiceSender), ...recipients.map(emailDomain),
  ].filter(Boolean));
  if (!allowedDomains.has(senderDomain)) return false;
  if (!FREEMAIL_DOMAINS.has(senderDomain)) return true;
  return sender === invoiceSender || recipients.includes(sender);
}

/**
 * Attempt to auto-link a newly ingested lien waiver document to an invoice.
 * Transactional: both sides link or neither does.
 *
 * @param {object} waiverDoc - Row/queue-entry for the lien-waiver document.
 *   Needs: id, email_conversation_id (or email.conversationId), pageClassifications (optional)
 * @param {object} [opts]
 * @param {function} [opts.log] - Pipeline logger
 * @returns {Promise<{linked: boolean, invoiceId?: string, reason?: string}>}
 */
async function autoLinkWaiver(waiverDoc, opts = {}) {
  const log = opts.log || (() => {});
  const waiverId = waiverDoc.id;
  const convId = waiverDoc.email_conversation_id
    || waiverDoc.email?.conversationId
    || null;

  // A real lien waiver is always one or two pages (Georgia releases often
  // read as waiver on both pages). Three or more waiver-classified pages
  // means stacked releases; leave those for manual pairing.
  const pageClasses = waiverDoc.pageClassifications
    || waiverDoc.page_classifications
    || [];
  const waiverPageCount = Array.isArray(pageClasses)
    ? pageClasses.filter((c) => c === 'lien-waiver').length
    : 0;
  if (waiverPageCount > 2) {
    log(`  → Auto-link skipped: ${waiverPageCount} waiver pages suggest a multi-waiver bundle — needs splitting`);
    // W13: persist the skip reason so the UI can render a "split this
    // document" notice. Best-effort — the skip decision itself never changes.
    try {
      await pool.query(
        `UPDATE documents SET waiver_auto_link_skip_reason = 'multi-waiver-bundle', updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL`,
        [waiverId]
      );
    } catch (persistErr) {
      log(`  ⚠ Could not persist multi-waiver-bundle skip reason (${persistErr.message})`);
    }
    return { linked: false, reason: 'multi-waiver-bundle' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the waiver row and fetch subject + vendor for tier-2 matching.
    const waiverResult = await client.query(
      `SELECT id, linked_lien_waiver_id, classification, email_subject, vendor_code
       FROM documents WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [waiverId]
    );
    const waiver = waiverResult.rows[0];
    if (!waiver || waiver.classification !== 'lien-waiver' || waiver.linked_lien_waiver_id) {
      await client.query('ROLLBACK');
      return { linked: false, reason: 'waiver-not-linkable' };
    }

    // ── Tier R: Subject ref tag or body token ────────────────────────────
    // Outbound waiver request emails now carry [Ref:docId] in subject and
    // a body token. If the reply preserves either, direct-match the invoice.
    let invoicesResult = { rows: [] };
    let linkSource = null;

    if (opts.targetInvoiceId) {
      const persistTargetSkip = async reason => {
        await client.query(`UPDATE documents SET waiver_auto_link_skip_reason = $1, updated_at = NOW()
          WHERE id = $2 AND deleted_at IS NULL`, [reason, waiverId]);
        await client.query('COMMIT');
        return { linked: false, reason };
      };
      if (Number(opts.attachmentCount) > 1) {
        const result = await persistTargetSkip('multiple-attachments-on-waiver-reply');
        log(`  → Auto-link skipped: ${result.reason}`);
        return result;
      }
      const targetResult = await client.query(
        `SELECT id, invoice_number, status, email_conversation_id, waiver_request_conversation_id,
                email_from, vendor_code
         FROM documents
         WHERE id = $1
           AND classification IN ('invoice', 'pay-application')
           AND status = ANY($2)
           AND linked_lien_waiver_id IS NULL
           AND lien_waiver_required = true
           AND waiver_requested_at IS NOT NULL
           AND deleted_at IS NULL
         FOR UPDATE`,
        [opts.targetInvoiceId, ELIGIBLE_INVOICE_STATUSES]
      );
      const target = targetResult.rows[0];
      if (!target) {
        const result = await persistTargetSkip('invoice-not-eligible');
        log(`  → Auto-link skipped: ${result.reason}`);
        return result;
      }
      const recipientResult = await client.query(
        `SELECT to_json FROM document_email_messages
         WHERE document_id = $1 AND direction = 'out' AND status = 'confirmed'
           AND subject ILIKE '%Lien Waiver Request%'
           AND ($2::text IS NULL OR conversation_id = $2)
         ORDER BY sent_at DESC LIMIT 1`,
        [target.id, target.waiver_request_conversation_id || null]
      );
      let requestRecipients = [];
      try {
        const rawRecipients = recipientResult.rows?.[0]?.to_json || [];
        const parsed = typeof rawRecipients === 'string' ? JSON.parse(rawRecipients) : rawRecipients;
        requestRecipients = Array.isArray(parsed) ? parsed : [];
      } catch { /* malformed historical recipients are not trusted */ }
      if (!isTrustedTargetSender(waiverDoc.email?.from || waiverDoc.from_address, target, requestRecipients)) {
        const result = await persistTargetSkip('unverified-sender');
        log(`  → Auto-link skipped: ${result.reason}`);
        return result;
      }
      invoicesResult = { rows: [target] };
      linkSource = opts.targetLinkSource || 'ref-tag';
    }

    if (!opts.targetInvoiceId) {
    const refCode = extractSubjectRefTag(waiver.email_subject);
    const body = waiverDoc.email?.body;
    const bodyCode = extractBodyToken(typeof body === 'string' ? body : (body?.content || ''));
    const code = refCode || bodyCode;
    if (code) {
      const refResult = await client.query(
        `SELECT id, invoice_number, status, email_conversation_id, waiver_request_conversation_id
         FROM documents
         WHERE id LIKE $1
           AND classification IN ('invoice', 'pay-application')
           AND status = ANY($2)
           AND linked_lien_waiver_id IS NULL
           AND lien_waiver_required = true
           AND deleted_at IS NULL
         FOR UPDATE`,
        [`%-${code}`, ELIGIBLE_INVOICE_STATUSES]
      );
      if (refResult.rows.length === 1) {
        invoicesResult = { rows: refResult.rows };
        linkSource = refCode ? 'ref-tag' : 'body-token';
      }
    }

    // Tier 0: an explicitly promoted attachment retains the inbound message
    // identity. Resolve that identity through the same correlation table,
    // including the outbound Message-ID referenced by the inbound headers.
    // A single eligible invoice is required; ambiguity falls through to the
    // established conversation and subject/vendor tiers.
    const correlationIds = inboundCorrelationIds(waiverDoc);
    if (correlationIds.length && invoicesResult.rows.length !== 1) {
      const tierZero = await client.query(
        `SELECT d.id, d.invoice_number, d.status,
                d.email_conversation_id, d.waiver_request_conversation_id
         FROM document_email_messages m
         JOIN documents d ON d.id = m.document_id
         WHERE m.internet_message_id = ANY($1)
           AND d.classification IN ('invoice', 'pay-application')
           AND d.status = ANY($2)
           AND d.linked_lien_waiver_id IS NULL
           AND d.lien_waiver_required = true
           AND d.deleted_at IS NULL
         ORDER BY d.queued_at DESC
         FOR UPDATE`,
        [correlationIds, ELIGIBLE_INVOICE_STATUSES]
      );
      const tierZeroRows = [...new Map(tierZero.rows.map((row) => [row.id, row])).values()];
      if (tierZeroRows.length === 1) {
        invoicesResult = { rows: tierZeroRows };
        linkSource = 'email-reference';
      } else if (tierZeroRows.length > 1) {
        log(`  → Auto-link skipped: ambiguous-email-reference-${tierZeroRows.length}-eligible-invoices`);
        await client.query('ROLLBACK');
        return { linked: false, reason: `ambiguous-email-reference-${tierZeroRows.length}-eligible-invoices` };
      }
    }

    if (convId) {
      if (invoicesResult.rows.length === 1) {
        // Tier R or Tier 0 is authoritative and must not be displaced by a
        // broader conversation match.
      } else {
      invoicesResult = await client.query(
        `SELECT id, invoice_number, status, email_conversation_id, waiver_request_conversation_id
         FROM documents
         WHERE (email_conversation_id = $1 OR waiver_request_conversation_id = $1)
           AND classification IN ('invoice', 'pay-application')
           AND status = ANY($2)
           AND linked_lien_waiver_id IS NULL
           AND lien_waiver_required = true
           AND deleted_at IS NULL
         ORDER BY queued_at DESC
         FOR UPDATE`,
        [convId, ELIGIBLE_INVOICE_STATUSES]
      );

      if (invoicesResult.rows.length === 1) {
        const inv = invoicesResult.rows[0];
        linkSource = inv.email_conversation_id === convId ? 'email-thread' : 'request-thread';
      } else if (invoicesResult.rows.length > 1) {
        await client.query('ROLLBACK');
        const reason = `ambiguous-thread-${invoicesResult.rows.length}-eligible-invoices`;
        log(`  → Auto-link skipped: ${reason}`);
        return { linked: false, reason };
      }
      }
    }

    // ── Tier 2: Subject + vendor fallback ───────────────────────────────
    // When tier 1 found zero matches, check if this waiver is a reply to a
    // request email whose subject was modified (Graph assigned a new conv ID).
    if (invoicesResult.rows.length === 0) {
      const baseSubject = extractBaseSubject(waiver.email_subject);

      if (baseSubject && waiver.vendor_code) {
        // Match: invoice has same base subject + same vendor + a waiver was requested.
        const subjectResult = await client.query(
          `SELECT id, invoice_number, status, email_subject
           FROM documents
           WHERE vendor_code = $1
             AND classification IN ('invoice', 'pay-application')
             AND status = ANY($2)
             AND linked_lien_waiver_id IS NULL
             AND lien_waiver_required = true
             AND waiver_requested_at IS NOT NULL
             AND deleted_at IS NULL
           ORDER BY queued_at DESC
           FOR UPDATE`,
          [waiver.vendor_code, ELIGIBLE_INVOICE_STATUSES]
        );

        // Filter to invoices whose base subject matches (strip prefixes for both sides).
        const subjectMatches = subjectResult.rows.filter((inv) => {
          const invBase = stripReplyPrefixes(inv.email_subject);
          return invBase === baseSubject;
        });

        if (subjectMatches.length === 1) {
          invoicesResult = { rows: subjectMatches };
          linkSource = 'subject-vendor';
        } else if (subjectMatches.length > 1) {
          await client.query('ROLLBACK');
          const reason = `ambiguous-subject-${subjectMatches.length}-eligible-invoices`;
          log(`  → Auto-link skipped: ${reason}`);
          return { linked: false, reason };
        }
      }
    }
    }

    if (invoicesResult.rows.length !== 1) {
      await client.query('ROLLBACK');
      const reason = !convId ? 'no-conversation-id' : 'no-eligible-invoice';
      log(`  → Auto-link skipped: ${reason}`);
      return { linked: false, reason };
    }

    const invoice = invoicesResult.rows[0];
    const now = new Date().toISOString();

    await client.query(
      `UPDATE documents
       SET linked_lien_waiver_id = $1, waiver_link_source = $2, updated_at = $3
       WHERE id = $4`,
      [waiverId, linkSource, now, invoice.id]
    );
    await client.query(
      `UPDATE documents
       SET linked_lien_waiver_id = $1,
           filed = true,
           filed_at = COALESCE(filed_at, $2),
           updated_at = $2
       WHERE id = $3`,
      [invoice.id, now, waiverId]
    );

    await emitLegacyInvoiceAuditEvent(invoice.id, 'waiver-linked', {
      waiverId,
      linkedAt: now,
      source: linkSource,
      conversationId: convId,
    }, 'pipeline-auto-link', client);
    await emitLegacyInvoiceAuditEvent(waiverId, 'waiver-linked', {
      invoiceId: invoice.id,
      linkedAt: now,
      source: linkSource,
      conversationId: convId,
      filed: true,
      filedAt: now,
    }, 'pipeline-auto-link', client);

    await client.query('COMMIT');

    log(`  ✓ Auto-linked waiver ${waiverId} to invoice ${invoice.id} (${linkSource} match)`);
    return { linked: true, invoiceId: invoice.id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    log(`  ⚠ Auto-link failed (${err.message}) — waiver remains in queue for manual pairing`);
    return { linked: false, reason: `error: ${err.message}` };
  } finally {
    client.release();
  }
}

module.exports = { autoLinkWaiver, extractBaseSubject, stripReplyPrefixes, ELIGIBLE_INVOICE_STATUSES };
