'use strict';

const BILLING_PLATFORM_DOMAINS = new Set([
  'notification.intuit.com', 'sender.zohobooks.com', 'zohobooks.com', 'siteline.com', 'intuit.com', 'versapay.com',
  'amazon.com', 'emails.trimble.com', 'account.trimble.com', 'sync.termsync.com', 'termsync.com', 'servicetrade.com', 'skynova.com',
]);
const INTERNAL_DOMAINS = new Set(['northwindcg.example']);
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Truly automated mailboxes: mail to these bounces or lands unread. Role-based AP
// mailboxes (accounting@, billing@, invoices@, …) are legitimate vendor contacts and
// are NOT listed here; internal and billing-platform addresses are blocked by domain.
const AUTOMATED_MAILBOX_LOCAL_PARTS = new Set([
  'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'notifications', 'notification', 'mailer-daemon', 'postmaster', 'bounce',
]);
// Role-based AP mailboxes (accounting@, billing@, …) are legitimate send targets but are
// kept out of the auto-saved vendor contact directory: they're shared inboxes, not people.
const ROLE_MAILBOX_LOCAL_PARTS = new Set(['invoices', 'billing', 'payments', 'accounts', 'accounting']);
// Our own ingestion mailbox: sending here would loop mail back into the pipeline.
const SELF_MAILBOXES = new Set(['invoices@northwindcg.example']);

function emailDomain(email) { return String(email || '').trim().toLowerCase().split('@')[1] || ''; }
function matchesDomain(domain, candidates) { return [...candidates].some(candidate => domain === candidate || domain.endsWith(`.${candidate}`)); }
function isBlockedRecipient(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const local = normalized.split('@')[0];
  const domain = emailDomain(email);
  return !domain || SELF_MAILBOXES.has(normalized) || matchesDomain(domain, BILLING_PLATFORM_DOMAINS) || AUTOMATED_MAILBOX_LOCAL_PARTS.has(local);
}
function isDirectoryEligible(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || isBlockedRecipient(normalized)) return false;
  return !ROLE_MAILBOX_LOCAL_PARTS.has(normalized.split('@')[0]);
}
function senderReason(emailFrom) {
  const domain = emailDomain(emailFrom);
  if (matchesDomain(domain, INTERNAL_DOMAINS)) return `Internal forward from ${emailFrom}`;
  for (const [domains, label] of [
    [['notification.intuit.com', 'intuit.com'], 'QuickBooks'], [['siteline.com'], 'Siteline'],
    [['sender.zohobooks.com', 'zohobooks.com'], 'Zoho Books'], [['versapay.com'], 'Versapay'], [['amazon.com'], 'Amazon'],
    [['emails.trimble.com', 'account.trimble.com'], 'Trimble'], [['sync.termsync.com', 'termsync.com'], 'TermSync'],
    [['servicetrade.com'], 'ServiceTrade'], [['skynova.com'], 'Skynova'],
  ]) if (matchesDomain(domain, new Set(domains))) return `Billing platform (${label})`;
  return 'Sender requires recipient confirmation';
}
function bodyAsText(body) {
  return String(body || '').replace(/<(?:br|\/p|\/div|\/tr)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
}
function extractVendorEmails(emailBody, emailFrom) {
  const text = bodyAsText(emailBody); const senderDomain = emailDomain(emailFrom); const candidates = []; const seen = new Set();
  const add = (email, source) => {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized) || emailDomain(normalized) === senderDomain || isBlockedRecipient(normalized)) return;
    seen.add(normalized); candidates.push({ email: normalized, source });
  };
  if (matchesDomain(senderDomain, INTERNAL_DOMAINS)) for (const line of text.split(/\r?\n/)) {
    if (/^\s*from\s*:/i.test(line)) for (const email of line.match(EMAIL_PATTERN) || []) add(email, 'forwarded_header');
  }
  for (const email of text.match(EMAIL_PATTERN) || []) add(email, 'body');
  return candidates;
}
function validateRecipientOverride(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) { const err = new Error('Enter a valid vendor email address'); err.statusCode = 400; throw err; }
  if (isBlockedRecipient(normalized)) { const err = new Error('Waiver requests cannot be sent to an internal or billing-platform address'); err.statusCode = 400; throw err; }
  return normalized;
}
function isRoleMailbox(email) { return ROLE_MAILBOX_LOCAL_PARTS.has(String(email || '').trim().toLowerCase().split('@')[0]); }
function resolveRecipient({ emailFrom, emailBody, cachedVendorEmail = null, senderTrusted = false }) {
  const senderBlocked = isBlockedRecipient(emailFrom);
  if (!senderBlocked && senderTrusted) return { recipientType: 'direct', directEmail: String(emailFrom).trim().toLowerCase(), candidates: [], cachedVendorEmail: null, emailFrom: emailFrom || null, reason: 'Direct vendor email' };
  const candidates = [];
  if (!senderBlocked && emailFrom) candidates.push({ email: String(emailFrom).trim().toLowerCase(), source: 'sender' });
  for (const candidate of extractVendorEmails(emailBody, emailFrom)) if (!candidates.some(existing => existing.email === candidate.email)) candidates.push(candidate);
  const cached = cachedVendorEmail && !isBlockedRecipient(cachedVendorEmail) ? String(cachedVendorEmail).trim().toLowerCase() : null;
  if (cached && !candidates.some(candidate => candidate.email === cached)) candidates.push({ email: cached, source: 'vendor_record' });
  // Advisory ordering: named/personal addresses first, generic role mailboxes
  // (accounting@, billing@, …) last — still selectable when they're all we have.
  const ordered = [...candidates.filter(c => !isRoleMailbox(c.email)), ...candidates.filter(c => isRoleMailbox(c.email))];
  return { recipientType: ordered.length > 0 ? 'parsed' : 'manual', directEmail: null, candidates: ordered, cachedVendorEmail: cached, emailFrom: emailFrom || null,
    reason: senderBlocked ? senderReason(emailFrom) : 'Unrecognized sender — not yet linked to this vendor' };
}

module.exports = { AUTOMATED_MAILBOX_LOCAL_PARTS, BILLING_PLATFORM_DOMAINS, INTERNAL_DOMAINS, extractVendorEmails, isBlockedRecipient, isDirectoryEligible, resolveRecipient, validateRecipientOverride };
