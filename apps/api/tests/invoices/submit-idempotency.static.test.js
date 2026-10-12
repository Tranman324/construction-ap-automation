'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('submit route validates request body and claims approved invoices atomically', () => {
  const route = read('modules/invoices/routes/invoices.js');
  const submitWorkflow = read('modules/invoices/services/submitWorkflow.js');
  const submitState = read('modules/invoices/services/submitState.js');
  const schemas = read('lib/schemas.js');

  assert.match(schemas, /const invoiceSubmitSchema = z\.object/);
  assert.match(route, /router\.post\('\/submit', requirePermission\('accounting\.invoices\.submit_spectrum'\), validate\(invoiceSubmitSchema\), async/);
  assert.match(submitWorkflow, /claimInvoicesForSubmit\(pool, ids, now\)/);
  assert.match(submitState, /UPDATE documents\s+SET status = 'submitting', submit_error = NULL, updated_at =/);
  assert.match(submitState, /WHERE id IN \(\$\{idPlaceholders\}\)\s+AND status = 'approved'\s+AND classification IN \('invoice', 'pay-application'\)\s+AND \$\{WAIVER_GATE_SQL\}/);
  assert.match(submitState, /WHERE status = 'approved'\s+AND classification IN \('invoice', 'pay-application'\)\s+AND \$\{WAIVER_GATE_SQL\}\s+AND submit_error IS NULL/);
  // Lien waiver gate enforced at claim time (2026-07-14)
  assert.match(submitState, /lien_waiver_required IS NOT TRUE/);
  assert.match(submitState, /linked_lien_waiver_id IS NOT NULL/);
  assert.match(submitState, /lien_waiver_status IS NOT DISTINCT FROM 'attached'/);
  assert.match(submitState, /waiver_on_document IS TRUE/);
  // The preflight/claim copies must remain the Boolean inverse of the visible
  // missing-waiver marker, including nullable pipeline state.
  assert.match(submitWorkflow, /lien_waiver_required IS NOT TRUE[\s\S]*linked_lien_waiver_id IS NOT NULL[\s\S]*lien_waiver_status IS NOT DISTINCT FROM 'attached'[\s\S]*waiver_on_document IS TRUE/);
  assert.match(submitState, /RETURNING \$\{SUBMIT_INVOICE_FIELDS\}/);
  assert.match(submitWorkflow, /if \(!\['invoice', 'pay-application'\]\.includes\(doc\.classification\)\)/);
  assert.match(submitWorkflow, /return res\.json\(\{\s+success: false,\s+submitted: 0,\s+total: results\.length,[\s\S]+results,\s+\}\)/);
});

test('submit route reverts claimed rows on validation, Spectrum, and unexpected failures', () => {
  const submitWorkflow = read('modules/invoices/services/submitWorkflow.js');
  const submitResult = read('modules/invoices/services/submitResult.js');
  const submitState = read('modules/invoices/services/submitState.js');

  assert.match(`${submitWorkflow}\n${submitResult}`, /revertClaimedInvoices\(\s+pool,/);
  assert.match(submitState, /async function revertClaimedInvoices/);
  assert.match(submitState, /SET status = 'approved', submit_error = \$1, updated_at = \$2/);
  assert.match(submitState, /AND status = 'submitting'/);
  assert.match(submitWorkflow, /Submission validation failed before Spectrum request/);
  assert.match(submitWorkflow, /Spectrum API unreachable before submission completed/);
  assert.match(submitResult, /No Spectrum result returned for invoice/);
  assert.match(submitResult, /Spectrum returned an invalid invoice result list/);
  assert.match(submitResult, /Spectrum rejected invoice/);
  assert.match(submitWorkflow, /Submission failed after claim; verify Spectrum before retrying/);
});

test('submit route blocks duplicate local Spectrum identities before it claims or posts invoices', () => {
  const submitWorkflow = read('modules/invoices/services/submitWorkflow.js');
  const submitResult = read('modules/invoices/services/submitResult.js');

  assert.match(submitWorkflow, /findSubmissionPreflight\(pool, ids\)/);
  assert.match(submitWorkflow, /return rejectDuplicateSubmissionIdentities\(res, duplicateIdentities\)/);
  assert.match(submitWorkflow, /const \{[\s\S]+?duplicateIdentities,[\s\S]+?\} = await findSubmissionPreflight[\s\S]+?const claimedRows = await claimInvoicesForSubmit/);
  assert.match(submitWorkflow, /id = ANY\(\$1\)/);
  assert.match(submitWorkflow, /TRIM\(selected\.vendor_code\) = TRIM\(documents\.vendor_code\)/);
  assert.match(submitWorkflow, /TRIM\(selected\.invoice_number\) = TRIM\(documents\.invoice_number\)/);
  assert.match(submitResult, /spectrumInvoiceIdentity/);
  assert.doesNotMatch(submitResult, /\.shift\(\)/);
});

test('submit route finalizes only claimed rows and preserves legacy submit side effects', () => {
  const submitResult = read('modules/invoices/services/submitResult.js');
  const submitState = read('modules/invoices/services/submitState.js');

  assert.match(submitResult, /async function finalizeSubmissionAndDiscardLinkedWaiver/);
  assert.match(submitResult, /withTransaction\(pool, async \(db\) => \{[\s\S]*finalizeSubmittedInvoice\(db, docId, now\)[\s\S]*SELECT linked_lien_waiver_id FROM documents WHERE id = \$1 FOR UPDATE[\s\S]*discardLinkedLienWaiverForSubmittedInvoice/);
  assert.match(submitState, /UPDATE documents SET status = \$1, submit_error = NULL, updated_at = \$2 WHERE id = \$3 AND status = \$4/);
  assert.match(submitResult, /await audit\(docId, 'submitted', \{ spectrumInvoiceNumber: row\.invoice_number \}\)/);
  assert.match(submitResult, /UPDATE documents SET status = \$1, updated_at = \$2 WHERE linked_to = \$3/);
  assert.match(submitResult, /await audit\(linked\.id, 'submitted', \{ reason: `linked to \$\{docId\}` \}\)/);
});

test('startup recovery returns stale submitting invoices to approved without blocking startup', () => {
  const service = read('modules/invoices/services/submitRecovery.js');
  const server = read('server.js');
  const config = read('config.js');

  assert.match(config, /SUBMIT_STALE_RECOVERY_MINUTES/);
  assert.match(service, /Submit interrupted - verify in Spectrum before retrying/);
  assert.match(service, /SET status = 'approved',\s+submit_error = \$1,\s+updated_at = NOW\(\)/);
  assert.match(service, /WHERE status = 'submitting'\s+AND updated_at < NOW\(\) - \(\$2::int \* INTERVAL '1 minute'\)/);
  assert.match(server, /recoverStaleSubmittingInvoices\(\)\.catch/);
  assert.match(server, /Stale submit recovery failed/);
});

test('stale recovery and classification retry do not bypass the submit GL preflight', () => {
  const recovery = read('modules/invoices/services/submitRecovery.js');
  const invoiceStatus = read('modules/invoices/services/invoiceStatusService.js');

  assert.doesNotMatch(recovery, /submitPayload|buildSpectrumSubmission|postToSpectrum/);
  assert.match(recovery, /WHERE status = 'submitting'/);
  assert.doesNotMatch(invoiceStatus, /submitPayload|buildSpectrumSubmission|postToSpectrum/);
  assert.match(invoiceStatus, /async function retryInvoice/);
  assert.match(invoiceStatus, /Only error items can be retried/);
  assert.match(invoiceStatus, /reprocess-errors\.js/);
});
