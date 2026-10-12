'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  MAX_BASE_LENGTH,
  buildCanonicalFilingFileName,
  buildCanonicalSharePointFileName,
  buildFilingPreview,
  buildSharePointFileName,
  resolveCanonicalFilenameCollision,
  sanitizeSharePointFilename,
} = require('../../modules/invoices/services/sharepointFilename');

const filenameGoldenVectors = require(path.resolve(
  __dirname,
  '../../../..',
  'test-fixtures/invoices/filename-golden-vectors.json'
));

function baseLength(fileName) {
  return fileName.replace(/\.[^.]+$/, '').length;
}

test('buildSharePointFileName produces approved invoice, receipt, and permit examples', () => {
  assert.equal(
    buildSharePointFileName({
      type: 'invoice',
      vendor: 'Halden Brooks Electrical Contractors',
      date: '2026-06-15',
      ref: '#2',
      extension: 'pdf',
    }),
    'INV Halden Brooks 06-15-26 #2.pdf'
  );

  assert.equal(
    buildSharePointFileName({
      type: 'receipt',
      vendor: 'Home Depot',
      date: '2026-06-16',
      extension: 'pdf',
    }),
    'RCT Home Depot 06-16-26.pdf'
  );

  assert.equal(
    buildSharePointFileName({
      type: 'building-permit',
      vendor: 'Springfield',
      date: '2026-06-09',
      ref: 'BLDG2606070375',
      extension: 'pdf',
    }),
    'PMT Springfield 06-09-26.pdf'
  );
});

test('buildSharePointFileName sanitizes SharePoint-illegal characters in generated parts', () => {
  const fileName = buildSharePointFileName({
    type: 'warranty',
    vendor: 'A&B / Roofing: East {Phase}',
    date: '2026-07-02',
    ref: 'WO?12',
    extension: '.PDF',
  });

  assert.equal(fileName, 'WTY AB Roofing 07-02-26 WO12.pdf');
  assert.doesNotMatch(fileName, /[~"%&*:<>?/\\{|}]/);
  assert.ok(baseLength(fileName) <= MAX_BASE_LENGTH);
});

test('buildSharePointFileName dedupes collisions with numeric suffixes', () => {
  const fileName = buildSharePointFileName({
    type: 'coi',
    vendor: 'Tidewater Commercial Flooring',
    date: '2026-06-24',
    extension: 'pdf',
    existingNames: [
      'COI Tidewater 06-24-26.pdf',
      'COI Tidewater 06-24-26 (2).pdf',
    ],
  });

  assert.equal(fileName, 'COI Tidewater 06-24-26 (3).pdf');
  assert.ok(baseLength(fileName) <= MAX_BASE_LENGTH);
});

test('sanitizeSharePointFilename preserves legal overrides and dedupes conflicts', () => {
  assert.equal(
    sanitizeSharePointFilename('Custom Filing Name.pdf', {
      existingNames: ['Custom Filing Name.pdf'],
    }),
    'Custom Filing Name (2).pdf'
  );
});

test('buildCanonicalSharePointFileName reproduces every frozen filename candidate', () => {
  const mismatches = filenameGoldenVectors.vectors.map((vector) => {
    const actual = buildCanonicalSharePointFileName({
      type: vector.type,
      vendor: vector.vendor,
      date: vector.filingDate || vector.date,
      ref: vector.ref,
      extension: vector.extension,
    });

    return actual === vector.expected
      ? null
      : { name: vector.name, actual, expected: vector.expected };
  }).filter(Boolean);

  assert.deepEqual(mismatches, []);
});

test('filing-date provenance routes manual, matching, and COI expiration through the frozen candidates', () => {
  const vectors = Object.fromEntries(filenameGoldenVectors.vectors
    .filter((vector) => vector.filingDate)
    .map((vector) => [vector.name, vector]));
  const cases = [
    [vectors['manual filing date wins over extracted date'], {
      classification: 'invoice', vendor_name: 'Manual Date Vendor', invoice_date: '2026-01-01',
      invoice_number: 'MAN-1', file_name: 'source.pdf', filing_manual_values: { date: '2026-08-14' },
    }],
    [vectors['matching filing date wins when extraction is absent'], {
      classification: 'receipt', vendor_name: 'Matching Date Vendor', file_name: 'source.pdf',
      matching: { date: '2026-08-15' },
    }],
    [vectors['COI expiration supplies the filing date'], {
      classification: 'coi', vendor_code: 'COI Expiration Vendor', file_name: 'source.pdf',
      coi_data: { coverageLines: [{ expirationDate: '2027-03-31' }] },
    }],
  ];

  for (const [vector, row] of cases) {
    assert.equal(buildCanonicalFilingFileName(row), vector.expected, vector.name);
    assert.equal(buildCanonicalSharePointFileName({
      type: vector.type, vendor: vector.vendor, date: vector.filingDate, ref: vector.ref, extension: vector.extension,
    }), vector.expected, `${vector.name} generic parity`);
  }
});

test('canonical candidate generation is pre-collision and pure', () => {
  const input = {
    type: 'invoice',
    vendor: 'Collision Vendor',
    date: '2026-07-01T12:00:00.000Z',
    ref: null,
    extension: 'pdf',
  };
  const candidate = buildCanonicalSharePointFileName(input);
  assert.equal(
    buildCanonicalSharePointFileName({
      ...input,
      existingNames: [candidate],
    }),
    candidate
  );
});

test('canonical collision suffix truncates a full 128-character filename before appending', () => {
  const candidate = `${'A'.repeat(124)}.pdf`;
  const resolved = resolveCanonicalFilenameCollision(candidate, [candidate]);
  assert.equal(resolved, `${'A'.repeat(120)} (2).pdf`);
  assert.equal(resolved.length, 128);
});

test('filing preview is a computed resolved value and preserves the persisted row filename separately', () => {
  const document = {
    classification: 'invoice',
    vendor_name: 'Halden Brooks Electrical Contractors',
    invoice_date: new Date('2026-06-15T00:00:00.000Z'),
    invoice_number: '#2',
    file_name: 'source.pdf',
    sharepoint_filename: 'Historical Name.pdf',
  };

  assert.equal(buildCanonicalFilingFileName(document), 'INV Halden Brooks 06-15-26 #2.pdf');
  assert.deepEqual(buildFilingPreview(document), {
    fileName: {
      value: 'INV Halden Brooks 06-15-26 #2.pdf',
      provenance: 'computed',
      permittedActions: ['edit'],
      blockers: [],
    },
    date: {
      value: new Date('2026-06-15T00:00:00.000Z'),
      provenance: 'extracted',
      permittedActions: [],
      blockers: [],
    },
  });
  assert.equal(document.sharepoint_filename, 'Historical Name.pdf');
});

test('row serialization exposes filing.fileName while preserving historical sharepoint_filename', () => {
  const { rowToDoc } = require('../../modules/invoices/services/supabase');
  const invoice = rowToDoc({
    classification: 'invoice',
    vendor_name: 'Halden Brooks Electrical Contractors',
    invoice_date: new Date('2026-06-15T00:00:00.000Z'),
    invoice_number: '#2',
    file_name: 'source.pdf',
    sharepoint_filename: 'Historical Name.pdf',
  });

  assert.equal(invoice.filing.fileName.value, 'INV Halden Brooks 06-15-26 #2.pdf');
  assert.equal(invoice.filing.fileName.provenance, 'computed');
  assert.equal(invoice.filing.date.value, '2026-06-15');
  assert.equal(invoice.sharePointFilename, 'Historical Name.pdf');
});
