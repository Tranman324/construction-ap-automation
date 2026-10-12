'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { extractSubjectRefTag, extractBodyToken } = require('./refTag');

const AUTO_REPLY_SUBJECT = /^(?:re:\s*)?(?:automatic reply|auto reply|out of office|ooo)\s*:/i;
const NDR_SUBJECT = /(?:undeliverable|delivery status notification|mail delivery failed|failure notice|returned mail)/i;
const SUBJECT_PREFIXES = /^(?:(?:re|fw|fwd)\s*:\s*)+/i;
const SAFE_TAGS = new Set(['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a']);

function headerMap(raw) {
  const result = new Map();
  const entries = Array.isArray(raw)
    ? raw.map(item => [item?.name, item?.value])
    : Object.entries(raw || {});
  for (const [name, value] of entries) {
    if (!name || value === undefined || value === null) continue;
    const key = String(name).toLowerCase();
    const values = Array.isArray(value) ? value : [value];
    result.set(key, (result.get(key) || []).concat(values.map(String)));
  }
  return result;
}

function messageIds(email) {
  const headers = headerMap(email.internetMessageHeaders);
  const raw = [...(headers.get('references') || []), ...(headers.get('in-reply-to') || [])].join(' ');
  const ids = raw.match(/<[^>\s]+>/g) || raw.split(/\s+/).filter(Boolean);
  return [...new Set(ids)];
}

