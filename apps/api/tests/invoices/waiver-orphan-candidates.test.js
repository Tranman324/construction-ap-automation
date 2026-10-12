'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

async function withService(pool, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === './supabase') return { pool };
    return originalLoad.call(this, request, parent, isMain);
  };
  const resolved = require.resolve(path.join(root, 'modules/invoices/services/lienWaiverQueryService.js'));
  delete require.cache[resolved];
  try {
    return await fn(require(resolved));
  } finally {
    delete require.cache[resolved];
    Module._load = originalLoad;
  }
}

function makePool(target, candidateOverrides = {}, paired = null) {
  const calls = [];
  const candidate = {
    id: 'candidate-1', file_name: 'Waiver 100.pdf', vendor_name: 'Acme', vendor_code: 'ACME',
    amount: '100.00', invoice_number: 'INV-100', job_match_number: 'J-100', status: 'pending',
    email_received_at: new Date('2026-08-03T12:00:00Z'), queued_at: null,
    ...candidateOverrides,
  };
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM documents\s+WHERE id = \$1/.test(sql)) {
        if (params[0] === target.id) return { rows: [target] };
        if (paired && params[0] === paired.id) return { rows: [paired] };
        return { rows: [] };
      }
      if (/SELECT COUNT\(\*\)/.test(sql)) return { rows: [{ count: '1' }] };
      return { rows: [candidate] };
    },
  };
}

test('invoice orphan-waiver candidates filter before pagination, include filed waivers, and derive vendor priority server-side', async () => {
  const pool = makePool({ id: 'invoice-1', classification: 'invoice', vendor_code: 'ACME', vendor_name: 'Acme', file_name: 'Invoice.pdf', status: 'pending' });
  await withService(pool, async ({ getOrphanWaiversForInvoice }) => {
    const result = await getOrphanWaiversForInvoice({ id: 'invoice-1', query: { page: 2, q: '100' } });
    assert.equal(result.page, 2);
    assert.equal(result.limit, 10);
    assert.equal(result.waivers[0].id, 'candidate-1');
  });
  const count = pool.calls.find(({ sql }) => /SELECT COUNT\(\*\)/.test(sql));
  const data = pool.calls.find(({ sql }) => /LIMIT \$4 OFFSET \$5/.test(sql));
  assert.match(count.sql, /classification = 'lien-waiver'/);
  assert.match(count.sql, /status NOT IN \('submitted', 'submitting', 'split-processing', 'discarded'\)/);
  assert.match(count.sql, /matched_vendor_name ILIKE \$1/);
  assert.match(count.sql, /CAST\(amount AS TEXT\) ILIKE \$1/);
  assert.doesNotMatch(count.sql, /LIMIT|OFFSET/);
  assert.match(data.sql, /CASE WHEN \(vendor_code = \$1 OR LOWER\(COALESCE\(vendor_name, matched_vendor_name\)\) = LOWER\(\$2\)\) THEN 0 ELSE 1 END/);
  assert.deepEqual(data.params, ['ACME', 'Acme', '%100%', 10, 10]);
});

test('matched-vendor-only candidates participate in q search and same-vendor priority', async () => {
  const pool = makePool(
    { id: 'invoice-1', classification: 'invoice', vendor_code: null, vendor_name: 'Acme', file_name: 'Invoice.pdf', status: 'pending' },
    { vendor_name: null, matched_vendor_name: 'Acme' },
  );
  await withService(pool, async ({ getOrphanWaiversForInvoice }) => {
    const result = await getOrphanWaiversForInvoice({ id: 'invoice-1', query: { page: 1, q: 'acme' } });
    assert.equal(result.waivers[0].vendorName, 'Acme');
  });
  const count = pool.calls.find(({ sql }) => /SELECT COUNT\(\*\)/.test(sql));
  const data = pool.calls.find(({ sql }) => /ORDER BY CASE/.test(sql));
  assert.match(count.sql, /matched_vendor_name ILIKE \$1/);
  assert.match(data.sql, /COALESCE\(vendor_name, matched_vendor_name\)/);
  assert.deepEqual(data.params, [null, 'Acme', '%acme%', 10, 0]);
});

test('waiver orphan-invoice candidates exclude protected and deleted rows before pagination', async () => {
  const pool = makePool({ id: 'waiver-1', classification: 'lien-waiver', vendor_code: 'ACME', vendor_name: 'Acme', file_name: 'Waiver.pdf', status: 'pending' });
  await withService(pool, async ({ getOrphanInvoicesForWaiver }) => {
    const result = await getOrphanInvoicesForWaiver({ id: 'waiver-1', query: { page: 1 } });
    assert.equal(result.invoices.length, 1);
  });
  const count = pool.calls.find(({ sql }) => /SELECT COUNT\(\*\)/.test(sql));
  assert.match(count.sql, /classification IN \('invoice', 'pay-application'\)/);
  assert.match(count.sql, /deleted_at IS NULL/);
  assert.match(count.sql, /status NOT IN \('submitted', 'submitting', 'split-processing', 'discarded'\)/);
});

