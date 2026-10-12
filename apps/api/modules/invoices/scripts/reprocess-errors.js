#!/usr/bin/env node
'use strict';
/**
 * Reprocess errored / retry-pending documents using the live pipeline logic.
 * Usage:
 *   node scripts/reprocess-errors.js
 *   node scripts/reprocess-errors.js --id <document-id>
 */

const fs = require('fs');
const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();
const {
  classifyAndExtract,
  matchInvoiceData,
  normalizeExtractedDates,
  parseEmailBodyForJobData,
} = require('../services/pipeline');
const { mergeReextractedStatementAttributes } = require('../services/statementAttributes');

const EXTRACTABLE = new Set(['invoice', 'receipt', 'credit-memo', 'pay-application']);

function isReprocessableErrorDocument(doc) {
  return Boolean(doc?.file_path)
    && (doc.classification === 'error' || doc.status === 'retry-pending');
}

function getTargetId() {
  const idx = process.argv.indexOf('--id');
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function buildNotes(classResult, existingNotes = null) {
  const base = classResult.ocrApplied ? 'OCR applied' : null;
  const errorNote = classResult.classification === 'error'
    ? `[${classResult.stage || 'classification'}] ${classResult.reason || 'Unknown error'}`
    : null;
  return [existingNotes, base, errorNote].filter(Boolean).join('; ') || null;
}

async function fetchDocs(targetId = null) {
  if (targetId) {
    const { rows } = await pool.query(
      `SELECT * FROM documents WHERE id = $1 AND file_path IS NOT NULL LIMIT 1`,
      [targetId]
    );
    return rows;
  }

  const { rows } = await pool.query(`
    SELECT *
    FROM documents
    WHERE file_path IS NOT NULL
      AND (classification = 'error' OR status = 'retry-pending')
    ORDER BY updated_at ASC
  `);
  return rows;
}

async function updateDoc(doc, classResult) {
  const emailJobData = parseEmailBodyForJobData(doc.email_body, doc.email_subject);
  const extracted = classResult.extracted ? { ...classResult.extracted } : null;
  let matching = null;
  let lienWaiverStatus = null;
  let overallConfidence = null;
  let status = 'pending';
  let flagged = doc.flagged || false;

  if (EXTRACTABLE.has(classResult.classification) && extracted) {
    normalizeExtractedDates(extracted, doc.email_received_at?.toISOString?.() || null);
    if (emailJobData.jobNumber && !extracted.jobNumber) extracted.jobNumber = emailJobData.jobNumber;
    if (emailJobData.projectName && !extracted.projectName) extracted.projectName = emailJobData.projectName;
    matching = await matchInvoiceData(extracted, doc.email_from, doc.email_subject, emailJobData);
    overallConfidence = matching.overallConfidence || null;
    const hasWaiverPage = (classResult.pageClassifications || []).some(c => c === 'lien-waiver');
    lienWaiverStatus = hasWaiverPage ? 'attached' : null;
  }

  // Statement line matching — run matchStatementLines so reprocessed statements
  // get their lines matched against Toolbox + Spectrum, same as the main pipeline.
  let matchedStatementLines = null;
  if (classResult.classification === 'statement' && extracted?.statementLines?.length) {
    const { matchStatementLines } = require('../services/statementLines');
    const { buildStatementLineLookups } = require('../services/statementLineService');
    const { matchVendor } = require('../services/matcher');
    const lookups = buildStatementLineLookups(doc.id);
    const vendorResult = await matchVendor({
      name: extracted.vendor || extracted.vendorName,
      email: doc.email_from,
      address: null,
    });
    const vendorCode = vendorResult?.vendorCode || doc.vendor_code;
    matchedStatementLines = await matchStatementLines(extracted.statementLines, vendorCode, lookups);
  }

  if (classResult.classification === 'error') {
    flagged = true;
  }

  const notes = buildNotes(classResult, doc.notes);

  const pageClassifications = classResult.pageClassifications || [];

  await pool.query('BEGIN');
  try {
  const lockedAttributes = classResult.classification === 'statement'
    ? (await pool.query('SELECT statement_attributes FROM documents WHERE id = $1 FOR UPDATE', [doc.id])).rows[0]?.statement_attributes
    : doc.statement_attributes;
  await pool.query(
    `UPDATE documents SET
      classification = $2,
      status = $3,
      confidence = $4,
      vendor_name = $5,
      vendor_address = $6,
      invoice_number = $7,
      invoice_date = $8,
      due_date = $9,
      amount = $10,
      job_number = $11,
      project_name = $12,
      project_address = $13,
      description = $14,
      line_items = $15,
      vendor_code = $16,
      vendor_match_confidence = $17,
      vendor_match_method = $18,
      matched_vendor_name = $19,
      job_match_number = $20,
      job_match_confidence = $21,
      job_match_method = $22,
      subcontract_number = $23,
      subcontract_match_confidence = $24,
      subcontract_match_method = $25,
      overall_confidence = $26,
      lien_waiver_status = $27,
      flagged = $28,
      notes = $29,
      page_classifications = $30,
      statement_attributes = $31,
      statement_lines = $32,
      queued_at = NOW(),
      updated_at = NOW()
    WHERE id = $1`,
    [
      doc.id,
      classResult.classification,
      status,
      classResult.confidence || overallConfidence,
      extracted?.vendorName || null,
      extracted?.vendorAddress || null,
      extracted?.invoiceNumber || null,
      extracted?.invoiceDate || null,
      extracted?.dueDate || null,
      extracted?.amount || null,
      extracted?.jobNumber || null,
      extracted?.projectName || null,
      extracted?.projectAddress || null,
      extracted?.description || null,
      JSON.stringify(extracted?.lineItems || []),
      matching?.vendor?.vendorCode || null,
      matching?.vendor?.confidence || null,
      matching?.vendor?.method || null,
      matching?.vendor?.vendorName || null,
      matching?.job?.jobNumber || null,
      matching?.job?.confidence || null,
      matching?.job?.method || null,
      matching?.subcontract?.subcontractNumber || null,
      matching?.subcontract?.confidence || null,
      matching?.subcontract?.method || null,
      overallConfidence,
      lienWaiverStatus,
      flagged,
      notes,
      pageClassifications.length > 0 ? JSON.stringify(pageClassifications) : null,
      classResult.classification === 'statement'
        ? JSON.stringify(mergeReextractedStatementAttributes(lockedAttributes, extracted || {}))
        : doc.statement_attributes,
      matchedStatementLines ? JSON.stringify(matchedStatementLines) : null,
    ]
  );

  await pool.query(
    'INSERT INTO audit_log (document_id, action, actor, changes) VALUES ($1, $2, $3, $4)',
    [doc.id, 'reprocessed', 'pipeline', JSON.stringify({ from: doc.classification, to: classResult.classification })]
  );
  await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }

  // Re-run active rules against the freshly reprocessed document — mirrors the
  // intake pipeline behavior (rules otherwise only ever ran once at intake).
  try {
    const { applyRulesToDocumentById } = require('../services/rulesApplyService');
    const rulesOutcome = await applyRulesToDocumentById(doc.id, { db: pool });
    if (rulesOutcome.applied.length > 0) {
      console.log(`  → rules re-applied: ${JSON.stringify(rulesOutcome.patches)}`);
    }
  } catch (rulesErr) {
    console.warn(`  ⚠ rules re-run failed (non-fatal): ${rulesErr.message}`);
  }
}

async function main() {
  const targetId = getTargetId();
  const docs = await fetchDocs(targetId);
  console.log(`Found ${docs.length} document(s) to reprocess`);

  for (const doc of docs) {
    console.log(`\nReprocessing ${doc.id} (${doc.file_name})`);
    if (!doc.file_path || !fs.existsSync(doc.file_path)) {
      console.log('  SKIP — file missing on disk');
      continue;
    }

    const classResult = await classifyAndExtract(doc.file_path, {
      subject: doc.email_subject,
      body: doc.email_body,
    });

    console.log(`  → ${classResult.classification} (${classResult.stage || classResult.method || 'ok'})`);
    await updateDoc(doc, classResult);
    console.log('  ✅ updated');
  }

  await pool.end();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err.message);
    await pool.end();
    process.exit(1);
  });
}

module.exports = { fetchDocs, isReprocessableErrorDocument, updateDoc };
