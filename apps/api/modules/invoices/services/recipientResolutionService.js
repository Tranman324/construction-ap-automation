'use strict';

const { isBlockedRecipient, resolveRecipient } = require('./recipientResolutionParsing');
const { listVendorContacts } = require('./vendorContactsService');

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }

function checkSenderTrust(doc, mappingRows) {
  const emailFrom = normalizeEmail(doc.email_from);
  const senderDomain = emailFrom.split('@')[1] || '';
  let cachedVendorEmail = null;
  let trusted = false;
  for (const row of mappingRows || []) {
    if (row.vendor_email && !cachedVendorEmail) cachedVendorEmail = row.vendor_email;
    if (senderDomain && normalizeEmail(row.domain) === senderDomain) trusted = true;
  }
  if (cachedVendorEmail && emailFrom === normalizeEmail(cachedVendorEmail)) trusted = true;
  if (trusted && isBlockedRecipient(emailFrom)) trusted = false;
  return { trusted, cachedVendorEmail };
}

async function vendorMappings(doc, db) {
  if (!doc.vendor_code) return [];
  const result = await db.query('SELECT domain, vendor_email FROM vendor_mappings WHERE vendor_code = $1', [doc.vendor_code]);
  return result.rows || [];
}

function parseRecipients(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

async function threadHistoryRecipients(documentId, db) {
  const result = await db.query(`SELECT direction, from_address, to_json
    FROM document_email_messages
    WHERE document_id=$1 AND status='confirmed' AND direction IN ('in', 'out')
    ORDER BY COALESCE(sent_at, received_at, attempted_at) DESC, id DESC`, [documentId]);
  const candidates = [];
  const seen = new Set();
  for (const row of result.rows || []) {
    const addresses = row.direction === 'in' ? [row.from_address] : parseRecipients(row.to_json);
    for (const address of addresses) {
      const email = normalizeEmail(address);
      if (!email || isBlockedRecipient(email) || seen.has(email)) continue;
      seen.add(email); candidates.push({ email, source: 'thread_history' });
    }
  }
  return candidates;
}

function mergeCandidates(primary, secondary) {
  const merged = []; const seen = new Set();
  for (const candidate of [...primary, ...secondary]) {
    const email = normalizeEmail(candidate.email);
    if (!email || seen.has(email)) continue;
    seen.add(email); merged.push({ ...candidate, email });
  }
  return merged;
}

async function resolveDocumentRecipient(doc, db, options = {}) {
  const mappings = await vendorMappings(doc, db);
  const { trusted, cachedVendorEmail } = checkSenderTrust(doc, mappings);
  const resolution = resolveRecipient({ emailFrom: doc.email_from, emailBody: doc.email_body, cachedVendorEmail, senderTrusted: trusted });
  if (resolution.recipientType === 'direct') return { ...resolution, directoryContacts: [] };
  let directoryContacts = [];
  if (doc.vendor_code) {
    try { directoryContacts = await (options.listVendorContacts || listVendorContacts)(doc.vendor_code, db); }
    catch { directoryContacts = []; }
  }
  const history = await threadHistoryRecipients(doc.id, db);
  // Original sender ranks first when eligible; generic/automated senders are excluded upstream,
  // so the next candidate (thread history, body-parsed, vendor record) becomes the default.
  const sender = resolution.candidates.filter(candidate => candidate.source === 'sender');
  const rest = resolution.candidates.filter(candidate => candidate.source !== 'sender');
  return { ...resolution, candidates: mergeCandidates(sender, mergeCandidates(history, rest)), directoryContacts };
}

module.exports = { checkSenderTrust, mergeCandidates, resolveDocumentRecipient, threadHistoryRecipients, vendorMappings };
