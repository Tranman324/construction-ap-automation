'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('invoice status routes guard optional request bodies', () => {
  const source = read('modules/invoices/services/invoiceStatusService.js');

  assert.match(source, /const reason = req\.body\?\.reason \|\| '';/);
  assert.match(source, /const \{ classification \} = req\.body \|\| \{};/);
});

test('invoice status mutations lock rows and validate reclassification values', () => {
  const source = read('modules/invoices/services/invoiceStatusService.js');

  assert.match(source, /SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/);
  assert.match(source, /SELECT classification, file_name, linked_lien_waiver_id FROM documents WHERE id = \$1 FOR UPDATE/);
  assert.match(source, /getActiveClassificationNames/);
  assert.match(source, /INVALID_CLASSIFICATION/);
  assert.match(source, /writeJsonFileAtomic/);
  assert.match(source, /fs\.renameSync\(tmpPath, filePath\)/);
});

test('statement line additions lock the statement row before writing JSONB lines', () => {
  const source = read('modules/invoices/services/statementLineService.js');

  assert.match(source, /SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/);
  assert.match(source, /withTransaction/);
  assert.match(source, /statement_lines = \$1::jsonb/);
});

test('rules engine builds document updates through a whitelisted patch builder', () => {
  const engine = read('modules/invoices/scripts/rules-engine.js');
  const rulesRoute = read('modules/invoices/routes/rules.js');
  const rulesService = read('modules/invoices/services/rulesService.js');
  const pipeline = read('modules/invoices/services/pipeline.js');

  assert.match(engine, /const ALLOWED_PATCH_FIELDS = new Set/);
  assert.match(engine, /function buildPatchUpdate\(patches, startParamIndex = 2\)/);
  assert.match(engine, /ALLOWED_PATCH_FIELDS\.has\(field\)/);
  assert.match(rulesRoute, /buildPatchUpdate\(patches, 2\)/);
  assert.match(rulesRoute, /await applyRulePatch\(\{ documentId: docId, patchUpdate, matchedRules \}\)/);
  assert.match(rulesService, /emitLegacyInvoiceAuditEvent\(documentId, 'rules-applied'/);
  assert.match(pipeline, /buildPatchUpdate\(patches, 2\)/);
  assert.match(pipeline, /applyRulePatch\(\{ documentId: docId, patchUpdate, matchedRules, db: pool \}\)/);
});

test('invoice child collection routes 404 when the parent invoice does not exist', () => {
  const linkedDocuments = read('modules/invoices/services/linkedDocumentsService.js');
  const invoiceFiles = read('modules/invoices/services/invoiceFileService.js');

  assert.match(linkedDocuments, /SELECT id FROM documents WHERE id = \$1/);
  assert.match(linkedDocuments, /fail\(res, 404, 'Document not found'\)/);
  assert.match(invoiceFiles, /SELECT id FROM documents WHERE id = \$1/);
  assert.match(invoiceFiles, /fail\(res, 404, 'Invoice not found'\)/);
});

test('title rule delete returns 404 when no row is deleted', () => {
  const source = read('routes/title-rules.js');
  const service = read('services/titleRuleService.js');

  assert.match(service, /\.delete\(\)\.eq\('id', id\)\.select\('id'\)\.maybeSingle\(\)/);
  assert.match(source, /if \(!deleted\) \{[\s\S]*fail\(res, 404, 'Not found'\)/);
});

test('Spectrum COI upload service keeps server path configurable without requiring it at startup', () => {
  const source = read('modules/invoices/services/spectrumCoiUploadService.js');

  assert.match(source, /process\.env\.SPECTRUM_SCRIPTS_DIR \|\| '\/opt\/toolbox\/spectrum'/);
  assert.match(source, /function getCoiUpload\(\)/);
  assert.match(source, /require\(path\.join\(SPECTRUM_SCRIPTS, 'lib', 'coi-upload'\)\)/);
});
