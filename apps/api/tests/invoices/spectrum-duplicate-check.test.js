'use strict';

/**
 * Spectrum-side duplicate detection (2026-09-02).
 *
 * Why this exists: the pipeline's Toolbox duplicate check (findDuplicate)
 * only sees documents that came through this pipeline. Invoices entered or
 * paid directly in Spectrum (pre-Toolbox history) were invisible to it —
 * first caught case: doc-1700000000000-demo, a resend of VEND07 invoice
 * #1920 that Spectrum payment history shows as paid 2026-06-08 ($11,589.42).
 *
 * Design (ratified by the product owner 2026-09-02, #invoice-pipeline-walkthrough thread):
 * piggyback the statement reconciler's Spectrum lookup rather than build a
 * second matcher — spectrum.findSpectrumInvoice does a normalized
 * invoice-number + exact vendor-code match across all three AP tables
 * (VN_OPEN_ITEMS_MC, VN_INVOICE_APPROVAL_HDR_MC, VN_PAYMENT_HISTORY_MC) and
 * fails open (Spectrum downtime → null → no flag, ingestion never blocks).
 * One shared lookup, two consumers, no drift.
 *
 * These are static contract tests: they pin the wiring so a refactor can't
 * silently detach the pipeline from the shared lookup or change its shape.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const pipelineSource = fs.readFileSync(path.join(root, 'modules/invoices/services/pipeline.js'), 'utf8');
const spectrumSource = fs.readFileSync(path.join(root, 'modules/invoices/services/spectrum.js'), 'utf8');

test('pipeline reuses the statement reconciler Spectrum lookup — no second matcher', () => {
  // The pipeline must call the shared findSpectrumInvoice, not carry its own
  // Spectrum SQL. All AP-table names live only in spectrum.js.
  assert.match(pipelineSource, /const \{ findSpectrumInvoice \} = require\('\.\/spectrum'\);/);
  assert.doesNotMatch(pipelineSource, /VN_OPEN_ITEMS_MC|VN_INVOICE_APPROVAL_HDR_MC|VN_PAYMENT_HISTORY_MC/);
  assert.match(spectrumSource, /VN_OPEN_ITEMS_MC[\s\S]*VN_INVOICE_APPROVAL_HDR_MC[\s\S]*VN_PAYMENT_HISTORY_MC/);
});

test('Spectrum check runs only on a Toolbox-duplicate miss and requires a resolved vendor code', () => {
  // Shape: if (duplicate) { ...Toolbox flag... } else if (entryVendorCode) { ...Spectrum check... }
  // - Toolbox hit already flags; no second lookup needed.
  // - Spectrum matching is vendor-code-keyed; an email domain alone can't be checked.
  const guard = /\}\s*else if \(entryVendorCode\) \{[\s\S]{0,1800}?findSpectrumInvoice\(\{ invoiceNumber: entryInvNum, vendorCode: entryVendorCode \}\)/;
  assert.match(pipelineSource, guard);
});

test('a Spectrum hit flags the document and appends (never overwrites) the note', () => {
  const block = pipelineSource.match(/else if \(entryVendorCode\) \{([\s\S]{0,2500}?)\n {10}\}/);
  assert.ok(block, 'Spectrum duplicate block not found');
  assert.match(block[1], /queueEntry\.flagged = true;/);
  // Append semantics: earlier pipeline notes (e.g. "OCR applied") must survive.
  assert.match(block[1], /queueEntry\.notes = queueEntry\.notes \? `\$\{queueEntry\.notes\}; \$\{spectrumNote\}` : spectrumNote;/);
  // No duplicateOf — there is no Toolbox document to link to.
  assert.doesNotMatch(block[1], /queueEntry\.duplicateOf =/);
});

test('shared Spectrum lookup keeps its fail-open contract', () => {
  // findSpectrumInvoice must keep returning null on error so ingestion (and
  // statement reconciliation) never block on Spectrum downtime.
  const fn = spectrumSource.match(/async function findSpectrumInvoice[\s\S]*?\n\}/);
  assert.ok(fn, 'findSpectrumInvoice not found');
  assert.match(fn[0], /catch \(err\) \{[\s\S]*?return null;/);
});
