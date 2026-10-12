#!/usr/bin/env node
/**
 * Re-Match Sweep — Re-applies the matcher to pending invoices using current
 * Spectrum data and feedback caches. Only updates fields where the new match
 * is BETTER (higher confidence or fills a null). Never overwrites manual edits.
 *
 * Usage:
 *   node modules/invoices/services/rematch.js sweep              # all pending invoices
 *   node modules/invoices/services/rematch.js vendor ZALL93      # pending invoices for one vendor
 *   node modules/invoices/services/rematch.js --dry-run sweep    # preview without writing
 */

'use strict';

const pool = require('../../../lib/db');
const logger = require('../../../lib/logger');
const { matchInvoice } = require('./matcher');

// ---------------------------------------------------------------------------
// Core: re-match a single document row
// ---------------------------------------------------------------------------

/**
 * Re-run the matcher against a single documents row and return what improved.
 *
 * @param {object} row - Full documents row from the database
 * @returns {{ docId: string, changes: object, improved: boolean }}
 */
async function rematchDocument(row) {
  const docId = row.id;

  // Reconstruct the invoice object from stored fields
  const invoice = {
    vendorName:      row.vendor_name,
    senderEmail:     row.email_from,
    emailSubject:    row.email_subject,
    invoiceNumber:   row.invoice_number,
    amount:          row.amount,
    projectAddress:  row.project_address,
    siteAddress:     row.project_address,
    vendorAddress:   row.vendor_address,
    jobNumber:       row.job_number,
    emailFrom:       row.email_from,
    lineItems:       row.line_items,
  };

  let result;
  try {
    result = await matchInvoice(invoice);
  } catch (err) {
    logger.warn({ err, docId }, 'rematchDocument: matchInvoice threw');
    throw err;
  }

  const changes = {};

  // ── Vendor code ───────────────────────────────────────────────────────────
  // Update if: old was null AND new has confidence >= 0.8
  const oldVendorCode   = row.vendor_code;
  const newVendorCode   = result.vendor.vendorCode;
  const newVendorConf   = result.vendor.confidence || 0;

  if (oldVendorCode === null || oldVendorCode === undefined || oldVendorCode === '') {
    if (newVendorCode && newVendorConf >= 0.8) {
      changes.vendor_code              = [oldVendorCode, newVendorCode];
      changes.vendor_match_confidence  = [row.vendor_match_confidence, newVendorConf];
      changes.vendor_match_method      = [row.vendor_match_method, result.vendor.method];
    }
  }
  // NEVER update if old was non-null and different — that's a manual correction.

  // ── Job match number ──────────────────────────────────────────────────────
  // Update if:
  //   a) old was null AND new has confidence >= 0.8, OR
  //   b) old confidence < new confidence AND new confidence >= 0.9
  const oldJobNumber  = row.job_match_number;
  const newJobNumber  = result.job.jobNumber;
  const oldJobConf    = row.job_match_confidence != null ? parseFloat(row.job_match_confidence) : 0;
  const newJobConf    = result.job.confidence || 0;

  const jobIsNull = oldJobNumber === null || oldJobNumber === undefined || oldJobNumber === '';
  const jobImproves = (jobIsNull && newJobNumber && newJobConf >= 0.8) ||
                      (!jobIsNull && oldJobNumber === newJobNumber && newJobConf >= 0.9 && newJobConf > oldJobConf) ||
                      (jobIsNull && newJobNumber && newJobConf >= 0.9 && newJobConf > oldJobConf);

  if (jobImproves && newJobNumber) {
    // Only update if old was null, OR same value with higher confidence.
    // Never overwrite a different non-null value (manual correction).
    if (jobIsNull || oldJobNumber === newJobNumber) {
      changes.job_match_number     = [oldJobNumber, newJobNumber];
      changes.job_match_confidence = [row.job_match_confidence, newJobConf];
      changes.job_match_method     = [row.job_match_method, result.job.method];
    }
  }

  // ── Routing code (match-time persistence, PM-else-D) ──────────────────────
  // A job match landing on a row without routing derives the PM's routing code
  // (or 'D'). Never overwrites an existing routing_code.
  const routingIsNull = row.routing_code === null || row.routing_code === undefined || String(row.routing_code).trim() === '';
  if (changes.job_match_number && routingIsNull) {
    try {
      const { deriveRoutingCode } = require('./submitRouting');
      const derivedRouting = deriveRoutingCode(newJobNumber);
      if (derivedRouting) changes.routing_code = [row.routing_code, derivedRouting];
    } catch (err) {
      logger.warn({ err, docId, jobNumber: newJobNumber }, 'rematchDocument: routing derivation failed');
    }
  }

  // ── Subcontract number ────────────────────────────────────────────────────
  // Update if:
  //   a) old was null AND new has confidence >= 0.5, OR
  //   b) old was null AND new.method !== 'ambiguous'
  // AND the match run's job agrees with the job that will remain on the row
  // (owner ruling 2026-07-23): a subcontract belongs to its job — never adopt
  // the subcontract half of a match pair whose job half was rejected
  // (doc-1783982415645-a6bo incident: stored job 26-402 kept, but 26-447's
  // subcontract 26-447.11 was filled in from the discarded 26-447 match).
  const oldSubNumber  = row.subcontract_number;
  const newSubNumber  = result.subcontract.subcontractNumber;
  const newSubConf    = result.subcontract.confidence || 0;
  const newSubMethod  = result.subcontract.method || '';

  const subIsNull = oldSubNumber === null || oldSubNumber === undefined || oldSubNumber === '';
  const finalJobNumber = changes.job_match_number ? newJobNumber : oldJobNumber;
  const subJobAgrees = Boolean(finalJobNumber) && result.job.jobNumber === finalJobNumber;

  if (subIsNull && newSubNumber && subJobAgrees) {
    const subImproves = newSubConf >= 0.5 || newSubMethod !== 'ambiguous';
    if (subImproves) {
      changes.subcontract_number           = [oldSubNumber, newSubNumber];
      changes.subcontract_match_confidence = [row.subcontract_match_confidence, newSubConf];
      changes.subcontract_match_method     = [row.subcontract_match_method, newSubMethod];

      // Flag multi-phase candidacy for the adopted sub. Without this the flag
      // stays false and approval never demands a phase allocation on a
      // multi-phase subcontract adopted by re-match (pipeline only flags at
      // intake).
      try {
        const { getSubcontractPhaseInfo } = require('./matcher');
        const phaseInfo = getSubcontractPhaseInfo(newSubNumber);
        const isMultiPhase = Boolean(phaseInfo && phaseInfo.isMultiPhase);
        if (Boolean(row.multi_phase_candidate) !== isMultiPhase) {
          changes.multi_phase_candidate = [row.multi_phase_candidate, isMultiPhase];
        }
      } catch (err) {
        logger.warn({ err, docId, subcontractNumber: newSubNumber }, 'rematchDocument: multi-phase recompute failed');
      }
    }
  }
  // NEVER update if old was non-null and different — manual correction.

  // ── Overall confidence ────────────────────────────────────────────────────
  // Update alongside any parent field change
  if (Object.keys(changes).length > 0) {
    changes.overall_confidence = [row.overall_confidence, result.overallConfidence];
  }

  return {
    docId,
    changes,
    improved: Object.keys(changes).length > 0,
  };
}

