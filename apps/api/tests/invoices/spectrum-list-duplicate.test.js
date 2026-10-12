'use strict';

/**
 * List-view Spectrum duplicate signal (2026-10-06).
 * Rule (the product owner): "if it already exists in Spectrum then it's a duplicate."
 * duplicate_of only links Toolbox copies, so invoices entered/paid directly in
 * Spectrum (e.g. COAS02 #7310, ZCON92 #25-907) showed no list glyph even
 * though the detail card flagged them. The list now attaches
 * `spectrumDuplicate` from ONE batched, fail-open Spectrum lookup per page.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const spectrum = require(path.join(root, 'modules/invoices/services/spectrum.js'));

// Load invoiceCollectionService without a live database: stub lib/db (which
// supabase.js re-exports) and the unread-aggregate dependency, as
// flag-list-serialization.test.js does.
function loadCollectionService() {
  const stub = (rel, exports) => {
    const p = require.resolve(path.join(root, rel));
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  };
  stub('lib/db.js', { query: async () => ({ rows: [] }) });
  stub('modules/invoices/services/activityService.js', { getUnreadAggregates: async () => ({ unreadReplies: 0, unreadComments: 0 }) });
  for (const rel of ['modules/invoices/services/supabase.js', 'modules/invoices/services/invoiceCollectionService.js']) {
    delete require.cache[require.resolve(path.join(root, rel))];
  }
  return require(path.join(root, 'modules/invoices/services/invoiceCollectionService.js'));
}
const { attachSpectrumDuplicates } = loadCollectionService();

function row(overrides = {}) {
  return { id: 'doc-1', status: 'pending', vendor_code: 'COAS02', invoice_number: '7310', duplicate_bypassed: false, ...overrides };
}

function hitMap(entries) {
  return new Map(entries.map(([v, i, hit]) => [spectrum.spectrumInvoiceKey(v, i), hit]));
}

test('spectrumInvoiceKey mirrors findSpectrumInvoice normalization (strip - . space, trim, case-insensitive)', () => {
  assert.equal(spectrum.spectrumInvoiceKey(' ZCON92 ', '25-907'), spectrum.spectrumInvoiceKey('zcon92', '25907'));
  assert.equal(spectrum.spectrumInvoiceKey('V1', 'A. 1-2'), spectrum.spectrumInvoiceKey('V1', 'a12'));
  assert.equal(spectrum.spectrumInvoiceKey('', '7310'), null);
  assert.equal(spectrum.spectrumInvoiceKey('COAS02', ''), null);
});

test('a pending invoice that exists in Spectrum gets spectrumDuplicate, with source + amount', async () => {
  const result = await attachSpectrumDuplicates([row()], {
    lookup: async () => hitMap([['COAS02', '7310', { source: 'PAYMENT_HIST', amount: 1500, invoiceNumber: '7310', vendorCode: 'COAS02' }]]),
  });
  assert.deepEqual(result.get('doc-1'), { source: 'PAYMENT_HIST', amount: 1500 });
});

test('pending rows match regardless of the filed flag (filed is not a duplicate exemption)', async () => {
  const result = await attachSpectrumDuplicates([row({ filed: true })], {
    lookup: async () => hitMap([['COAS02', '7310', { source: 'OPEN_ITEMS', amount: 1 }]]),
  });
  assert.ok(result.has('doc-1'));
});

test('only reviewable, non-bypassed rows with both keys are looked up', async () => {
  let asked = null;
  await attachSpectrumDuplicates([
    row({ id: 'pending' }),
    row({ id: 'modified', status: 'modified', invoice_number: '7' }),
    row({ id: 'submitted', status: 'submitted' }),
    row({ id: 'discarded', status: 'discarded' }),
    row({ id: 'bypassed', duplicate_bypassed: true }),
    row({ id: 'no-vendor', vendor_code: null }),
    row({ id: 'no-number', invoice_number: '' }),
  ], { lookup: async (pairs) => { asked = pairs; return new Map(); } });
  assert.deepEqual(asked, [
    { vendorCode: 'COAS02', invoiceNumber: '7310' },
    { vendorCode: 'COAS02', invoiceNumber: '7' },
  ]);
});

test('no candidates means no Spectrum round-trip at all', async () => {
  let called = false;
  const result = await attachSpectrumDuplicates([row({ status: 'submitted' })], { lookup: async () => { called = true; return new Map(); } });
  assert.equal(called, false);
  assert.equal(result.size, 0);
});

test('fails open: a throwing or malformed lookup yields no glyphs, never an error', async () => {
  assert.equal((await attachSpectrumDuplicates([row()], { lookup: async () => { throw new Error('spectrum down'); } })).size, 0);
  assert.equal((await attachSpectrumDuplicates([row()], { lookup: async () => null })).size, 0);
});

function fakePool(recordset, sink) {
  return async () => ({
    request() {
      const inputs = {};
      return {
        input(name, _type, value) { inputs[name] = value; return this; },
        async query(sql) { sink.sql = sql; sink.inputs = inputs; return { recordset }; },
      };
    },
  });
}

test('batch lookup: one parameterized query across all 3 AP tables, scoped by vendor AND invoice#', async () => {
  const sink = {};
  await spectrum.findSpectrumInvoicesBatch(
    [{ vendorCode: 'COAS02', invoiceNumber: '7310' }, { vendorCode: 'ZCON92', invoiceNumber: '25-907' }, { vendorCode: 'COAS02', invoiceNumber: '7310' }],
    { getPool: fakePool([], sink) },
  );
  for (const table of ['VN_OPEN_ITEMS_MC', 'VN_INVOICE_APPROVAL_HDR_MC', 'VN_PAYMENT_HISTORY_MC']) assert.match(sink.sql, new RegExp(table));
  assert.equal((sink.sql.match(/Company_Code = 'NCG'/g) || []).length, 3);
  assert.doesNotMatch(sink.sql, /7310|25907|COAS02/, 'values must be bound parameters, never interpolated');
  assert.deepEqual(Object.values(sink.inputs).sort(), ['25907', '7310', 'ZCON92', 'COAS02'].sort(), 'deduped vendor + normalized invoice params');
});

test('batch lookup keeps findSpectrumInvoice source precedence: OPEN_ITEMS > APPROVAL > PAYMENT_HIST', async () => {
  const hits = await spectrum.findSpectrumInvoicesBatch([{ vendorCode: 'COAS02', invoiceNumber: '7310' }], {
    getPool: fakePool([
      { source: 'PAYMENT_HIST', invoice_number: '7310', vendor_code: 'COAS02', invoice_amount: 1500, norm: '7310' },
      { source: 'OPEN_ITEMS', invoice_number: '7310', vendor_code: 'COAS02', invoice_amount: 1400, norm: '7310' },
      { source: 'APPROVAL', invoice_number: '7310', vendor_code: 'COAS02', invoice_amount: 1300, norm: '7310' },
      { source: 'OPEN_ITEMS', invoice_number: '9999', vendor_code: 'COAS02', invoice_amount: 1, norm: '9999' },
    ], {}),
  });
  assert.equal(hits.size, 1, 'rows for pairs we did not ask about are ignored');
  assert.deepEqual(hits.get(spectrum.spectrumInvoiceKey('COAS02', '7310')), { invoiceNumber: '7310', vendorCode: 'COAS02', amount: 1400, source: 'OPEN_ITEMS' });
});

test('batch lookup fails open on pool error and on timeout', async () => {
  const pairs = [{ vendorCode: 'COAS02', invoiceNumber: '7310' }];
  assert.equal((await spectrum.findSpectrumInvoicesBatch(pairs, { getPool: async () => { throw new Error('not configured'); } })).size, 0);
  const hang = async () => ({ request() { return { input() { return this; }, query: () => new Promise(() => {}) }; } });
  const t0 = Date.now();
  assert.equal((await spectrum.findSpectrumInvoicesBatch(pairs, { getPool: hang, timeoutMs: 50 })).size, 0);
  assert.ok(Date.now() - t0 < 1000, 'time-boxed');
});

test('list wiring: listInvoices attaches spectrumDuplicate to every serialized row', () => {
  const src = fs.readFileSync(path.join(root, 'modules/invoices/services/invoiceCollectionService.js'), 'utf8');
  const listBody = src.slice(src.indexOf('async function listInvoices'), src.indexOf('async function', src.indexOf('async function listInvoices') + 10));
  assert.match(listBody, /await attachSpectrumDuplicates\(dataResult\.rows\)/);
  assert.match(listBody, /doc\.spectrumDuplicate = spectrumDuplicates\.get\(row\.id\) \|\| null/);
});
