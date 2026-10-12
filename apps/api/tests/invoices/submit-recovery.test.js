'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function loadSubmitRecoveryWithPool(pool) {
  const modulePath = require.resolve('../../modules/invoices/services/submitRecovery');
  const supabasePath = require.resolve('../../modules/invoices/services/supabase');
  const previousSupabase = require.cache[supabasePath];

  delete require.cache[modulePath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: { pool },
  };

  const mod = require(modulePath);

  return {
    mod,
    cleanup() {
      delete require.cache[modulePath];
      if (previousSupabase) {
        require.cache[supabasePath] = previousSupabase;
      } else {
        delete require.cache[supabasePath];
      }
    },
  };
}

test('getStaleSubmitMinutes uses positive finite values and falls back otherwise', () => {
  const { mod, cleanup } = loadSubmitRecoveryWithPool({ query() {} });

  try {
    assert.equal(mod.getStaleSubmitMinutes(15), 15);
    assert.equal(mod.getStaleSubmitMinutes('20'), 20);
    assert.equal(mod.getStaleSubmitMinutes(0), 10);
    assert.equal(mod.getStaleSubmitMinutes(-1), 10);
    assert.equal(mod.getStaleSubmitMinutes('nope'), 10);
  } finally {
    cleanup();
  }
});

test('recoverStaleSubmittingInvoices reverts stale submitting rows with submit_error marker', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 3, rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    },
  };
  const logs = [];
  const { mod, cleanup } = loadSubmitRecoveryWithPool(pool);

  try {
    const result = await mod.recoverStaleSubmittingInvoices({
      staleMinutes: 30,
      log: { info: (payload, message) => logs.push({ payload, message }) },
    });

    assert.equal(result.recoveredCount, 3);
    assert.equal(result.staleMinutes, 30);
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /SET status = 'approved'/);
    assert.match(calls[0].sql, /submit_error = \$1/);
    assert.match(calls[0].sql, /WHERE status = 'submitting'/);
    assert.deepEqual(calls[0].params, [
      mod.STALE_SUBMIT_MESSAGE,
      30,
    ]);
    assert.equal(logs[0].payload.operation, 'invoice.submit.recover_stale');
    assert.equal(logs[0].payload.context.recoveredCount, 3);
  } finally {
    cleanup();
  }
});