test('orphan lists reject a target of the wrong classification without querying candidates', async () => {
  const pool = makePool({ id: 'statement-1', classification: 'statement', vendor_code: 'ACME', vendor_name: 'Acme' });
  await withService(pool, async ({ getOrphanWaiversForInvoice }) => {
    const result = await getOrphanWaiversForInvoice({ id: 'statement-1', query: { page: 1 } });
    assert.equal(result.invalidTarget, true);
  });
  assert.equal(pool.calls.length, 1);
});

test('invoice orphan-waiver endpoint returns the exact paired waiver summary or null', async () => {
  const linkedWaiver = {
    id: 'waiver-linked', file_name: 'Signed waiver.pdf', vendor_name: 'Acme', vendor_code: 'ACME',
    amount: '100.00', invoice_number: null, job_match_number: 'J-100', status: 'filed',
    email_received_at: new Date('2026-08-01T12:00:00Z'), queued_at: null,
  };
  const invoicePool = makePool(
    {
      id: 'invoice-1', classification: 'invoice', vendor_code: 'ACME', vendor_name: 'Acme',
      file_name: 'Invoice.pdf', status: 'pending', linked_lien_waiver_id: linkedWaiver.id,
    },
    {},
    linkedWaiver,
  );
  await withService(invoicePool, async ({ getOrphanWaiversForInvoice }) => {
    const result = await getOrphanWaiversForInvoice({ id: 'invoice-1', query: { page: 1 } });
    assert.deepEqual(result.paired, {
      id: 'waiver-linked', fileName: 'Signed waiver.pdf', vendorName: 'Acme', vendorCode: 'ACME',
      amount: 100, invoiceNumber: null, jobNumber: 'J-100', status: 'filed',
    });
  });

  const unpairedInvoicePool = makePool(
    {
      id: 'invoice-unpaired', classification: 'invoice', vendor_code: 'ACME', vendor_name: 'Acme',
      file_name: 'Invoice.pdf', status: 'pending', linked_lien_waiver_id: null,
    },
  );
  await withService(unpairedInvoicePool, async ({ getOrphanWaiversForInvoice }) => {
    const result = await getOrphanWaiversForInvoice({ id: 'invoice-unpaired', query: { page: 1 } });
    assert.equal(result.paired, null);
  });
});

test('lien-waiver orphan-invoice endpoint returns the exact paired invoice summary', async () => {
  const linkedInvoice = {
    id: 'invoice-linked', file_name: 'Invoice 100.pdf', vendor_name: 'Acme', vendor_code: 'ACME',
    amount: '100.00', invoice_number: 'INV-100', job_match_number: 'J-100', status: 'approved',
  };
  const pool = makePool(
    {
      id: 'waiver-1', classification: 'lien-waiver', vendor_code: 'ACME', vendor_name: 'Acme',
      file_name: 'Waiver.pdf', status: 'pending', linked_lien_waiver_id: linkedInvoice.id,
    },
    {},
    linkedInvoice,
  );
  await withService(pool, async ({ getOrphanInvoicesForWaiver }) => {
    const result = await getOrphanInvoicesForWaiver({ id: 'waiver-1', query: { page: 1 } });
    assert.deepEqual(result.paired, {
      id: 'invoice-linked', fileName: 'Invoice 100.pdf', vendorName: 'Acme', vendorCode: 'ACME',
      amount: 100, invoiceNumber: 'INV-100', jobNumber: 'J-100', status: 'approved',
    });
  });
});

test('orphan endpoint returns null when a linked counterpart is missing or soft-deleted', async () => {
  const pool = makePool({
    id: 'invoice-dangling', classification: 'invoice', vendor_code: 'ACME', vendor_name: 'Acme',
    file_name: 'Invoice.pdf', status: 'pending', linked_lien_waiver_id: 'waiver-missing',
  });
  await withService(pool, async ({ getOrphanWaiversForInvoice }) => {
    const result = await getOrphanWaiversForInvoice({ id: 'invoice-dangling', query: { page: 1 } });
    assert.equal(result.paired, null);
  });
  const pairedLookup = pool.calls.find(({ sql, params }) => (
    /WHERE id = \$1 AND deleted_at IS NULL/.test(sql) && params[0] === 'waiver-missing'
  ));
  assert.ok(pairedLookup, 'loads a dangling counterpart through the soft-delete-safe lookup');
  assert.match(pairedLookup.sql, /deleted_at IS NULL/);
});
