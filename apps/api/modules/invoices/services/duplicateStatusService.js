'use strict';
/**
 * Duplicate-status evaluation service (DUPLICATE-WORKFLOW-SPEC, ratified
 * 2026-09-08). Single evaluation consumed by BOTH the banner endpoint and the
 * approval blocker so presentation and enforcement cannot disagree.
 *
 * States (mutually exclusive, Spectrum wins):
 *   'spectrum' - live Spectrum lookup (vendor + normalized invoice #) hit any
 *                of the 3 AP tables, regardless of duplicate_of. An original
 *                with status 'submitted' also lands here (it is in Spectrum
 *                by definition).
 *   'toolbox'  - duplicate_of set, target row exists, not in Spectrum.
 *   'stale'    - duplicate_of set, target row purged/absent, not in Spectrum.
 *   'none'     - no unresolved duplicate signal.
 *
 * Bypass semantics: duplicate_of is never cleared; effective signal =
 * signal AND NOT duplicate_bypassed. A bypassed row always evaluates 'none'
 * with the bypass block populated (so the UI can still show provenance).
 *
 * Spectrum downtime fails open exactly like findSpectrumInvoice: lookup
 * returns null and evaluation degrades to toolbox/stale/none. Never block
 * review on Spectrum being down.
 */

const pool = require('../../../lib/db');

