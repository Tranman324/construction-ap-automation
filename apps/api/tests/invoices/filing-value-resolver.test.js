'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveFilingValue,
  resolveFilingValues,
} = require('../../modules/invoices/services/filingValueResolver');
const { buildCanonicalFilingFileName } = require('../../modules/invoices/services/sharepointFilename');
const { buildListItemFields } = require('../../modules/invoices/services/sharepointFilingService');
const { rowToDoc } = require('../../modules/invoices/services/supabase');

function row(overrides = {}) {
  return {
    id: 'resolver-1',
    classification: 'warranty',
    file_name: 'warranty.pdf',
    vendor_name: 'Extracted Vendor',
    matched_vendor_name: 'Matched Vendor',
    vendor_code: 'V-100',
    invoice_date: new Date('2026-07-31T00:00:00Z'),
    email_from: 'email-vendor@example.com',
    email_subject: 'Warranty workmanship',
    job_number: '26-401',
    job_match_number: '26-402',
    subcontract_number: '26-S001',
    amount: '12.50',
    ...overrides,
  };
}

test('resolveFilingValue enforces manual → extracted → matching → email and exposes provenance', () => {
  const all = resolveFilingValue({ manual: 'Manual', extracted: 'Extracted', matching: 'Matched', email: 'Email' });
  assert.deepEqual(all.value, 'Manual');
  assert.equal(all.provenance, 'manual');

  const extracted = resolveFilingValue({ extracted: 'Extracted', matching: 'Matched', email: 'Email' });
  assert.equal(extracted.value, 'Extracted');
  assert.equal(extracted.provenance, 'extracted');

  const matching = resolveFilingValue({ matching: 'Matched', email: 'Email' });
  assert.equal(matching.value, 'Matched');
  assert.equal(matching.provenance, 'matching');

  const email = resolveFilingValue({ email: 'Email' });
  assert.equal(email.value, 'Email');
  assert.equal(email.provenance, 'email');

  const empty = resolveFilingValue({});
  assert.equal(empty.value, null);
  assert.equal(empty.provenance, null);
});

test('resolveFilingValues applies the shared precedence to vendor, job, scope, and warranty classification', () => {
  const values = resolveFilingValues(row({
    filing_manual_values: { vendor: { value: 'Manual Vendor' }, jobNumber: '26-409', scope: 'Manual scope' },
  }));

  assert.deepEqual(values.vendor, { value: 'Manual Vendor', provenance: 'manual', permittedActions: [], blockers: [] });
  assert.deepEqual(values.job, { value: '26-409', provenance: 'manual', permittedActions: [], blockers: [] });
  assert.deepEqual(values.scope, { value: 'Manual scope', provenance: 'manual', permittedActions: [], blockers: [] });
  assert.equal(values.providerKind.value, 'Subcontractor');
  assert.equal(values.providerKind.provenance, 'computed');
  assert.equal(values.warrantyType.value, 'Warranty certificate');
});

test('resolveFilingValues ignores an unproven stale matched vendor and falls back to email', () => {
  const values = resolveFilingValues(row({
    vendor_name: null,
    vendor_code: null,
    vendor_match_method: null,
    matched_vendor_name: 'Stale Matched Vendor',
    email_from: 'current-vendor@example.com',
  }));
  assert.equal(values.vendor.value, 'current-vendor@example.com');
  assert.equal(values.vendor.provenance, 'email');
});

test('filename and SharePoint metadata consume the same resolved vendor, date, and job values', () => {
  const document = row({
    classification: 'invoice',
    filing_manual_values: { vendor: 'Manual Vendor' },
    vendor_name: 'Extracted Vendor',
    matched_vendor_name: 'Matched Vendor',
    email_from: 'email-vendor@example.com',
    invoice_number: 'INV-1',
  });
  assert.equal(buildCanonicalFilingFileName(document), 'INV Manual Vendor 07-31-26 INV-1.pdf');

  assert.deepEqual(buildListItemFields(document), {
    DocType: 'INV',
    JobNumber: '26-401',
    Vendor: 'Manual Vendor',
    DocDate: '2026-07-31',
    Amount: 12.5,
    SourceEmail: 'email-vendor@example.com',
    ToolboxId: 'resolver-1',
  });
});

test('row serialization exposes canonical filing values without mutating or querying the row', () => {
  const document = row({ filing_manual_values: { vendor: 'Manual Vendor' } });
  const serialized = rowToDoc(document);
  assert.equal(serialized.filing.vendor.value, 'Manual Vendor');
  assert.equal(serialized.filing.vendor.provenance, 'manual');
  assert.equal(serialized.filing.job.value, '26-401');
  assert.equal(serialized.filing.scope.value, 'Warranty workmanship');
  assert.equal(serialized.filing.providerKind.value, 'Subcontractor');
  assert.equal(serialized.filing.warrantyType.value, 'Workmanship');
  assert.equal(document.filing_manual_values.vendor, 'Manual Vendor');
});
