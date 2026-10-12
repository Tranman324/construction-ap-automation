'use strict';

const { pool } = require('./supabase');
const { resolveRecipient } = require('./waiverRecipientParsing');
const { listVendorContacts, touchVendorContact } = require('./vendorContactsService');
const { checkSenderTrust: checkSharedSenderTrust } = require('./recipientResolutionService');

const ELIGIBLE_CLASSIFICATIONS = new Set(['invoice', 'pay-application']);

/**
 * Trust check for a document's sender (2026-07-15).
 *
 * A sender is trusted — and may receive a waiver request without the
 * confirmation dialog — only when we can positively link it to the document's
 * matched vendor:
 *   1. Sender domain is one of that vendor's known domains in vendor_mappings
 *      (learned by the invoice matcher from prior correspondence), OR
 *   2. Sender equals the cached vendor_email (a previously confirmed send).
 *
 * Blocked domains (billing platforms / internal) can never be trusted — this
 * guards against poisoned vendor_mappings rows where the matcher learned a
 * platform domain as a vendor domain (e.g. siteline.com → ZVSC91).
 *
 * @returns {{ trusted: boolean, cachedVendorEmail: string|null }}
 */
async function checkSenderTrust(doc) {
  if (!doc.vendor_code) return checkSharedSenderTrust(doc, []);
  const result = await pool.query(
    `SELECT domain, vendor_email FROM vendor_mappings WHERE vendor_code = $1`,
    [doc.vendor_code]
  );
  return checkSharedSenderTrust(doc, result.rows || []);
}

async function getWaiverRecipient(documentId) {
  const result = await pool.query(
    `SELECT id, classification, email_from, email_body, vendor_code
     FROM documents WHERE id = $1`,
    [documentId]
  );
  const doc = result.rows[0];
  if (!doc) {
    const err = new Error('Document not found');
    err.statusCode = 404;
    throw err;
  }
  if (!ELIGIBLE_CLASSIFICATIONS.has(doc.classification)) {
    const err = new Error('Waiver recipients only exist on invoice or pay-application documents');
    err.statusCode = 422;
    throw err;
  }

  const { trusted, cachedVendorEmail } = await checkSenderTrust(doc);

  const resolution = resolveRecipient({
    emailFrom: doc.email_from,
    emailBody: doc.email_body,
    cachedVendorEmail,
    senderTrusted: trusted,
  });

  // W5 directory: candidate-list enrichment only. Trust inputs above never
  // read the contacts directory (see waiver-gate.static.test.js).
  let directoryContacts = [];
  if (doc.vendor_code) {
    try {
      directoryContacts = await listVendorContacts(doc.vendor_code);
      const emailFrom = String(doc.email_from || '').trim().toLowerCase();
      if (directoryContacts.some((contact) => contact.email === emailFrom)) {
        await touchVendorContact(doc.vendor_code, emailFrom);
      }
    } catch {
      // Directory is additive UI sugar — never fail the picker over it.
      directoryContacts = [];
    }
  }

  return { ...resolution, directoryContacts };
}

module.exports = { getWaiverRecipient, checkSenderTrust };