function normalizedSubjectStem(subject) {
  return String(subject || '').replace(SUBJECT_PREFIXES, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isNdr(email, headers = headerMap(email.internetMessageHeaders)) {
  const names = ['action', 'final-recipient', 'diagnostic-code', 'status', 'x-failed-recipients'];
  const diagnostic = names.some(name => (headers.get(name) || []).length > 0);
  const from = email.from?.emailAddress?.address || '';
  return diagnostic || NDR_SUBJECT.test(email.subject || '') || /(?:mailer-daemon|postmaster)@/i.test(from);
}

function isAutomaticReply(email) {
  const headers = headerMap(email.internetMessageHeaders);
  if (isNdr(email, headers)) return false;
  const autoSubmitted = (headers.get('auto-submitted') || []).some(value => !/^no$/i.test(value.trim()));
  return autoSubmitted || (headers.get('x-auto-response-suppress') || []).length > 0
    || (headers.get('precedence') || []).some(value => /bulk|list|junk/i.test(value))
    || AUTO_REPLY_SUBJECT.test(email.subject || '');
}

function shouldInspectInbound(email) {
  return Boolean(email?.internetMessageId || email?.conversationId || email?.internetMessageHeaders
    || isAutomaticReply(email) || isNdr(email));
}

function sanitizeInboundHtml(value, contentType = 'html') {
  const source = String(value || '');
  if (String(contentType).toLowerCase() === 'text') {
    return source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');
  }
  let html = source.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<(script|style|form|iframe|object|embed|svg|math|template)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  html = html.replace(/<[^>]*>/g, tag => {
    const match = tag.match(/^<\/?\s*([a-z0-9-]+)/i);
    if (!match) return '';
    const name = match[1].toLowerCase();
    if (!SAFE_TAGS.has(name)) return '';
    if (tag.startsWith('</')) return `</${name}>`;
    if (name === 'br') return '<br>';
    if (name !== 'a') return `<${name}>`;
    const href = tag.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    return /^(?:https?|mailto):/i.test(href) ? `<a href="${escapeHtml(href)}">` : '<a>';
  });
  return html.slice(0, 500000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function plainPreview(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function domain(address) {
  const match = String(address || '').trim().match(/^[^@\s]+@([^@\s]+)$/);
  return match ? match[1].toLowerCase() : null;
}

function chooseConversation(rows) {
  const unique = [...new Map(rows.map(row => [row.id, row])).values()];
  if (unique.length === 0) return { documentId: null };
  if (unique.length === 1) return { documentId: unique[0].id, row: unique[0], parentFallback: false };
  const roots = [...new Set(unique.map(row => row.split_from || row.id))];
  if (roots.length === 1) {
    const row = unique.find(candidate => !candidate.split_from) || { id: roots[0], email_from: null, split_from: null };
    return { documentId: roots[0], row, parentFallback: true };
  }
  return { ambiguous: true };
}

async function correlateInbound(email, db) {
  const references = messageIds(email);

  // ── Tier R: Subject ref tag — highest priority, survives all clients ──
  const refCode = extractSubjectRefTag(email.subject);
  if (refCode) {
    const result = await db.query(`SELECT id, split_from, email_from FROM documents WHERE id ILIKE $1 AND deleted_at IS NULL`, [`%-${refCode}`]);
    if (result.rows?.length === 1) return { documentId: result.rows[0].id, row: result.rows[0], tier: 'ref-tag', references };
    // Ref code present but no unique match — fall through
  }

  // ── Tier 0: References/In-Reply-To headers ──
  if (references.length) {
    const result = await db.query(`SELECT DISTINCT d.id, d.split_from, d.email_from
      FROM document_email_messages m JOIN documents d ON d.id = m.document_id
      WHERE m.direction='out' AND m.status='confirmed' AND m.internet_message_id = ANY($1)`, [references]);
    const rows = result.rows || [];
    const uniqueIds = new Set(rows.map(row => row.id));
    if (uniqueIds.size > 1) return { ambiguous: true, reason: 'ambiguous-references', tier: 0, references };
    if (uniqueIds.size === 1) return { ...chooseConversation(rows), tier: 0, references };
  }

  // ── Tier 1: conversationId ──
  if (email.conversationId) {
    const result = await db.query(`SELECT DISTINCT d.id, d.split_from, d.email_from
      FROM document_email_messages m JOIN documents d ON d.id = m.document_id
      WHERE m.direction='out' AND m.status='confirmed' AND m.conversation_id=$1`, [email.conversationId]);
    const match = chooseConversation(result.rows || []);
    if (match.ambiguous) return { ...match, reason: 'ambiguous-conversation', tier: 1, references };
    if (match.documentId) return { ...match, tier: 1, references };
  }

  // ── Tier B: Body token — hidden HTML comment or footer line ──
  const bodyCode = extractBodyToken(email.body?.content || email.bodyPreview || '');
  if (bodyCode) {
    const result = await db.query(`SELECT id, split_from, email_from FROM documents WHERE id ILIKE $1 AND deleted_at IS NULL`, [`%-${bodyCode}`]);
    if (result.rows?.length === 1) return { documentId: result.rows[0].id, row: result.rows[0], tier: 'body-token', references };
  }

  // ── Tier 2: Subject stem + sender scoping ──
  const subjectStem = normalizedSubjectStem(email.subject);
  if (!subjectStem) return { documentId: null, tier: 2, references };
  const senderAddress = (email.from?.emailAddress?.address || '').toLowerCase().trim();
  const result = await db.query(`SELECT DISTINCT d.id, d.split_from, d.email_from, m.subject, m.to_json
    FROM document_email_messages m JOIN documents d ON d.id = m.document_id
    WHERE m.direction='out' AND m.status='confirmed' AND m.sent_at >= now() - interval '14 days'`);
  const matchingRows = (result.rows || []).filter(row => {
    if (normalizedSubjectStem(row.subject) !== subjectStem) return false;
    // Sender scoping: the inbound sender must have been a recipient of the outbound
    if (senderAddress) {
      try {
        const recipients = JSON.parse(row.to_json || '[]');
        const recipientAddresses = recipients.map(r => String(r).toLowerCase().trim());
        if (recipientAddresses.length && !recipientAddresses.includes(senderAddress)) return false;
      } catch { /* malformed to_json — skip scoping for this row */ }
    }
    return true;
  });
  const match = chooseConversation(matchingRows);
  if (match.ambiguous) return { ...match, reason: 'ambiguous-subject', tier: 2, references };
  if (match.documentId) return { ...match, ambiguous: true, reason: 'subject-recency', tier: 2, references };
  return { documentId: null, tier: 2, references };
}

function verifiedParticipant(email, row, config) {
  const sender = domain(email.from?.emailAddress?.address);
  const allowed = new Set([...(config?.internalDomains || []), domain(config?.mailbox)].filter(Boolean).map(value => value.toLowerCase()));
  return Boolean(sender && (allowed.has(sender) || sender === domain(row?.email_from)));
}

async function resolveWaiverRequestTarget(email, inbound, db) {
  const subject = String(email?.subject || '');
  if (!/Lien Waiver Request/i.test(subject) || !inbound?.documentId
    || inbound.action !== 'captured' || inbound.correlationState !== 'matched') return null;

  const subjectCode = extractSubjectRefTag(subject);
  const code = subjectCode || extractBodyToken(email?.body?.content || email?.bodyPreview || '');
  if (!code) return null;
  const result = await db.query(`SELECT id, split_from, classification, status, waiver_requested_at,
      lien_waiver_required, linked_lien_waiver_id
    FROM documents WHERE id ILIKE $1 AND deleted_at IS NULL`, [`%-${code}`]);
  const invoices = (result.rows || []).filter(row => ['invoice', 'pay-application'].includes(row.classification));
  if (invoices.length !== 1) return null;
  const target = invoices[0];
  if (!target.waiver_requested_at || target.lien_waiver_required !== true || target.linked_lien_waiver_id
    || !['pending', 'modified', 'approved', 'reviewed'].includes(target.status)) return null;

  const correlated = await db.query(`SELECT id, split_from FROM documents WHERE id = $1 AND deleted_at IS NULL`, [inbound.documentId]);
  const correlatedRow = correlated.rows?.[0];
  if (!correlatedRow || (target.id !== inbound.documentId && target.id !== correlatedRow.split_from)) return null;
  return { ...target, refCode: code, refSource: subjectCode ? 'ref-tag' : 'body-token' };
}

async function persistInboundMessage({ email, match, db, config, insertAuditEvent, attachmentReviewed = false, deferAudit = false }) {
  const internetId = email.internetMessageId || null;
  const identity = email.id || internetId || randomUUID();
  const id = `inbound-${createHash('sha256').update(String(identity)).digest('hex').slice(0, 32)}`;
  const existing = await db.query(`SELECT id FROM document_email_messages
    WHERE id=$1 OR (direction='in' AND internet_message_id=$2) LIMIT 1`, [id, internetId]);
  if (existing.rows?.length) return { action: 'captured', duplicate: true, documentId: match.documentId, messageId: existing.rows[0].id };
  const rawBody = email.body?.content || email.bodyPreview || '';
  const sanitizedBodyHtml = sanitizeInboundHtml(rawBody, email.body?.contentType || 'html');
  const verified = match.row ? verifiedParticipant(email, match.row, config) : null;
  const kind = isNdr(email) ? 'ndr' : 'inbound';
  const correlationState = match.ambiguous ? 'ambiguous' : (match.documentId ? 'matched' : 'unmatched');
  const correlationReason = match.reason || (match.documentId ? `tier-${match.tier}` : 'no-match');
  const inserted = await db.query(`INSERT INTO document_email_messages
    (id,document_id,direction,kind,status,internet_message_id,graph_message_id,conversation_id,in_reply_to,
     from_address,to_json,subject,body_preview,sanitized_body_html,has_attachments,attachment_reviewed,verified_participant,received_at,
     correlation_state,correlation_reason)
    VALUES ($1,$2,'in',$3,'confirmed',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT DO NOTHING RETURNING id`, [id, match.documentId || null, kind, internetId, email.id || null,
    email.conversationId || null, match.references?.[0] || null, email.from?.emailAddress?.address || null,
    JSON.stringify((email.toRecipients || []).map(item => item?.emailAddress?.address).filter(Boolean)), email.subject || null,
    plainPreview(sanitizedBodyHtml), sanitizedBodyHtml, Boolean(email.hasAttachments), Boolean(attachmentReviewed), verified,
    email.receivedDateTime || null, correlationState, correlationReason]);
  if (!inserted.rows?.length) return { action: 'captured', duplicate: true, documentId: match.documentId, messageId: id };
  const auditEvent = match.documentId ? {
    type: 'invoice.email_reply_received', actor: { userId: null, name: email.from?.emailAddress?.name || email.from?.emailAddress?.address || 'External sender', role: 'external' },
    target: { type: 'invoice', id: match.documentId }, module: 'invoices', severity: 'info', undoable: false,
    summary: kind === 'ndr' ? 'Email delivery failed' : 'Email reply received',
    changes: { subject: email.subject || null, receivedAt: email.receivedDateTime || null, hasAttachments: Boolean(email.hasAttachments), verifiedParticipant: verified },
  } : null;
  if (insertAuditEvent && auditEvent && !deferAudit) await insertAuditEvent(auditEvent, db);
  return { action: match.ambiguous ? 'held' : 'captured', duplicate: false, documentId: match.documentId, kind,
    correlationState, correlationReason, verifiedParticipant: verified, hasAttachments: Boolean(email.hasAttachments),
    messageId: id, ...(deferAudit && auditEvent ? { auditEvent } : {}) };
}

// Owner rule: only mail tied to Toolbox-sent mail leaves the normal pipeline.
// Matched replies are captured on their document; ambiguous ones are held.
// Everything else, including RE:/FW: subjects, In-Reply-To headers, NDRs,
// and staff forwards, returns 'normal' and is ingested like new mail.
async function divertInboundEmail({ email, db, config, insertAuditEvent, hasRealAttachments = false, deferAudit = false }) {
  if (isAutomaticReply(email)) return { action: 'drop', reason: 'automatic-reply' };
  if (!shouldInspectInbound(email)) return { action: 'normal' };
  const match = await correlateInbound(email, db);
  if (!match.ambiguous && !match.documentId) return { action: 'normal' };
  return persistInboundMessage({ email, match, db, config, insertAuditEvent, attachmentReviewed: hasRealAttachments, deferAudit });
}

async function recordOutboundMessage({ db, documentId, kind = 'reply', graphMessageId, internetMessageId, conversationId, fromAddress, to, subject, actorUserId }) {
  const id = randomUUID();
  await db.query(`INSERT INTO document_email_messages
    (id,document_id,direction,kind,status,graph_message_id,internet_message_id,conversation_id,from_address,to_json,subject,actor_user_id,send_token,sent_at)
    VALUES ($1,$2,'out',$3,'confirmed',$4,$5,$6,$7,$8,$9,$10,$11,now()) ON CONFLICT DO NOTHING`,
  [id, documentId, kind, graphMessageId || null, internetMessageId || null, conversationId || null, fromAddress || null,
    JSON.stringify(to || []), subject || null, actorUserId || 'system', randomUUID()]);
  return id;
}

module.exports = { correlateInbound, divertInboundEmail, escapeHtml, headerMap, isAutomaticReply,
  isNdr, messageIds, normalizedSubjectStem, persistInboundMessage, plainPreview, recordOutboundMessage,
  resolveWaiverRequestTarget, sanitizeInboundHtml, shouldInspectInbound };
