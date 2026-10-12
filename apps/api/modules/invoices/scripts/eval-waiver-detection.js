#!/usr/bin/env node
'use strict';
/**
 * Eval script — Waiver Detection Accuracy
 *
 * Queries Postgres for documents where waiver_on_document = true (user-labeled),
 * re-runs the NEW deterministic waiver keyword pre-pass against the stored PDF
 * WITHOUT writing to the DB.
 *
 * Reports per-doc results and a summary: X/24 recovered.
 *
 * Usage:
 *   node modules/invoices/scripts/eval-waiver-detection.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();
const { getPerPageTexts, applyWaiverPrePass, WAIVER_REGEX } = require('../services/waiverDetection');
const { sanitizePathForShell } = require('../services/sanitize');

async function main() {
  // Query docs where the user has confirmed waiver_on_document = true
  const { rows } = await pool.query(`
    SELECT id, file_name, file_path, classification, lien_waiver_status,
           page_classifications
    FROM documents
    WHERE waiver_on_document = true
      AND file_path IS NOT NULL
    ORDER BY created_at
  `);

  console.log(`Found ${rows.length} documents with waiver_on_document = true\n`);

  let recovered = 0;
  let total = 0;
  const results = [];

  for (const doc of rows) {
    total++;
    const filePath = doc.file_path;

    if (!fs.existsSync(filePath)) {
      results.push({ id: doc.id, file: doc.file_name, pages: 0, classes: [], detected: false, reason: 'file missing' });
      console.log(`  ${doc.id} — FILE MISSING: ${filePath}`);
      continue;
    }

    // Detect page count
    let pageCount = 1;
    try {
      const out = execSync(`identify "${sanitizePathForShell(filePath)}" 2>/dev/null | wc -l`, { timeout: 10000 }).toString().trim();
      pageCount = parseInt(out) || 1;
    } catch {
      // Not a PDF or can't detect pages — try as single page
    }

    // Determine if this is a scanned PDF (pdftotext returns thin text)
    let docText = '';
    try {
      docText = execSync(`pdftotext "${sanitizePathForShell(filePath)}" -`, { timeout: 10000 }).toString().trim();
    } catch {}
    const isScanned = docText.length < 50;

    // Get per-page text (with OCR for scanned pages)
    const perPageTexts = getPerPageTexts(filePath, pageCount, isScanned);

    // Simulate Haiku classifications (we don't call Haiku — use the stored ones or default to 'other')
    let simClassifications;
    if (doc.page_classifications && Array.isArray(doc.page_classifications)) {
      simClassifications = [...doc.page_classifications];
    } else {
      // No stored classifications — simulate all as 'other' (worst case for pre-pass)
      simClassifications = new Array(pageCount).fill('other');
    }

    // Also do a raw text check: does ANY page text match waiver regex?
    let rawTextHit = false;
    const pageDetails = [];
    for (let i = 0; i < pageCount; i++) {
      const text = perPageTexts[i] || '';
      const hit = WAIVER_REGEX.test(text);
      if (hit) rawTextHit = true;
      pageDetails.push({
        page: i + 1,
        textLen: text.length,
        waiverHit: hit,
        origClass: simClassifications[i] || 'unknown',
      });
    }

    // Apply the pre-pass
    const reclassified = applyWaiverPrePass(simClassifications, perPageTexts);
    const hasWaiver = simClassifications.some(c => c === 'lien-waiver');

    if (hasWaiver) recovered++;

    const result = {
      id: doc.id,
      file: doc.file_name,
      pages: pageCount,
      classes: simClassifications,
      detected: hasWaiver,
      reclassified,
      rawTextHit,
      pageDetails,
    };
    results.push(result);

    const status = hasWaiver ? '✓' : '✗';
    console.log(`  ${status} ${doc.id} — ${pageCount} pages, classes: [${simClassifications.join(', ')}]${reclassified > 0 ? ` (${reclassified} reclassified)` : ''}`);
    if (!hasWaiver) {
      console.log(`    → rawTextHit: ${rawTextHit}, page texts: ${perPageTexts.map((t, i) => `p${i + 1}:${(t || '').length}ch`).join(', ')}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY: ${recovered}/${total} waivers recovered by keyword pre-pass`);
  console.log(`${'='.repeat(60)}\n`);

  // Detailed table
  console.log('ID | File | Pages | Detected | Classes');
  console.log('-'.repeat(80));
  for (const r of results) {
    console.log(`${r.id} | ${(r.file || '').slice(0, 30)} | ${r.pages} | ${r.detected ? 'YES' : 'NO'} | [${r.classes.join(', ')}]`);
  }

  await pool.end();
  process.exit(recovered >= 20 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Fatal:', err.message);
  await pool.end();
  process.exit(1);
});
