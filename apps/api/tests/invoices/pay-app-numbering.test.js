'use strict';

// B4 (2026-07-24): pay-app invoice-number convention `{SUB} PA {n}` (fallback
// `{JOB} PA {n}`) applied at pipeline intake, plus the Spectrum vendor+invoice
// number collision pre-flight at submit time (real case: HALD01 "3" paid on
// the Ledgerline job colliding with Brightwater's pay app "3").

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const root = path.resolve(__dirname, '..', '..');

const { applyPayAppNumbering } = require('../../modules/invoices/services/pipeline');

// Mock DB for auto-increment tests
function mockDb(existingInvoiceNumbers = []) {
  return {
    query: async (_sql, _params) => ({
      rows: existingInvoiceNumbers.map(n => ({ invoice_number: n })),
    }),
  };
}

const emptyDb = mockDb();

function entryWith({ invoiceNumber, classification = 'pay-application', sub = null, job = null, vendor = 'TEST01', notes = undefined }) {
  return {
    classification,
    extracted: { invoiceNumber },
    matching: {
      vendor: vendor ? { vendorCode: vendor } : null,
      subcontract: sub ? { subcontractNumber: sub } : null,
      job: job ? { jobNumber: job } : null,
    },
    notes,
  };
}

test('applyPayAppNumbering renames a bare pay-app number to {SUB} PA {n}', async () => {
  const entry = entryWith({ invoiceNumber: '3', sub: '26-434.06', job: '26-434' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, emptyDb), true);
  assert.equal(entry.extracted.invoiceNumber, '26-434.06 PA 3');
  assert.match(entry.notes, /Original invoice number "3" renamed to "26-434\.06 PA 3"/);
});

test('applyPayAppNumbering falls back to {JOB} PA {n} when no subcontract matched', async () => {
  const entry = entryWith({ invoiceNumber: '12', sub: null, job: '26-434' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, emptyDb), true);
  assert.equal(entry.extracted.invoiceNumber, '26-434 PA 12');
});

test('applyPayAppNumbering auto-increments missing pay-app numbers from existing', async () => {
  const db = mockDb(['26-434.06 PA 1', '26-434.06 PA 2']);
  const entry = entryWith({ invoiceNumber: null, sub: '26-434.06', job: '26-434' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, db), true);
  assert.equal(entry.extracted.invoiceNumber, '26-434.06 PA 3');
  assert.match(entry.notes, /Missing pay-app invoice number defaulted to "26-434\.06 PA 3"/);
});

test('applyPayAppNumbering starts at 1 when no existing PA numbers', async () => {
  const entry = entryWith({ invoiceNumber: null, sub: '26-434.06', job: '26-434' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, emptyDb), true);
  assert.equal(entry.extracted.invoiceNumber, '26-434.06 PA 1');
});

test('applyPayAppNumbering auto-increments with job fallback when no sub', async () => {
  const db = mockDb(['26-434 PA 1']);
  const entry = entryWith({ invoiceNumber: '', sub: null, job: '26-434' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, db), true);
  assert.equal(entry.extracted.invoiceNumber, '26-434 PA 2');
});

test('applyPayAppNumbering falls back to vendor code when no sub or job', async () => {
  const db = mockDb(['ZPIN91 PA 1', 'ZPIN91 PA 2']);
  const entry = entryWith({ invoiceNumber: null, sub: null, job: null, vendor: 'ZPIN91' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, db), true);
  assert.equal(entry.extracted.invoiceNumber, 'ZPIN91 PA 3');
});

test('applyPayAppNumbering triggers for bare numbers on subcontract-matched invoices too', async () => {
  const entry = entryWith({ invoiceNumber: '7', classification: 'invoice', sub: '26-101.02' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, emptyDb), true);
  assert.equal(entry.extracted.invoiceNumber, '26-101.02 PA 7');
});

test('applyPayAppNumbering skips non-bare invoice numbers', async () => {
  const entry = entryWith({ invoiceNumber: 'INV-1042', sub: '26-434.06' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, emptyDb), false);
  assert.equal(entry.extracted.invoiceNumber, 'INV-1042');
  assert.equal(entry.notes, undefined);
});

test('applyPayAppNumbering treats AIA form codes (G702, G703) as missing numbers', async () => {
  const entry = entryWith({ invoiceNumber: 'G702', sub: '26-438.02', job: '26-438' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, emptyDb), true);
  assert.equal(entry.extracted.invoiceNumber, '26-438.02 PA 1');
  assert.match(entry.notes, /Missing pay-app invoice number defaulted to/);
});

test('applyPayAppNumbering skips 4+ digit invoice numbers (real invoice numbers, not pay apps)', async () => {
  const entry = entryWith({ invoiceNumber: '20261', sub: '26-434.06' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, emptyDb), false);
  assert.equal(entry.extracted.invoiceNumber, '20261');
});

