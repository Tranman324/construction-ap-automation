#!/usr/bin/env node
'use strict';
/**
 * Split Worker — async processor for split-processing child docs
 *
 * Invoked by the /api/splits/:id/confirm endpoint with a list of child doc IDs.
 * Each child already has a row in `documents` with status='split-processing'
 * and the split PDF already saved to disk.
 *
 * For each child:
 *   1. Load the row
 *   2. Run classifyAndExtract() on its file
 *   3. Run matchInvoiceData() to identify vendor / job / subcontract
 *   4. UPDATE the existing row (don't INSERT — the row already exists)
 *   5. Transition status: split-processing → pending
 *
 * If any step fails, the row transitions to 'error' with the failure reason
 * in `submit_error` / `notes`.
 *
 * Usage:
 *   node scripts/split-worker.js <childId1> [childId2] [childId3] ...
 */

const path = require('path');
const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();
const logger = require('../../../lib/logger');
const {
  classifyAndExtract,
  matchInvoiceData,
  normalizeExtractedDates,
} = require('../services/pipeline');

const workerLogger = logger.child({ component: 'split-worker' });

function log(msg) {
  workerLogger.info(msg);
}

async function processChild(childId) {
  log(`Processing ${childId}…`);

  const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [childId]);
  if (rows.length === 0) {
    log(`  ✗ Child ${childId} not found`);
    return { childId, ok: false, error: 'Not found' };
  }
  const row = rows[0];

  if (row.status !== 'split-processing') {
    log(`  ⊘ Child ${childId} is not in split-processing status (${row.status}) — skipping`);
    return { childId, ok: false, error: `status=${row.status}` };
  }

  if (!row.file_path) {
    log(`  ✗ Child ${childId} has no file_path`);
    await pool.query(
      `UPDATE documents
       SET status = 'error', submit_error = $1, updated_at = NOW()
       WHERE id = $2`,
      ['Missing file_path', childId]
    );
    return { childId, ok: false, error: 'Missing file_path' };
  }

  try {
    // Classification + extraction
    const classResult = await classifyAndExtract(row.file_path, {
      subject: row.email_subject || '',
      body: row.email_body || '',
    });

    // If the user pre-assigned a docType (e.g., lien-waiver), honor it over Haiku's
    // re-classification, but still use the extracted fields.
    const userAssignedType = row.classification;
    const { enforceActiveClassification } = require('../services/pipeline');
    const finalClassification = await enforceActiveClassification(
      userAssignedType && userAssignedType !== 'invoice'
        ? userAssignedType
        : classResult.classification || userAssignedType || 'other',
      'split-worker'
    );

    log(
      `  → Classified as ${finalClassification} (haiku=${classResult.classification}, user=${userAssignedType || 'none'})`
    );

    // For invoices, run matching
    let matching = null;
    if (['invoice', 'pay-application'].includes(finalClassification)) {
      const senderEmail = row.email_from || '';
      matching = await matchInvoiceData(
        classResult.extracted || {},
        senderEmail,
        row.email_subject || '',
        {}
      );
      log(
        `  → Vendor: ${matching?.vendor?.vendorCode || 'UNMATCHED'} | Job: ${matching?.job?.jobNumber || 'NONE'} | Sub: ${matching?.subcontract?.subcontractNumber || 'NONE'}`
      );
    }

    // Lien waiver check: same logic as the main pipeline.
    // For invoice-type classifications, check whether any page of this child PDF
    // was classified as a lien-waiver. Children from a split typically contain
    // ONE invoice on one page, so the per-page classification list is short
    // (often just [invoice]). If any page is a lien-waiver, the waiver is
    // "attached" on this invoice; otherwise it's "missing" and the existing
    // Lien Waiver Missing banner will surface.
    let lienWaiverStatus = null;
    if (['invoice', 'receipt', 'credit-memo', 'pay-application'].includes(finalClassification)) {
      const pageClasses = classResult.pageClassifications || [];
      const hasLienWaiver = pageClasses.some((c) => c === 'lien-waiver');
      lienWaiverStatus = hasLienWaiver ? 'attached' : null;
      if (hasLienWaiver) {
        log(`  ✓ Lien waiver: attached (found in same PDF)`);
      } else {
        log(
          `  ⚠ Lien waiver: MISSING (pages classified as: ${pageClasses.join(', ') || 'n/a'})`
        );
      }
    }

    // Normalize dates (same logic as main pipeline)
    const ext = classResult.extracted || {};
    if (ext && finalClassification !== 'error') {
      normalizeExtractedDates(ext, row.email_received_at?.toISOString?.() || null);
    }
    const m = matching || {};
    const pageClassifications = classResult.pageClassifications || [];

    // Update the child row with extracted + matched data
    await pool.query(
      `UPDATE documents SET
        classification = $1,
        confidence = $2,
        vendor_name = $3,
        vendor_address = $4,
        invoice_number = $5,
        invoice_date = $6,
        due_date = $7,
        amount = $8,
        job_number = $9,
        project_name = $10,
        project_address = $11,
        description = $12,
        line_items = $13,
        vendor_code = $14,
        vendor_match_confidence = $15,
        vendor_match_method = $16,
        matched_vendor_name = $17,
        job_match_number = $18,
        job_match_confidence = $19,
        job_match_method = $20,
        subcontract_number = $21,
        subcontract_match_confidence = $22,
        subcontract_match_method = $23,
        overall_confidence = $24,
        lien_waiver_status = $25,
        page_classifications = $26,
        status = 'pending',
        updated_at = NOW()
       WHERE id = $27`,
      [
        finalClassification,
        classResult.confidence || null,
        ext.vendorName || null,
        ext.vendorAddress || null,
        ext.invoiceNumber || null,
        ext.invoiceDate || null,
        ext.dueDate || null,
        ext.amount || null,
        ext.jobNumber || null,
        ext.projectName || null,
        ext.projectAddress || null,
        ext.description || null,
        JSON.stringify(ext.lineItems || []),
        m.vendor?.vendorCode || null,
        m.vendor?.confidence || null,
        m.vendor?.method || null,
        m.vendor?.vendorName || null,
        m.job?.jobNumber || null,
        m.job?.confidence || null,
        m.job?.method || null,
        m.subcontract?.subcontractNumber || null,
        m.subcontract?.confidence || null,
        m.subcontract?.method || null,
        m.overallConfidence || null,
        lienWaiverStatus,
        pageClassifications.length > 0 ? JSON.stringify(pageClassifications) : null,
        childId,
      ]
    );

    // Audit trail
    await pool.query(
      `INSERT INTO audit_log (document_id, action, actor, changes)
       VALUES ($1, 'split-processed', 'split-worker', $2)`,
      [
        childId,
        JSON.stringify({
          classification: finalClassification,
          vendorCode: m.vendor?.vendorCode || null,
          jobNumber: m.job?.jobNumber || null,
          invoiceNumber: ext.invoiceNumber || null,
        }),
      ]
    );

    log(`  ✓ ${childId} → pending`);
    return { childId, ok: true };
  } catch (err) {
    log(`  ✗ ${childId}: ${err.message}`);
    await pool.query(
      `UPDATE documents
       SET status = 'error',
           submit_error = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [err.message.slice(0, 500), childId]
    );
    await pool.query(
      `INSERT INTO audit_log (document_id, action, actor, changes)
       VALUES ($1, 'split-error', 'split-worker', $2)`,
      [childId, JSON.stringify({ error: err.message })]
    );
    return { childId, ok: false, error: err.message };
  }
}

async function main() {
  const childIds = process.argv.slice(2);
  if (childIds.length === 0) {
    process.stderr.write('Usage: node split-worker.js <childId1> [childId2] ...\n');
    process.exit(1);
  }

  log(`Starting — ${childIds.length} child doc${childIds.length === 1 ? '' : 's'} to process`);

  const results = [];
  for (const childId of childIds) {
    const result = await processChild(childId);
    results.push(result);
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  log(`Done. ${ok} succeeded, ${failed} failed.`);

  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  workerLogger.fatal({ err }, 'Fatal error in split-worker');
  pool.end().finally(() => process.exit(1));
});
