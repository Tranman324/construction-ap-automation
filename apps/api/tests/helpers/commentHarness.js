'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

async function load(pool, work) {
  const original = Module._load;
  const touched = [];
  for (const name of ['lib/auditEvents', 'modules/invoices/services/commentService', 'modules/invoices/services/activityService', 'modules/invoices/routes/collaboration', 'modules/invoices/routes/invoices']) {
    const file = require.resolve(path.join(root, name)); touched.push([file, require.cache[file]]); delete require.cache[file];
  }
  Module._load = function (request, parent, main) {
    if (request === '../../../lib/db' || (request === './db' && parent.filename.endsWith('auditEvents.js'))) return pool;
    if (parent.filename.endsWith('/routes/collaboration.js') && request === '../services/email') return { EmailError: class EmailError extends Error {} };
    if (parent.filename.endsWith('/routes/invoices.js') && request.startsWith('../services/') && !/commentService|activityService/.test(request)) return new Proxy({}, { get: () => () => {} });
    return original.call(this, request, parent, main);
  };
  try {
    return await work({ ...require('../../modules/invoices/services/commentService'), ...require('../../modules/invoices/services/activityService'), audit: require('../../lib/auditEvents'), router: require('../../modules/invoices/routes/invoices') });
  } finally {
    Module._load = original;
    for (const [file, entry] of touched) { if (entry) require.cache[file] = entry; else delete require.cache[file]; }
  }
}

function database({
  failAudit = false, missing = false, name = 'Jane Reviewer', userId = 'user-1',
  azureId = 'azure-jane', avatarUrl = 'https://avatars.example.test/jane',
} = {}) {
  const state = { comments: [], events: [], tx: null, released: 0, queries: [] };
  const active = () => state.tx || state;
  async function query(sql, p = []) {
    state.queries.push(sql);
    if (sql === 'BEGIN') { assert.equal(state.tx, null); state.tx = { comments: structuredClone(state.comments), events: structuredClone(state.events) }; return { rows: [] }; }
    if (sql === 'COMMIT') { Object.assign(state, state.tx); state.tx = null; return { rows: [] }; }
    if (sql === 'ROLLBACK') { state.tx = null; return { rows: [] }; }
    if (sql.startsWith('SELECT id FROM documents')) return { rows: missing ? [] : [{ id: p[0] }] };
    if (sql.startsWith('SELECT name FROM toolbox_users')) return { rows: name ? [{ name }] : [] };
    if (sql.includes('FROM toolbox_users')) return { rows: name ? [{
      user_id: userId, name, platform_role: 'Accounts Payable', azure_id: azureId,
      avatar_url: avatarUrl, email: 'jane@example.test',
    }] : [] };
    if (sql.includes('INSERT INTO document_comments')) {
      assert.ok(state.tx, 'comment must enlist in transaction');
      const row = { id: p[0], document_id: p[1], body: p[2], actor_user_id: p[3], actor_name: p[4], actor_role: p[5], created_at: '2026-09-15T12:00:00Z' };
      active().comments.push(row); return { rows: [row] };
    }
    if (sql.includes('INSERT INTO audit_events')) {
      if (failAudit) throw new Error('synthetic audit unavailable');
      const row = { id: p[0], type: p[1], actor_user_id: p[3], actor_name: p[4], actor_role: p[5], target_type: p[6], target_id: p[7], changes: JSON.parse(p[9]), summary: p[13], timestamp: p[2] || '2026-09-15T12:00:00Z' };
      active().events.push(row); return { rows: [row] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  return { state, query: async (sql, p) => { assert.equal(state.tx, null, 'pool query escaped active transaction'); return query(sql, p); }, connect: async () => ({ query, release() { state.released++; } }) };
}

async function request(router, method, endpoint, { body = {}, query = {}, allowed = true } = {}) {
  const route = router.stack.find((layer) => layer.route?.path === endpoint && layer.route.methods[method]).route;
  const req = { params: { id: 'doc-1' }, body, query, user: { userId: 'user-1', email: 'jane@example.test', role: 'ap', permissions: allowed ? ['accounting.invoices.view_details'] : [] } };
  const res = { statusCode: 200, req, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  for (const layer of route.stack) {
    let next = false; await layer.handle(req, res, () => { next = true; }); if (!next) break;
  }
  return res;
}
module.exports = { load, database, request };
