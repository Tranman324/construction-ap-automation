'use strict';

const { pool } = require('./supabase');
const { isDirectoryEligible } = require('./recipientResolutionParsing');

// Source trust ranking: a higher-ranked source is never downgraded by a
// lower-ranked upsert (e.g. an 'observed' backfill must not overwrite a
// 'confirmed_send' or 'manual' entry).
const SOURCE_RANK = { observed: 1, manual: 2, confirmed_send: 3 };

/**
 * W5: upsert a directory entry for (vendor_code, email). Email is normalized
 * lowercase app-side (the migration grammar has no expression indexes).
 * Ineligible addresses (blocked domains / automated mailboxes / bad format)
 * are silently skipped — this is a directory, not a validation path.
 *
 * Returns true when a row was written, false when skipped.
 */
async function upsertVendorContact({ vendorCode, email, name = null, source = 'observed', addedBy = 'system', lastSeenAt = null }, db = pool) {
  if (!vendorCode) return false;
  const normalized = String(email || '').trim().toLowerCase();
  if (!isDirectoryEligible(normalized)) return false;
  if (!SOURCE_RANK[source]) throw new Error(`Unknown vendor contact source: ${source}`);

  await db.query(
    `INSERT INTO vendor_contacts (vendor_code, email, name, source, last_seen_at, added_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (vendor_code, email) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, vendor_contacts.name),
       source = CASE
         WHEN CASE EXCLUDED.source WHEN 'confirmed_send' THEN 3 WHEN 'manual' THEN 2 ELSE 1 END >
              CASE vendor_contacts.source WHEN 'confirmed_send' THEN 3 WHEN 'manual' THEN 2 ELSE 1 END
         THEN EXCLUDED.source ELSE vendor_contacts.source END,
       last_seen_at = GREATEST(COALESCE(EXCLUDED.last_seen_at, vendor_contacts.last_seen_at), COALESCE(vendor_contacts.last_seen_at, EXCLUDED.last_seen_at))`,
    [vendorCode, normalized, name, source, lastSeenAt, addedBy]
  );
  return true;
}

/**
 * Directory contacts for the recipient picker: confirmed sends first, then
 * most recently seen.
 */
async function listVendorContacts(vendorCode, db = pool) {
  if (!vendorCode) return [];
  const { rows } = await db.query(
    `SELECT email, name, source, last_seen_at
     FROM vendor_contacts
     WHERE vendor_code = $1
     ORDER BY (source = 'confirmed_send') DESC, last_seen_at DESC NULLS LAST, email ASC`,
    [vendorCode]
  );
  return rows.map((row) => ({
    email: row.email,
    name: row.name || null,
    source: row.source,
    lastSeenAt: row.last_seen_at || null,
  }));
}

/**
 * Best-effort last_seen_at bump when a known contact shows up as a sender.
 * Touches existing rows only — never inserts.
 */
async function touchVendorContact(vendorCode, email, db = pool) {
  if (!vendorCode || !email) return;
  await db.query(
    'UPDATE vendor_contacts SET last_seen_at = NOW() WHERE vendor_code = $1 AND email = $2',
    [vendorCode, String(email).trim().toLowerCase()]
  );
}

module.exports = { SOURCE_RANK, listVendorContacts, touchVendorContact, upsertVendorContact };
