'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { withTransaction } = require('../../modules/invoices/services/transaction');

test('uses a fake pool directly when it has no connect method', async () => {
  const pool = { query: async () => assert.fail('fake pool must not begin a transaction') };
  const result = await withTransaction(pool, async (db) => {
    assert.equal(db, pool);
    return 'direct';
  });

  assert.equal(result, 'direct');
});

test('begins, commits, and releases a connected client', async () => {
  const calls = [];
  const client = {
    async query(sql) { calls.push(sql); },
    release() { calls.push('RELEASE'); },
  };
  const pool = { async connect() { calls.push('CONNECT'); return client; } };

  const result = await withTransaction(pool, async (db) => {
    assert.equal(db, client);
    calls.push('WORK');
    return 'committed';
  });

  assert.equal(result, 'committed');
  assert.deepEqual(calls, ['CONNECT', 'BEGIN', 'WORK', 'COMMIT', 'RELEASE']);
});

test('rolls back, releases, and rethrows a callback failure', async () => {
  const calls = [];
  const failure = new Error('callback failed');
  const client = {
    async query(sql) { calls.push(sql); },
    release() { calls.push('RELEASE'); },
  };
  const pool = { async connect() { calls.push('CONNECT'); return client; } };

  await assert.rejects(
    withTransaction(pool, async () => {
      calls.push('WORK');
      throw failure;
    }),
    failure
  );
  assert.deepEqual(calls, ['CONNECT', 'BEGIN', 'WORK', 'ROLLBACK', 'RELEASE']);
});

test('rolls back, releases, and rethrows a commit failure', async () => {
  const calls = [];
  const failure = new Error('commit failed');
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql === 'COMMIT') throw failure;
    },
    release() { calls.push('RELEASE'); },
  };
  const pool = { async connect() { calls.push('CONNECT'); return client; } };

  await assert.rejects(withTransaction(pool, async () => {
    calls.push('WORK');
  }), failure);
  assert.deepEqual(calls, ['CONNECT', 'BEGIN', 'WORK', 'COMMIT', 'ROLLBACK', 'RELEASE']);
});
