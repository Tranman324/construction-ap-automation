'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { withScriptClient, createScriptClient, buildClientConfig } = require('../lib/scriptDb');

// Fake pg.Client that records lifecycle calls; injected via ClientImpl.
function makeFakeClientImpl(log) {
  return class FakeClient {
    constructor(config) { this.config = config; log.push({ event: 'construct', config }); }
    async connect() { log.push({ event: 'connect' }); }
    async query(...args) { log.push({ event: 'query', args }); return { rows: [] }; }
    async end() { log.push({ event: 'end' }); }
    on() {}
  };
}

test('withScriptClient connects, runs the callback, and ends in finally on success', async () => {
  const log = [];
  const ClientImpl = makeFakeClientImpl(log);
  const result = await withScriptClient(async (client) => {
    await client.query('SELECT 1');
    return 'ok';
  }, { config: {}, ClientImpl });

  assert.equal(result, 'ok');
  assert.deepEqual(log.map((e) => e.event), ['construct', 'connect', 'query', 'end']);
});

test('withScriptClient ends the client in finally even when the callback throws', async () => {
  const log = [];
  const ClientImpl = makeFakeClientImpl(log);
  const boom = new Error('callback exploded');

  await assert.rejects(
    () => withScriptClient(async () => { throw boom; }, { config: {}, ClientImpl }),
    /callback exploded/,
  );

  // Teardown ran despite the throw — the client was connected then ended.
  assert.deepEqual(log.map((e) => e.event), ['construct', 'connect', 'end']);
  assert.equal(log.filter((e) => e.event === 'end').length, 1);
});

test('createScriptClient never constructs a Pool and lazily connects one client', async () => {
  const log = [];
  const ClientImpl = makeFakeClientImpl(log);
  const db = createScriptClient({ config: {}, ClientImpl });

  // No connection until the first query.
  assert.equal(log.filter((e) => e.event === 'connect').length, 0);

  await db.query('SELECT 1');
  await db.query('SELECT 2');
  // Connected exactly once, then reused.
  assert.equal(log.filter((e) => e.event === 'connect').length, 1);
  assert.equal(log.filter((e) => e.event === 'query').length, 2);

  const client = await db.connect();
  await client.query('BEGIN');
  client.release(); // no-op, must not throw
  await db.end();
  assert.equal(log.filter((e) => e.event === 'end').length, 1);
});

test('buildClientConfig uses the Supabase connection string with managed TLS when set', () => {
  const prev = process.env.SUPABASE_DB_URL;
  process.env.SUPABASE_DB_URL = 'postgresql://user:pass@db.example.supabase.co:5432/postgres';
  try {
    const config = buildClientConfig();
    assert.equal(config.connectionString, process.env.SUPABASE_DB_URL);
    assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  } finally {
    if (prev === undefined) delete process.env.SUPABASE_DB_URL;
    else process.env.SUPABASE_DB_URL = prev;
  }
});
