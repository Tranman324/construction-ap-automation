'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  claimInvoicesForSubmit,
  finalizeSubmittedInvoice,
  normalizeSubmitError,
  revertClaimedInvoices,
} = require('../../modules/invoices/services/submitState');

function createDoc(overrides = {}) {
  return {
    id: 'invoice-1',
    status: 'approved',
    classification: 'invoice',
    submit_error: 'old error',
    updated_at: null,
    ...overrides,
  };
}

function createMockPool(initialRows) {
  const rows = new Map(initialRows.map((row) => [row.id, { ...row }]));
  const calls = [];

  return {
    rows,
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (/SET status = 'submitting'/.test(sql)) {
        const now = params[params.length - 1];
        const candidateIds = /id IN/.test(sql)
          ? params.slice(0, -1)
          : Array.from(rows.keys());
        const claimed = [];

        for (const id of candidateIds) {
          const row = rows.get(id);
          if (
            row
            && row.status === 'approved'
            && row.classification === 'invoice'
            && (/submit_error IS NULL/.test(sql) ? row.submit_error === null : true)
          ) {
            row.status = 'submitting';
            row.submit_error = null;
            row.updated_at = now;
            claimed.push({ ...row });
          }
        }

        return { rows: claimed, rowCount: claimed.length };
      }

      if (/SET status = 'approved', submit_error = \$1/.test(sql)) {
        const [submitError, updatedAt, ...ids] = params;
        let rowCount = 0;

        for (const id of ids) {
          const row = rows.get(id);
          if (row && row.status === 'submitting') {
            row.status = 'approved';
            row.submit_error = submitError;
            row.updated_at = updatedAt;
            rowCount += 1;
          }
        }

        return { rows: [], rowCount };
      }

      if (/WHERE id = \$3 AND status = \$4/.test(sql)) {
        const [nextStatus, updatedAt, id, requiredStatus] = params;
        const row = rows.get(id);

        if (row && row.status === requiredStatus) {
          row.status = nextStatus;
          row.submit_error = null;
          row.updated_at = updatedAt;
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected SQL in test mock: ${sql}`);
    },
  };
}

test('only one concurrent approved invoice claim wins', async () => {
  const pool = createMockPool([
    createDoc({ id: 'invoice-1', submit_error: null }),
  ]);
  const now = '2026-06-22T12:00:00.000Z';

  const results = await Promise.all([
    claimInvoicesForSubmit(pool, ['invoice-1'], now),
    claimInvoicesForSubmit(pool, ['invoice-1'], now),
  ]);

  assert.deepEqual(results.map((rows) => rows.length).sort(), [0, 1]);
  assert.equal(pool.rows.get('invoice-1').status, 'submitting');
  assert.equal(pool.rows.get('invoice-1').submit_error, null);
});

test('claimInvoicesForSubmit claims approved invoice rows and preserves requested order', async () => {
  const pool = createMockPool([
    createDoc({ id: 'invoice-2', submit_error: 'old' }),
    createDoc({ id: 'invoice-1', submit_error: null }),
    createDoc({ id: 'pending', status: 'pending', submit_error: null }),
    createDoc({ id: 'receipt', classification: 'receipt', submit_error: null }),
  ]);

  const claimed = await claimInvoicesForSubmit(pool, ['invoice-1', 'pending', 'invoice-2'], 'now');

  assert.deepEqual(claimed.map((row) => row.id), ['invoice-1', 'invoice-2']);
  assert.equal(pool.rows.get('invoice-1').status, 'submitting');
  assert.equal(pool.rows.get('invoice-2').status, 'submitting');
  assert.equal(pool.rows.get('pending').status, 'pending');
  assert.equal(pool.rows.get('receipt').status, 'approved');
});

test('claimInvoicesForSubmit without ids claims only approved invoices without submit errors', async () => {
  const pool = createMockPool([
    createDoc({ id: 'clean', submit_error: null }),
    createDoc({ id: 'blocked', submit_error: 'previous failure' }),
    createDoc({ id: 'pending', status: 'pending', submit_error: null }),
  ]);

  const claimed = await claimInvoicesForSubmit(pool, undefined, 'now');

  assert.deepEqual(claimed.map((row) => row.id), ['clean']);
  assert.equal(pool.rows.get('clean').status, 'submitting');
  assert.equal(pool.rows.get('blocked').status, 'approved');
});

test('revertClaimedInvoices recovers submitting rows to approved with normalized submit_error', async () => {
  const pool = createMockPool([
    createDoc({ id: 'a', status: 'submitting', submit_error: null }),
    createDoc({ id: 'b', status: 'submitting', submit_error: null }),
    createDoc({ id: 'c', status: 'approved', submit_error: null }),
  ]);
  const log = { error() {} };

  const rowCount = await revertClaimedInvoices(
    pool,
    ['a', 'a', 'b', null, 'c'],
    '  Spectrum\n rejected   invoice  ',
    log
  );

  assert.equal(rowCount, 2);
  assert.equal(pool.rows.get('a').status, 'approved');
  assert.equal(pool.rows.get('a').submit_error, 'Spectrum rejected invoice');
  assert.equal(pool.rows.get('b').status, 'approved');
  assert.equal(pool.rows.get('c').submit_error, null);
});

test('finalizeSubmittedInvoice moves only submitting rows to submitted', async () => {
  const pool = createMockPool([
    createDoc({ id: 'submitting', status: 'submitting' }),
    createDoc({ id: 'approved', status: 'approved' }),
  ]);

  await assert.doesNotReject(() => finalizeSubmittedInvoice(pool, 'submitting', 'now'));
  assert.equal(pool.rows.get('submitting').status, 'submitted');
  assert.equal(pool.rows.get('submitting').submit_error, null);

  await assert.rejects(
    () => finalizeSubmittedInvoice(pool, 'approved', 'now'),
    /Claimed invoice was no longer submitting/
  );
  assert.equal(pool.rows.get('approved').status, 'approved');
});

test('normalizeSubmitError collapses whitespace and caps length', () => {
  const normalized = normalizeSubmitError(` bad\n${'x'.repeat(600)}`, 'fallback');

  assert.equal(normalized.includes('\n'), false);
  assert.equal(normalized.length, 500);
});
