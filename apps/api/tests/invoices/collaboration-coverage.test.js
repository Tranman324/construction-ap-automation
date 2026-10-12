'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { load } = require('../helpers/commentHarness');

async function reclassify(failAudit = false) {
  const state = { row: { id: 'doc-1', classification: 'invoice', file_name: null }, events: [], legacy: [], tx: null, commits: 0, spawned: 0 };
  const current = () => state.tx || state;
  async function query(sql, p = []) {
    if (sql === 'BEGIN') { state.tx = { row: { ...state.row }, events: [] }; return { rows: [] }; }
    if (sql === 'COMMIT') { Object.assign(state, state.tx); state.tx = null; state.commits++; return { rows: [] }; }
    if (sql === 'ROLLBACK') { state.tx = null; return { rows: [] }; }
    if (sql.includes('SELECT classification, file_name') || sql.startsWith('SELECT * FROM documents')) return { rows: [current().row] };
    if (sql.startsWith('UPDATE documents SET classification')) { current().row.classification = p[0]; return { rows: [] }; }
    if (sql.startsWith('SELECT name FROM toolbox_users')) return { rows: [{ name: 'Jane Reviewer' }] };
    if (sql.includes('INSERT INTO audit_events')) {
      assert.ok(state.tx, 'reclassification audit must precede commit');
      if (failAudit) throw new Error('audit fixture failure');
      const row = { id: p[0], type: p[1], actor_user_id: p[3], actor_name: p[4], actor_role: p[5], changes: JSON.parse(p[9]) };
      current().events.push(row); return { rows: [row] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
  const pool = { query, connect: async () => ({ query, release() {} }) };
  await load(pool, async () => {
    const original = Module._load;
    Module._load = function (request, parent, main) {
      if (request === './supabase') return { pool, audit: async (...args) => state.legacy.push(args), rowToDoc: row => row };
      if (request === '../routes/settings') return { getActiveClassificationNames: async () => new Set(['invoice', 'coi']) };
      if (request === 'child_process') return { spawn() { state.spawned++; return { unref() {} }; } };
      return original.call(this, request, parent, main);
    };
    const file = require.resolve('../../modules/invoices/services/invoiceStatusService');
    delete require.cache[file];
    try {
      const { reclassifyInvoice } = require(file);
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await reclassifyInvoice({ params: { id: 'doc-1' }, body: { classification: 'coi' }, user: { userId: 'user-1', email: 'jane@example.test', role: 'ap' } }, res);
      state.response = res;
    } finally { Module._load = original; delete require.cache[file]; }
  });
  return state;
}

test('reclassify real transaction adds structured event and preserves legacy audit then starts deferred extraction', async () => {
  const state = await reclassify();
  assert.equal(state.response.statusCode, 200); assert.equal(state.row.classification, 'coi');
  assert.equal(state.events.length, 1); assert.equal(state.events[0].type, 'invoice.reclassified');
  assert.deepEqual(state.events[0].changes, { classification: ['invoice', 'coi'] });
  assert.equal(state.events[0].actor_name, 'Jane Reviewer'); assert.equal(state.events[0].actor_user_id, 'user-1');
  assert.deepEqual(state.legacy, [['doc-1', 'reclassified', { classification: ['invoice', 'coi'] }]]);
  assert.equal(state.commits, 1); assert.equal(state.spawned, 1);
});

test('structured reclassify failure rolls back classification and prevents legacy/deferred completion', async () => {
  const state = await reclassify(true);
  assert.equal(state.response.statusCode, 500); assert.equal(state.row.classification, 'invoice');
  assert.deepEqual(state.events, []); assert.deepEqual(state.legacy, []);
  assert.equal(state.commits, 0); assert.equal(state.spawned, 0);
});