// ---------------------------------------------------------------------------
// Core: sweep pending documents
// ---------------------------------------------------------------------------

/**
 * Re-run the matcher on all pending (non-modified) invoices.
 *
 * @param {object} opts
 * @param {string}  [opts.vendorCode]  - Limit to one vendor (vendor_code)
 * @param {boolean} [opts.dryRun]      - Preview without writing
 * @param {number}  [opts.sinceDays]   - Limit to docs created within N days
 * @returns {{ total: number, improved: number, unchanged: number, errors: number, details: Array }}
 */
async function rematchPending({ vendorCode, dryRun = false, sinceDays } = {}) {
  // Build query
  let sql = `
    SELECT * FROM documents
    WHERE status = 'pending'
      AND was_modified = false
      AND deleted_at IS NULL
  `;
  const params = [];

  if (vendorCode) {
    params.push(vendorCode);
    sql += ` AND vendor_code = $${params.length}`;
  }

  if (sinceDays != null) {
    params.push(sinceDays);
    sql += ` AND created_at > NOW() - INTERVAL '1 day' * $${params.length}`;
  }

  sql += ' ORDER BY created_at DESC';

  let rows;
  try {
    const result = await pool.query(sql, params);
    rows = result.rows;
  } catch (err) {
    logger.error({ err }, 'rematchPending: DB query failed');
    throw err;
  }

  const summary = {
    total:     rows.length,
    improved:  0,
    unchanged: 0,
    errors:    0,
    details:   [],
  };

  for (const row of rows) {
    try {
      const { docId, changes, improved } = await rematchDocument(row);

      if (!improved) {
        summary.unchanged++;
        continue;
      }

      summary.improved++;
      summary.details.push({ docId, changes: Object.fromEntries(
        Object.entries(changes).map(([k, [, n]]) => [k, n])
      )});

      if (!dryRun) {
        // Build UPDATE from changed fields only
        const sets  = [];
        const vals  = [];
        let   idx   = 1;

        for (const [field, [, newVal]] of Object.entries(changes)) {
          sets.push(`${field} = $${idx++}`);
          vals.push(newVal);
        }
        sets.push(`updated_at = $${idx++}`);
        vals.push(new Date().toISOString());
        vals.push(docId);

        await pool.query(
          `UPDATE documents SET ${sets.join(', ')} WHERE id = $${idx}`,
          vals
        );

        // Audit log entry — same format as other audit entries
        const auditChanges = Object.fromEntries(
          Object.entries(changes).map(([field, [oldVal, newVal]]) => [field, [oldVal, newVal]])
        );
        await pool.query(
          'INSERT INTO audit_log (document_id, action, actor, changes) VALUES ($1, $2, $3, $4)',
          [docId, 'rematched', 'system', JSON.stringify(auditChanges)]
        );

        logger.debug({ docId, changes: auditChanges }, 'rematchPending: document updated');
      }
    } catch (err) {
      summary.errors++;
      logger.warn({ err, docId: row.id }, 'rematchPending: error processing document (skipped)');
    }
  }

  logger.info(
    { total: summary.total, improved: summary.improved, unchanged: summary.unchanged, errors: summary.errors, dryRun },
    'rematchPending: sweep complete'
  );

  return summary;
}

