#!/usr/bin/env node
/**
 * Invoice PDF Extractor — PDF → Image → Haiku Vision → Structured JSON
 * 
 * Cost: ~$0.01-0.02 per page (Haiku vision)
 * 
 * Usage:
 *   node extractor.js <pdf-path> [--output <json-path>]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { callHaiku } = require('../services/vision');
const { sanitizePathForShell } = require('../services/sanitize');

const EXTRACTED_DIR = path.join(__dirname, '..', 'data', 'extracted');

const EXTRACTION_PROMPT = `Extract the following fields from this invoice image. Return ONLY valid JSON, no markdown or explanation.

{
  "vendorName": "Company name on the invoice",
  "vendorAddress": "Full address if visible",
  "invoiceNumber": "Invoice/bill number (null if not found)",
  "invoiceDate": "Date on the invoice (YYYY-MM-DD format)",
  "dueDate": "Due date or payment terms (YYYY-MM-DD or 'Net 30' etc)",
  "amount": "Total amount as a number (no $ sign)",
  "jobNumber": "Top-level job/project number if one applies to the whole invoice (e.g. '25-554', null if multiple jobs or not found)",
  "projectName": "Top-level project name if one applies to the whole invoice (null if multiple)",
  "projectAddress": "Job site / project address if different from vendor address (null if not found)",
  "description": "Brief description of work/services",
  "lineItems": [
    {
      "description": "Line item description",
      "amount": 0.00,
      "jobRef": "Job name, number, or abbreviation for THIS line item (e.g. 'NPX', '25-554', 'Harbor Point'). null if not specified.",
      "jobAddress": "Job site address for this line item if mentioned. null if not specified."
    }
  ]
}

IMPORTANT: Each line item may reference a DIFFERENT job/project. Extract the job reference per line item, not just at the invoice level. Job references can be abbreviations (e.g. "NPX", "GLX"), full names, or numbers (e.g. "25-554").

Be precise. If a field is not visible, use null. For amounts, use numbers not strings.`;

/**
 * Convert PDF page to PNG using ImageMagick
 */
function pdfToImage(pdfPath, page = 0, density = 200) {
  const tmpPng = path.join('/tmp', `invoice_extract_${Date.now()}_p${page}.png`);
  execSync(`convert -density ${density} "${sanitizePathForShell(pdfPath)}"[${page}] -quality 95 "${sanitizePathForShell(tmpPng)}"`, {
    timeout: 30000,
  });
  return tmpPng;
}

/**
 * Count pages in a PDF
 */
function getPdfPageCount(pdfPath) {
  try {
    const output = execSync(`identify "${sanitizePathForShell(pdfPath)}" 2>/dev/null | wc -l`, { encoding: 'utf8' });
    return parseInt(output.trim()) || 1;
  } catch {
    return 1; // assume single page
  }
}

async function extractWithVision(imagePath) {
  const imageData = fs.readFileSync(imagePath).toString('base64');
  const result = await callHaiku([{ data: imageData, mediaType: 'image/png' }], EXTRACTION_PROMPT, 2000);
  const text = result.text;

  // Parse JSON from response (handle potential markdown wrapping)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Could not parse JSON from Haiku response: ${text.slice(0, 200)}`);

  return JSON.parse(jsonMatch[0]);
}

/**
 * Extract invoice data from a PDF file.
 * Processes first page only (most invoices are single-page).
 * For multi-page, extracts page 1 for header info.
 */
async function extractInvoice(pdfPath, opts = {}) {
  const pageCount = getPdfPageCount(pdfPath);
  const imagePath = pdfToImage(pdfPath, 0);

  try {
    const extracted = await extractWithVision(imagePath);

    // Add metadata
    extracted.sourcePdf = path.basename(pdfPath);
    extracted.pageCount = pageCount;
    extracted.extractedAt = new Date().toISOString();

    // Save extracted JSON
    if (opts.output) {
      fs.mkdirSync(path.dirname(opts.output), { recursive: true });
      fs.writeFileSync(opts.output, JSON.stringify(extracted, null, 2));
    }

    return extracted;
  } finally {
    // Cleanup temp image
    try { fs.unlinkSync(imagePath); } catch {}
  }
}

module.exports = { extractInvoice, pdfToImage, extractWithVision };

// --- CLI ---
if (require.main === module) {
  const args = process.argv.slice(2);
  const pdfPath = args[0];
  const outputIdx = args.indexOf('--output');
  const output = outputIdx >= 0 ? args[outputIdx + 1] : null;

  if (!pdfPath) {
    console.log('Usage: node extractor.js <pdf-path> [--output <json-path>]');
    process.exit(1);
  }

  fs.mkdirSync(EXTRACTED_DIR, { recursive: true });
  const defaultOutput = output || path.join(EXTRACTED_DIR, path.basename(pdfPath, '.pdf') + '.json');

  extractInvoice(pdfPath, { output: defaultOutput })
    .then(data => {
      console.log(JSON.stringify(data, null, 2));
      console.error(`Saved to: ${defaultOutput}`);
    })
    .catch(err => {
      console.error('Extraction failed:', err.message);
      process.exit(1);
    });
}