test('applyPayAppNumbering skips non-pay-app invoices without a subcontract match', async () => {
  const entry = entryWith({ invoiceNumber: '3', classification: 'invoice', sub: null, job: '26-434' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, emptyDb), false);
  assert.equal(entry.extracted.invoiceNumber, '3');
});

test('applyPayAppNumbering appends to existing notes and respects the 20-char Spectrum limit', async () => {
  const longSub = '26-434.06-EXTRA-LONG'; // "{sub} PA 3" would exceed char(20)
  const entry = entryWith({ invoiceNumber: '3', sub: longSub, job: '26-434', notes: 'existing note' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, emptyDb), true);
  assert.equal(entry.extracted.invoiceNumber, '26-434 PA 3'); // fell back to job
  assert.match(entry.notes, /^existing note; Original invoice number "3"/);
});

test('applyPayAppNumbering falls back to vendor code when no sub or job (bare number)', async () => {
  const entry = entryWith({ invoiceNumber: '3', sub: null, job: null, vendor: 'HALD01' });
  assert.equal(await applyPayAppNumbering(entry, () => {}, emptyDb), true);
  assert.equal(entry.extracted.invoiceNumber, 'HALD01 PA 3');
});

test('applyPayAppNumbering returns false when nothing usable (no sub, no job, no vendor)', async () => {
  const noMatch = entryWith({ invoiceNumber: '3', sub: null, job: null, vendor: null });
  assert.equal(await applyPayAppNumbering(noMatch, () => {}, emptyDb), false);
  assert.equal(noMatch.extracted.invoiceNumber, '3');

  const tooLong = entryWith({ invoiceNumber: '3', sub: 'X'.repeat(19), job: 'Y'.repeat(19), vendor: null });
  assert.equal(await applyPayAppNumbering(tooLong, () => {}, emptyDb), false);
  assert.equal(tooLong.extracted.invoiceNumber, '3');
});

// --- Spectrum collision pre-flight (submitWorkflow.findSpectrumInvoiceCollisions) ---

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function freshRequire(relativePath) {
  const resolved = require.resolve(path.join(root, relativePath));
  delete require.cache[resolved];
  return require(resolved);
}

async function runCollisionCheck(claimedRows, findSpectrumInvoice) {
  const lookups = [];
  let collisions;
  await withMockedModules({
    './spectrum': {
      findSpectrumInvoice: async (args) => {
        lookups.push(args);
        return findSpectrumInvoice(args);
      },
      postToSpectrum: async () => {
        throw new Error('postToSpectrum should not be called');
      },
    },
    './supabase': { pool: {}, audit: async () => {} },
  }, async () => {
    const { findSpectrumInvoiceCollisions } = freshRequire('modules/invoices/services/submitWorkflow.js');
    collisions = await findSpectrumInvoiceCollisions(claimedRows);
  });
  return { collisions, lookups };
}

test('findSpectrumInvoiceCollisions flags vendor+invoice numbers already in Spectrum with a PA rename suggestion', async () => {
  const rows = [
    { id: 'doc-1', invoice_number: '3', vendor_code: 'HALD01', subcontract_number: '26-434.06', job_match_number: '26-434' },
    { id: 'doc-2', invoice_number: 'INV-900', vendor_code: 'ACME01', subcontract_number: null, job_match_number: null },
  ];
  const { collisions, lookups } = await runCollisionCheck(rows, ({ invoiceNumber }) => (
    invoiceNumber === '3' ? { source: 'payment history', amount: 216616.5 } : null
  ));

  assert.equal(lookups.length, 2);
  assert.equal(collisions.length, 1);
  const [collision] = collisions;
  assert.equal(collision.id, 'doc-1');
  assert.equal(collision.spectrumSource, 'payment history');
  assert.match(collision.error, /already exists in Spectrum for vendor HALD01/);
  assert.match(collision.error, /Suggested rename: "26-434\.06 PA 3"/);
});

test('findSpectrumInvoiceCollisions returns no collisions when Spectrum has no match (or lookup fails open)', async () => {
  const rows = [
    { id: 'doc-1', invoice_number: '3', vendor_code: 'HALD01', subcontract_number: '26-434.06' },
  ];
  const { collisions } = await runCollisionCheck(rows, () => null);
  assert.deepEqual(collisions, []);
});

test('findSpectrumInvoiceCollisions omits the rename suggestion for non-bare invoice numbers', async () => {
  const rows = [
    { id: 'doc-3', invoice_number: 'INV-1042', vendor_code: 'ACME01', subcontract_number: '26-101.02' },
  ];
  const { collisions } = await runCollisionCheck(rows, () => ({ source: 'open items', amount: 100 }));
  assert.equal(collisions.length, 1);
  assert.match(collisions[0].error, /Rename this invoice number, then resubmit\.$/);
  assert.doesNotMatch(collisions[0].error, /Suggested rename/);
});
