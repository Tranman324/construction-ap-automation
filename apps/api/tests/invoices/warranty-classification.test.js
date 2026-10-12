'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { classifyMigrationSql } = require('../../lib/migrations');
const { resolveFilingValues } = require('../../modules/invoices/services/filingValueResolver');
const { rowToDoc } = require('../../modules/invoices/services/supabase');

function row(overrides = {}) {
  return {
    id: 'warranty-1',
    classification: 'warranty',
    file_name: 'warranty.pdf',
    vendor_name: 'Current Vendor',
    job_number: '26-401',
    description: 'Equipment installation',
    subcontract_number: '26-S001',
    email_subject: 'Warranty certificate',
    ...overrides,
  };
}

test('warranty provider kind is live-computed from subcontract linkage', () => {
  assert.equal(resolveFilingValues(row()).providerKind.value, 'Subcontractor');
  assert.equal(resolveFilingValues(row({ subcontract_number: null })).providerKind.value, 'Vendor');
  assert.equal(resolveFilingValues(row({ subcontract_number: null })).providerKind.provenance, 'computed');
});

test('warranty type is computed from canonical scope and defaults safely', () => {
  const workmanship = resolveFilingValues(row({ description: 'Workmanship warranty' }));
  assert.deepEqual(
    { value: workmanship.warrantyType.value, provenance: workmanship.warrantyType.provenance },
    { value: 'Workmanship', provenance: 'computed' },
  );
  const fallback = resolveFilingValues(row({ description: 'Coverage certificate' }));
  assert.equal(fallback.warrantyType.value, 'Warranty certificate');
});

test('manual warranty values win and survive source/rematch changes without a read write', () => {
  const manual = {
    providerKind: { value: 'Manufacturer', setBy: 'user-1', setAt: '2026-07-31T12:00:00Z' },
    warrantyType: { value: 'Extended coverage', setBy: 'user-1', setAt: '2026-07-31T12:00:00Z' },
  };
  const document = row({
    warranty_manual_values: manual,
    subcontract_number: null,
    description: 'Workmanship warranty',
    vendor_name: 'Changed Vendor',
  });
  const before = JSON.stringify(document);
  const first = resolveFilingValues(document);
  const second = resolveFilingValues({ ...document, subcontract_number: '26-S999', description: 'New scope' });
  assert.equal(first.providerKind.provenance, 'manual');
  assert.equal(first.providerKind.value, 'Manufacturer');
  assert.equal(second.providerKind.value, 'Manufacturer');
  assert.equal(second.warrantyType.value, 'Extended coverage');
  assert.equal(JSON.stringify(document), before);
});

test('clear-ready manual-only storage falls back to current computation and never persists computed values', () => {
  const document = row({
    warranty_manual_values: {
      providerKind: { value: null, setBy: 'user-1', setAt: '2026-07-31T12:00:00Z' },
    },
    subcontract_number: null,
    description: 'Workmanship warranty',
  });
  const serialized = rowToDoc(document);
  assert.deepEqual(
    { value: serialized.filing.providerKind.value, provenance: serialized.filing.providerKind.provenance },
    { value: 'Vendor', provenance: 'computed' },
  );
  assert.deepEqual(
    { value: serialized.filing.warrantyType.value, provenance: serialized.filing.warrantyType.provenance },
    { value: 'Workmanship', provenance: 'computed' },
  );
  assert.equal(document.warranty_manual_values.providerKind.value, null);
  assert.equal(document.warranty_manual_values.warrantyType, undefined);
});

test('manual warranty values are isolated from unrelated document classifications', () => {
  const invoice = row({
    classification: 'invoice',
    warranty_manual_values: { providerKind: { value: 'Manufacturer' }, warrantyType: { value: 'Extended' } },
  });
  const serialized = rowToDoc(invoice);
  assert.equal(serialized.filing.providerKind.value, 'Subcontractor');
  assert.equal(serialized.filing.providerKind.provenance, 'computed');
  assert.equal(serialized.filing.warrantyType.value, 'Warranty certificate');
});

test('malformed manual warranty metadata falls back to the live computed classification', () => {
  const document = row({
    warranty_manual_values: {
      providerKind: { value: 'Manufacturer', setBy: 'user-1' },
      warrantyType: { value: 'Extended coverage', setAt: '2026-07-31T12:00:00Z' },
    },
  });
  const values = resolveFilingValues(document);
  assert.equal(values.providerKind.value, 'Subcontractor');
  assert.equal(values.providerKind.provenance, 'computed');
  assert.equal(values.warrantyType.value, 'Warranty certificate');
  assert.equal(values.warrantyType.provenance, 'computed');
});

test('future-dated manual warranty metadata is not accepted as an intact manual value', () => {
  const values = resolveFilingValues(row({
    warranty_manual_values: {
      providerKind: { value: 'Manufacturer', setBy: 'user-1', setAt: '2999-01-01T00:00:00Z' },
    },
  }));
  assert.equal(values.providerKind.value, 'Subcontractor');
  assert.equal(values.providerKind.provenance, 'computed');
});

test('non-string manual warranty values fall back to computed classifications', () => {
  const outcomes = [{ label: 'Manufacturer' }, 42, true].map((value) => {
    const values = resolveFilingValues(row({
      warranty_manual_values: {
        providerKind: { value, setBy: 'user-1', setAt: '2026-07-31T12:00:00Z' },
      },
    }));
    return { value: values.providerKind.value, provenance: values.providerKind.provenance };
  });
  assert.deepEqual(outcomes, [
    { value: 'Subcontractor', provenance: 'computed' },
    { value: 'Subcontractor', provenance: 'computed' },
    { value: 'Subcontractor', provenance: 'computed' },
  ]);
});

test('invoice list projection selects the warranty manual-values column for canonical list serialization', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../modules/invoices/services/invoiceCollectionService.js'),
    'utf8',
  );
  assert.match(source, /\bwarranty_manual_values\b/);
});

test('warranty manual-values migration is additive, transactional, and safe-rerun classified', () => {
  const filename = '2026-07-31_warranty_manual_values.sql';
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations', filename), 'utf8');
  assert.match(sql, /^\s*BEGIN;\s/i);
  assert.match(sql, /\sCOMMIT;\s*$/i);
  assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+warranty_manual_values\s+JSONB/i);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME|ALTER\s+COLUMN)\b/i);
  assert.equal(classifyMigrationSql(sql).classification, 'safe-rerun');
});