// ---------------------------------------------------------------------------
// Convenience: targeted vendor re-match (used by edit trigger)
// ---------------------------------------------------------------------------

/**
 * Re-match all pending (non-modified) invoices for a specific vendor.
 * Fire-and-forget safe — does not throw (errors are logged).
 *
 * @param {string} vendorCode
 * @returns {Promise<{ total, improved, unchanged, errors, details }>}
 */
async function rematchVendorPending(vendorCode) {
  return rematchPending({ vendorCode, dryRun: false });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { rematchDocument, rematchPending, rematchVendorPending };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args    = process.argv.slice(2);
  const dryRun  = args.includes('--dry-run');
  const cmd     = args.find(a => !a.startsWith('--'));
  const cmdIdx  = args.indexOf(cmd);
  const param   = cmdIdx >= 0 ? args[cmdIdx + 1] : undefined;

  switch (cmd) {
    case 'sweep':
      rematchPending({ dryRun, sinceDays: 7 })
        .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
        .catch(err => { console.error(err); process.exit(1); });
      break;

    case 'vendor':
      if (!param) {
        console.error('Usage: node modules/invoices/services/rematch.js [--dry-run] vendor <CODE>');
        process.exit(1);
      }
      rematchPending({ vendorCode: param, dryRun })
        .then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
        .catch(err => { console.error(err); process.exit(1); });
      break;

    default:
      console.log('Usage: node modules/invoices/services/rematch.js [--dry-run] sweep|vendor <CODE>');
      process.exit(0);
  }
}
