'use strict';

/**
 * Reference Tag Correlation — Subject + Body Tokens
 *
 * Embeds a short 4-character reference code in outbound emails so inbound
 * replies can be correlated reliably across any email client.
 *
 * The code is the last 4-char alphanumeric segment of the document ID:
 *   doc-1789775848361-mi6h  →  [Ref:mi6h]
 *
 * Layers:
 *   1. Subject ref tag:  [Ref:mi6h]  — visible, survives all clients
 *   2. HTML comment:     <!-- toolbox-ref:mi6h -->  — hidden, survives quoted HTML
 *   3. Footer line:      Ref: mi6h  — visible, survives plain-text replies
 *
 * Extraction is case-insensitive. Lookup matches documents whose ID ends
 * with the extracted code; exactly one match required (ambiguous = fall through).
 */

// ─── Ref code extraction from document IDs ───────────────────────────────────

const SUFFIX_RE = /[a-z0-9]{4}$/i;

/**
 * Extract the 4-char alphanumeric suffix from a document ID.
 *   "doc-1789775848361-mi6h" → "mi6h"
 * @param {string} documentId
 * @returns {string}
 */
function refCode(documentId) {
  const match = String(documentId || '').match(SUFFIX_RE);
  return match ? match[0] : documentId;
}

// ─── Subject ref tag ─────────────────────────────────────────────────────────

const SUBJECT_REF_TAG = /\[Ref:\s*([a-z0-9]{4})\]/i;

/**
 * Append a ref tag to a subject line. Idempotent — won't double-stamp.
 * @param {string} subject
 * @param {string} documentId  Full document ID; the 4-char suffix is extracted.
 * @returns {string}
 */
function stampSubjectRefTag(subject, documentId) {
  if (SUBJECT_REF_TAG.test(subject)) return subject;
  return `${subject} [Ref:${refCode(documentId)}]`;
}

/**
 * Extract a 4-char ref code from a subject line.
 * @param {string} subject
 * @returns {string|null}
 */
function extractSubjectRefTag(subject) {
  const match = String(subject || '').match(SUBJECT_REF_TAG);
  return match ? match[1] : null;
}

// ─── Body tokens ─────────────────────────────────────────────────────────────

const BODY_COMMENT = /<!--\s*toolbox-ref:\s*([a-z0-9]{4})\s*-->/i;
const BODY_FOOTER  = /Ref:\s*([a-z0-9]{4})\b/i;

/**
 * Build the HTML fragment to embed in outbound email bodies.
 * @param {string} documentId  Full document ID; the 4-char suffix is used.
 * @returns {string}
 */
function buildBodyToken(documentId) {
  const code = refCode(documentId);
  return `<!-- toolbox-ref:${code} --><p style="font-size:10px;color:#999;margin-top:16px">Ref: ${code}</p>`;
}

/**
 * Extract a 4-char ref code from an email body (HTML or plain text).
 * Checks the hidden comment first, then the visible footer.
 * @param {string} body
 * @returns {string|null}
 */
function extractBodyToken(body) {
  const text = String(body || '');
  const comment = text.match(BODY_COMMENT);
  if (comment) return comment[1];
  const footer = text.match(BODY_FOOTER);
  return footer ? footer[1] : null;
}

module.exports = {
  refCode,
  stampSubjectRefTag,
  extractSubjectRefTag,
  buildBodyToken,
  extractBodyToken,
};
