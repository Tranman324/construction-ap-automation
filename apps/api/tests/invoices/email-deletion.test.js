'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { fixture, actor, token } = require('./email-fixtures');
const { createOutbox } = require('../../modules/invoices/services/email/outbox');
test('permanent deletion keeps attempt identity and caps while orphaning correlation (offline FK model)', async () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/2026-09-16_document_email_messages.sql'), 'utf8');
  // Model only the declared FK boundary; real PostgreSQL application stays an owner gate.
  assert.match(sql, /document_id TEXT REFERENCES documents\(id\) ON DELETE SET NULL/);
  const f = fixture({ daily: 99, graph: async url => { if (url.endsWith('/send')) throw Error('unknown'); } });
  await assert.rejects(f.service.sendReply('doc-1', actor, { body: 'note' }, token));
  const retained = { ...f.rows[0] };
  const target = require.resolve('../../modules/invoices/services/invoiceDeletionService');
  const original = Module._load; delete require.cache[target];
  Module._load = function(name, parent, main) {
    if (name === './supabase') return { pool: { async query(query) {
      if (query.startsWith('SELECT')) return { rows: [{ file_path: null }] };
      if (query.startsWith('DELETE FROM documents')) f.rows[0].doc = null;
      return { rows: [] };
    } } };
    if (name === '../../../lib/auditEvents') return { emitInvoiceAuditEvent: async () => {} };
    return original.call(this, name, parent, main);
  };
  try {
    const res = { locals: {}, json(value) { this.body = value; } };
    await require(target).permanentlyDeleteInvoice({ params: { id: 'doc-1' }, user: actor, log: { info() {} } }, res);
    assert.equal(res.body.permanent, true);
  } finally { Module._load = original; delete require.cache[target]; }
  assert.deepEqual(f.rows[0], { ...retained, doc: null });
  // A later document cannot reuse this unresolved token or bypass its counted daily attempt.
  await assert.rejects(f.service.sendReply('doc-2', actor, { body: 'note' }, token), e => e.statusCode === 409);
  await assert.rejects(f.service.sendReply('doc-2', actor, { body: 'note' }, '33333333-3333-4333-8333-333333333333'), e => e.statusCode === 429);
  assert.equal(typeof createOutbox, 'function');
});
