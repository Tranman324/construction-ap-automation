#!/usr/bin/env node
/**
 * Re-extract invoice data from multi-page PDFs using updated pipeline
 * Sends all pages to Haiku, then re-runs matcher
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Load env
const dotenvPath = path.join(__dirname, '..', '..', '..', '.env');
try { require('dotenv').config({ path: dotenvPath, override: true }); } catch {}

const { createScriptClient } = require('../../../lib/scriptDb');
const pool = createScriptClient();
const { matchInvoice } = require('../services/matcher');
const { buildCoiExtractionPrompt, normalizeExtractedFieldsForClassification } = require('../services/pipeline');
const { mergeReextractedStatementAttributes } = require('../services/statementAttributes');

function getPdfPageCount(filePath) {
  try {
    const output = execFileSync('identify', [filePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.split(/\r?\n/).filter((line) => line.trim()).length || 1;
  } catch {
    return 1;
  }
}

function convertPdfPage(filePath, page, imagePath) {
  execFileSync('convert', ['-density', '200', `${filePath}[${page}]`, '-quality', '95', imagePath], {
    timeout: 30000,
  });
}

const prompt = `Look at this document and do TWO things:

1. CLASSIFY it as exactly one of: "invoice", "receipt", "statement", "coi", "w9", "other"
2. If it's an INVOICE or RECEIPT, extract the fields below. If neither, set extracted to null.

Return ONLY valid JSON:
{
  "classification": "invoice|receipt|statement|coi|w9|other",
  "confidence": 0.95,
  "extracted": {
    "vendorName": "Company/store name",
    "vendorAddress": "Full address or null",
    "invoiceNumber": "Invoice/receipt/transaction number or null",
    "invoiceDate": "YYYY-MM-DD or null",
    "dueDate": "YYYY-MM-DD or payment terms or null",
    "amount": 0.00,
    "jobNumber": "Top-level job/project number like 25-554 or null (null if multiple jobs)",
    "projectName": "Top-level project name or null (null if multiple projects)",
    "projectAddress": "Job site / project address if different from vendor address, or null",
    "description": "Brief description of work/services/purchase",
    "lineItems": [
      {
        "description": "Line item description",
        "amount": 0.00,
        "jobRef": "Job name, number, or abbreviation for THIS line item. null if not specified.",
        "jobAddress": "Job site address for this line item if mentioned. null if not specified."
      }
    ]
  }
}

IMPORTANT: Each line item may reference a DIFFERENT job/project. Extract the job reference per line item.
If not an invoice or receipt, return: {"classification": "type", "confidence": 0.95, "extracted": null}
Be precise. Use null for fields not visible. For amounts, use numbers not strings.`;

async function reExtract(docId) {
  // Fetch the document from Supabase
  const { rows } = await pool.query(
    `SELECT id, file_path, file_name, classification, confidence,
            invoice_number, amount, job_number, line_items,
            email_message_id, email_from, email_subject,
            vendor_name, vendor_address, invoice_date, due_date,
            project_name, project_address, description,
            split_from, statement_attributes
     FROM documents WHERE id = $1`,
    [docId]
  );
  const item = rows[0];
  if (!item) { console.log('Not found:', docId); return; }
  if (!item.file_path || !fs.existsSync(item.file_path)) { console.log('No file:', docId, item.file_path); return; }

  console.log(`\nRe-extracting: ${item.file_name} (${docId})`);

  // Convert all pages
  const imagePaths = [];
  try {
    const pageCount = Math.min(getPdfPageCount(item.file_path), 5);
    console.log(`  ${pageCount} page(s)`);
    for (let p = 0; p < pageCount; p++) {
      const imgPath = `/tmp/reextract_${Date.now()}_p${p}.png`;
      convertPdfPage(item.file_path, p, imgPath);
      imagePaths.push(imgPath);
    }
  } catch (e) {
    console.log(`  PDF conversion failed: ${e.message}`);
    return;
  }

  // Use classification-specific prompts for COIs and statements
  const { buildStatementExtractionPrompt } = require('../services/pipeline');
  const effectivePrompt = (item.classification === 'coi')
    ? buildCoiExtractionPrompt()
    : (item.classification === 'statement')
      ? buildStatementExtractionPrompt()
      : prompt;

  // Send to Haiku
  const imageDataList = imagePaths.map(p => fs.readFileSync(p).toString('base64'));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.log('  No API key'); imagePaths.forEach(p => { try { fs.unlinkSync(p); } catch {} }); return; }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          ...imageDataList.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })),
          { type: 'text', text: imagePaths.length > 1 ? `This document has ${imagePaths.length} pages. Review ALL pages.\n\n${effectivePrompt}` : effectivePrompt },
        ],
      }],
    }),
  });

  // Cleanup temp files
  imagePaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });

  if (!resp.ok) {
    console.log(`  Haiku API error: ${resp.status}`);
    return;
  }

  const result = await resp.json();
  const text = result.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) { console.log('  Could not parse response'); return; }

  const parsed = JSON.parse(jsonMatch[0]);
  // Enforce the active-classification invariant before any DB write.
  const { enforceActiveClassification } = require('../services/pipeline');
  parsed.classification = await enforceActiveClassification(parsed.classification, 're-extract');
  console.log(`  Classification: ${parsed.classification}`);
  
  if (parsed.extracted) {
    const ext = parsed.extracted;
    console.log(`  Before: inv#=${item.invoice_number} amt=${item.amount} job=${item.job_number}`);
    console.log(`  After:  inv#=${ext.invoiceNumber} amt=${ext.amount} job=${ext.jobNumber}`);

    // COI extraction emits `insuredName` (the vendor on a cert), not
    // `vendorName`. Mirror pipeline per-type matching (pipeline.js matchVendor
    // for coi): match by insured name and ignore the sender email — certs are
    // typically forwarded from internal NCG addresses.
    const isCoi = parsed.classification === 'coi';
    if (isCoi && !ext.vendorName) ext.vendorName = ext.insuredName || null;

    // Re-run matcher (now async)
    const matching = await matchInvoice({
      ...ext,
      emailSubject: item.email_subject,
      senderEmail: isCoi ? null : item.email_from,
    });

    // Token usage
    const usage = result.usage;
    const tokensUsed = usage ? { input: usage.input_tokens, output: usage.output_tokens } : null;
    if (usage) console.log(`  Tokens: ${usage.input_tokens} in / ${usage.output_tokens} out`);

    // Self-vendor guard + canonical name override
    const { isSelfVendor } = require('../services/matcher');
    if (isSelfVendor(null, ext.vendorName)) ext.vendorName = null;
    if (matching.vendor?.vendorCode && matching.vendor?.vendorName) {
      ext.vendorName = matching.vendor.vendorName;
    }

    console.log(`  Vendor: ${matching.vendor?.vendorCode} (${ext.vendorName}) | Job: ${matching.job?.jobNumber} | Sub: ${matching.subcontract?.subcontractNumber}`);

    // Update document in Supabase
    await pool.query('BEGIN');
    try {
    const lockedAttributes = parsed.classification === 'statement'
      ? (await pool.query('SELECT statement_attributes FROM documents WHERE id = $1 FOR UPDATE', [docId])).rows[0]?.statement_attributes
      : item.statement_attributes;
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
        coi_data = $25,
        statement_attributes = $26,
        updated_at = NOW()
      WHERE id = $27`,
      [
        parsed.classification,
        parsed.confidence || null,
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
        matching.vendor?.vendorCode || null,
        matching.vendor?.confidence || null,
        matching.vendor?.method || null,
        matching.vendor?.vendorName || null,
        matching.job?.jobNumber || null,
        matching.job?.confidence || null,
        matching.job?.method || null,
        matching.subcontract?.subcontractNumber || null,
        matching.subcontract?.confidence || null,
        matching.subcontract?.method || null,
        matching.overallConfidence || null,
        (() => {
          // For COI re-extractions, normalize and persist structured COI data
          if (parsed.classification === 'coi' && parsed.extracted) {
            const normalized = normalizeExtractedFieldsForClassification('coi', parsed.extracted);
            return normalized?._coiData ? JSON.stringify(normalized._coiData) : null;
          }
          return null;
        })(),
        parsed.classification === 'statement'
          ? JSON.stringify(mergeReextractedStatementAttributes(lockedAttributes, ext))
        : item.statement_attributes,
        docId,
      ]
    );
    await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    console.log(`  ✓ Saved to Supabase`);
  }
}

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) {
    // Auto-detect from Supabase: docs missing key data or with multi-page PDFs
    const { rows } = await pool.query(
      `SELECT id, file_path, split_from, invoice_number, amount
       FROM documents
       WHERE file_path IS NOT NULL
         AND file_path LIKE '%.pdf'
       ORDER BY created_at DESC`
    );

    for (const row of rows) {
      if (!fs.existsSync(row.file_path)) continue;
      const missing = !row.invoice_number || !row.amount;
      let multiPage = false;
      try { multiPage = getPdfPageCount(row.file_path) > 1; } catch {}
      // Skip already-split entries — their per-line data is correct
      if (row.split_from && row.amount) continue;
      if (missing || multiPage) ids.push(row.id);
    }
    console.log(`Auto-detected ${ids.length} items to re-extract`);
  }
  for (const id of ids) await reExtract(id);
  await pool.end();
  console.log('\nDone.');
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { convertPdfPage, getPdfPageCount, reExtract, main };