/** Match findDuplicate's normalization (pipeline.js): uppercase alphanumerics. */
function normalizeInvoiceNumber(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * The identity of the match a bypass covers, from the latest bypass audit
 * entry's evidence snapshot. Comparison keys: duplicate_of for toolbox/stale,
 * vendor + normalized invoice number for spectrum. Missing/legacy snapshots
 * fail closed to "same match" so a bypass never silently un-bypasses.
 */
async function bypassCoversCurrentMatch(row, { db, state, spectrumHit }) {
  let snapshot = null;
  try {
    const auditResult = await db.query(
      `SELECT changes FROM audit_log
       WHERE document_id = $1 AND action = 'duplicate-bypass-set'
       ORDER BY created_at DESC LIMIT 1`,
      [row.id]
    );
    const changes = auditResult.rows[0]?.changes;
    const parsed = typeof changes === 'string' ? JSON.parse(changes) : changes;
    snapshot = parsed?.evidence || null;
  } catch {
    snapshot = null;
  }
  if (!snapshot) return true;

  if (state === 'spectrum' && spectrumHit) {
    return snapshot.vendorCode === row.vendor_code
      && snapshot.normalizedInvoiceNumber === normalizeInvoiceNumber(row.invoice_number);
  }
  return (snapshot.duplicateOf || null) === (row.duplicate_of || null);
}

/**
 * Evaluate the duplicate status for a document row.
 * @param {object} row - documents row (needs id, invoice_number, vendor_code,
 *   duplicate_of, duplicate_bypassed/_at/_by, status)
 * @param {object} [opts]
 * @param {object} [opts.db] - pg client/pool for the original-row lookup
 * @param {Function} [opts.findSpectrum] - injectable Spectrum lookup for tests
 * @returns {Promise<{state, spectrum, original, bypassed, evidence}>}
 */
async function evaluateDuplicateStatus(row, { db = pool, findSpectrum } = {}) {
  const bypassed = row.duplicate_bypassed === true
    ? {
      at: row.duplicate_bypassed_at || null,
      by: row.duplicate_bypassed_by || null,
    }
    : null;

  const result = {
    state: 'none',
    spectrum: null,
    original: null,
    bypassed,
    evidence: null,
  };

  // A discarded/duplicate-status row has already been dealt with; the banner
  // and blocker only concern reviewable copies.
  if (row.status === 'discarded' || row.status === 'duplicate') return result;

  // Live Spectrum re-check (fail-open). Only meaningful with both keys.
  const lookup = findSpectrum || require('./spectrum').findSpectrumInvoice;
  let spectrumHit = null;
  if (row.invoice_number && row.vendor_code) {
    spectrumHit = await lookup({
      invoiceNumber: row.invoice_number,
      vendorCode: row.vendor_code,
    });
  }

  // Original-row check when the intake flag exists.
  let original = null;
  if (row.duplicate_of) {
    const originalResult = await db.query(
      'SELECT id, status, amount, invoice_number, vendor_code, file_name FROM documents WHERE id = $1',
      [row.duplicate_of]
    );
    original = originalResult.rows[0] || null;
  }

  // Submitted original is in Spectrum by definition (spec 2.1 State B note).
  const submittedOriginal = original && original.status === 'submitted';

  let state = 'none';
  if (spectrumHit || submittedOriginal) state = 'spectrum';
  else if (row.duplicate_of && original) state = 'toolbox';
  else if (row.duplicate_of && !original) state = 'stale';

  if (state === 'none') return result;

  // Bypass covers the SAME match identity it was recorded against; a NEW
  // distinct match resurrects the signal (spec 2.3). Match identity is the
  // evidence snapshot stored in the bypass audit entry.
  if (bypassed) {
    const sameMatch = await bypassCoversCurrentMatch(row, { db, state, spectrumHit });
    if (sameMatch) return result;
  }

  result.state = state;
  result.spectrum = spectrumHit
    ? {
      source: spectrumHit.source,
      invoiceNumber: spectrumHit.invoiceNumber,
      vendorCode: spectrumHit.vendorCode,
      amount: spectrumHit.amount,
    }
    : null;
  result.original = original
    ? {
      id: original.id,
      status: original.status,
      amount: original.amount == null ? null : Number(original.amount),
      invoiceNumber: original.invoice_number,
      fileName: original.file_name,
    }
    : null;

  // Stale flags cite the discard date from audit_log when available.
  let originalDiscardedAt = null;
  if (state === 'stale') {
    const auditResult = await db.query(
      `SELECT created_at FROM audit_log
       WHERE document_id = $1 AND action IN ('discarded', 'deleted', 'purged')
       ORDER BY created_at DESC LIMIT 1`,
      [row.duplicate_of]
    );
    originalDiscardedAt = auditResult.rows[0]?.created_at || null;
  }

  result.evidence = {
    invoiceNumber: row.invoice_number || null,
    normalizedInvoiceNumber: normalizeInvoiceNumber(row.invoice_number) || null,
    vendorCode: row.vendor_code || null,
    amount: row.amount == null ? null : Number(row.amount),
    duplicateOf: row.duplicate_of || null,
    originalDiscardedAt,
  };
  return result;
}

/**
 * Canonical auto-filled discard reason (spec 2.2). Server composes the string
 * from its OWN evaluation; client text is never trusted.
 */
function buildDuplicateDiscardReason(evaluation) {
  if (!evaluation) return '';
  if (evaluation.state === 'spectrum' && evaluation.spectrum) {
    const s = evaluation.spectrum;
    const amount = s.amount == null ? '' : `, $${Number(s.amount).toFixed(2)}`;
    return `Duplicate — posted in Spectrum (${s.source}, #${s.invoiceNumber}${amount})`;
  }
  if (evaluation.state === 'spectrum' && evaluation.original) {
    return `Duplicate of ${evaluation.original.id} (submitted to Spectrum)`;
  }
  if (evaluation.state === 'toolbox' && evaluation.original) {
    return `Duplicate of ${evaluation.original.id}`;
  }
  if (evaluation.state === 'stale') {
    const when = evaluation.evidence?.originalDiscardedAt
      ? ` on ${new Date(evaluation.evidence.originalDiscardedAt).toISOString().slice(0, 10)}`
      : '';
    return `Duplicate — flagged against a copy discarded${when}`;
  }
  return '';
}

module.exports = {
  evaluateDuplicateStatus,
  buildDuplicateDiscardReason,
  normalizeInvoiceNumber,
};
