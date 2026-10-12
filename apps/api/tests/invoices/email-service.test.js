'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, actor, token, recipient } = require('./email-fixtures');
const { LIMIT } = require('../../modules/invoices/services/email/content');
const { createReconciliationService, classifyEvidence } = require('../../modules/invoices/services/email/reconciliation');
const body = { body: 'Please clarify' };
const send = f => f.service.sendReply('doc-1', actor, body, token);
const patch = f => JSON.parse(f.calls.find(c => c.method === 'PATCH').body);
test('R1/R2/R7/R10/R11: real service prepends, sender only, AP replies, reserved before Graph, actor audit after confirmation', async () => {
  const f = fixture();
  assert.deepEqual(await send(f), { ok: true, sentTo: 'vendor@example.com' });
  assert.deepEqual(f.events.slice(0, 6), ['reserved', 'draft', 'draft-recorded', 'send-started', 'send', 'confirmed']);
  const p = patch(f); assert.match(p.body.content, /Please clarify.*Actual Actor.*<blockquote>original/s);
  assert.deepEqual(p.toRecipients, [{ emailAddress: { address: 'vendor@example.com' } }]);
  assert.deepEqual(p.replyTo, [{ emailAddress: { address: 'invoices@northwindcg.example' } }]);
  assert.deepEqual(p.ccRecipients, []); assert.deepEqual(p.bccRecipients, []);
  assert.equal(f.events.at(-1).actor.userId, actor.userId); assert.equal(f.rows[0].graph, 'immutable');
  assert.ok(f.calls.every(c => c.headers.Prefer === 'IdType="ImmutableId"' && c.signal));
});
for (const [label, opts, status] of [['no thread', { doc: { email_message_id: null } }, 409],
  ['malformed sender', { doc: { email_from: 'x@example.com,bad@x.example' } }, 422],
  ['missing file', { fileMissing: true }, 422], ['kill switch', { disabled: true }, 503], ['daily cap', { daily: 100 }, 429]]) {
  test(`R19 ${label}: fail before draft`, async () => {
    const f = fixture(opts); await assert.rejects(send(f), e => e.statusCode === status);
    assert.equal(f.calls.length, 0); assert.equal(f.rows.length, 0);
  });
}
test('R3 exact size attaches, larger reply omits with no Toolbox link; forward omits document route', async () => {
  const edge = fixture({ size: LIMIT }); await send(edge);
  assert.ok(edge.calls.some(c => c.url.endsWith('/attachments')));
  const over = fixture({ size: LIMIT + 1 }); await send(over);
  assert.ok(!over.calls.some(c => c.url.endsWith('/attachments')));
  assert.match(patch(over).body.content, /attachment omitted/); assert.doesNotMatch(patch(over).body.content, /toolbox.example/);
  const fw = fixture({ size: LIMIT + 1 }); await fw.service.sendForward('doc-1', actor, { body: '', recipients: [recipient] }, token);
  assert.doesNotMatch(patch(fw).body.content, /toolbox.example/);
  assert.equal(patch(fw).subject, 'FW: INV-1 — Vendor [Ref:doc-1]');
});
test('R19 context and note escaped; full bodies absent from persisted SQL, audit and logs', async () => {
  const f = fixture({ doc: { vendor_name: '<img src=x onerror=alert(1)>' } });
  const note = '<script>alert(1)</script>' + 'z'.repeat(300);
  await f.service.sendForward('doc-1', actor, { recipients: [recipient], body: note }, token);
  assert.doesNotMatch(patch(f).body.content, /<script>|<img/);
  assert.match(patch(f).body.content, /&lt;script&gt;/);
  assert.ok(!JSON.stringify(f.sqls).includes(note)); assert.ok(!JSON.stringify(f.logs).includes(note));
  assert.equal(f.events.at(-1).changes.bodyPreview.length, 200);
});
test('R9 rejects unknown, external, empty recipients and PM collisions/no job stay empty', async () => {
  for (const recipients of [[], ['unknown'], ['outside@example.com']]) {
    const f = fixture(); await assert.rejects(f.service.sendForward('doc-1', actor, { body: '', recipients }, token), e => e.statusCode === 400);
    assert.equal(f.rows.length, 0);
  }
  const users = [{ id: recipient, displayName: 'PM One', mail: 'pm@northwindcg.example' }, { id: 'other', displayName: 'PM One', mail: 'pm2@northwindcg.example' }];
  assert.deepEqual(await fixture({ users }).service.getForwardDefaults('doc-1'), { defaultRecipients: [] });
  const nojob = fixture({ doc: { job_match_number: null } });
  assert.deepEqual(await nojob.service.getForwardDefaults('doc-1'), { defaultRecipients: [] }); assert.equal(nojob.calls.length, 0);
  assert.equal((await fixture().service.getForwardDefaults('doc-1')).defaultRecipients[0].userId, recipient);
});
test('definite send rejection deletes draft, records failed, emits no audit; no fresh fallback', async () => {
  const f = fixture({ graph: async (url) => { if (url.endsWith('/send')) throw Error('Graph 400 Bad Request: sensitive body'); } });
  await assert.rejects(send(f), e => e.code === 'EMAIL_SEND_FAILED');
  assert.equal(f.rows[0].status, 'failed'); assert.ok(f.calls.some(c => c.method === 'DELETE'));
  assert.ok(f.events.every(e => typeof e === 'string')); assert.doesNotMatch(JSON.stringify(f.logs), /sensitive body/);
  assert.equal(f.calls.filter(c => c.url.endsWith('/send')).length, 1);
});
test('accepted send retries its exact confirmation read until Graph returns a sent copy', async () => {
  let confirmations = 0;
  const f = fixture({ graph: async (url) => {
    if (!url.includes('$select=id,isDraft')) return undefined;
    confirmations += 1;
    return confirmations === 1
      ? { id: 'immutable', isDraft: true, internetMessageId: null, sentDateTime: null }
      : { id: 'immutable', isDraft: false, internetMessageId: '<sent@example.com>', sentDateTime: '2026-09-15T12:00:00Z' };
  } });
  assert.deepEqual(await send(f), { ok: true, sentTo: 'vendor@example.com' });
  assert.equal(confirmations, 2);
  assert.equal(f.rows[0].status, 'confirmed');
});
for (const [name, graph] of [
  ['network unknown', async url => { if (url.endsWith('/send')) throw Error('network'); }],
]) test(`${name}: remains ambiguous, no cleanup/resend/audit and expiry cannot reopen`, async () => {
  const f = fixture({ graph }); await assert.rejects(send(f), e => e.code === 'EMAIL_SEND_AMBIGUOUS' && Boolean(e.details.attemptId));
  assert.equal(f.rows[0].status, 'ambiguous'); assert.ok(!f.calls.some(c => c.method === 'DELETE'));
  f.advance(120000); await assert.rejects(send(f), e => e.statusCode === 409);
  assert.equal(f.calls.filter(c => c.url.endsWith('/send')).length, 1);
});
for (const [name, graph] of [
  ['accepted but sent copy not visible', async url => { if (url.includes('$select=id,isDraft')) throw Error('Graph 404 Not Found'); }],
  ['wrong identity', async url => { if (url.includes('$select=id,isDraft')) return { id: 'other', isDraft: false }; }],
]) test(`${name}: accepted send returns pending, stays ambiguous with no cleanup/resend/audit`, async () => {
  const f = fixture({ graph }); const result = await send(f);
  assert.equal(result.ok, true); assert.equal(result.pending, true);
  assert.equal(f.rows[0].status, 'ambiguous'); assert.ok(!f.calls.some(c => c.method === 'DELETE'));
  assert.ok(!f.events.some(e => typeof e === 'object' && e?.type), 'pending send must not emit an immediate audit event');
  f.advance(120000); await assert.rejects(send(f), e => e.statusCode === 409);
  assert.equal(f.calls.filter(c => c.url.endsWith('/send')).length, 1);
  if (name === 'wrong identity') assert.equal(f.calls.filter(c => c.url.includes('$select=id,isDraft')).length, 3);
});
test('confirmed send with audit failure still returns success', async () => {
  const f = fixture({ auditFailure: true }); assert.equal((await send(f)).ok, true);
  assert.equal(f.rows[0].status, 'confirmed'); assert.ok(f.logs.some(([entry]) => entry.operation === 'email.audit_failed'));
});
test('R19 concurrent same token is reserved once', async () => {
  const f = fixture(); const results = await Promise.allSettled([send(f), send(f)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.rows.length, 1);
});
test('R19 concurrent DISTINCT tokens at daily99 admit one and reject the other for quota', async () => {
  const cap = fixture({ daily: 99 });
  const sends = await Promise.allSettled([send(cap), cap.service.sendForward('doc-1', actor, { body: '', recipients: [recipient] }, randomUUID())]);
  assert.equal(sends.filter(r => r.status === 'fulfilled').length, 1); assert.equal(cap.rows.length, 1);
  const rejected = sends.find(r => r.status === 'rejected');
  assert.equal(rejected.reason.statusCode, 429); assert.equal(rejected.reason.code, 'EMAIL_SEND_LIMIT');
  assert.equal(cap.calls.filter(c => c.method === 'POST' && (c.url.endsWith('/createReply') || c.url.endsWith('/messages'))).length, 1);
  assert.equal(cap.calls.filter(c => c.url.endsWith('/send')).length, 1);
  assert.match(cap.sqls.find(([s]) => s.includes('count(*)'))[0], /date_trunc\('day', now\(\) AT TIME ZONE \$2\) AT TIME ZONE \$2/);
});

test('normal confirmed send emits one metadata-only attempt and confirmed outcome', async () => {
  const f = fixture(); await send(f);
  const entries = f.logs.map(([entry]) => entry);
  assert.deepEqual(entries, [
    { operation: 'email.send_attempt', attemptId: f.rows[0].id, kind: 'reply', docId: 'doc-1', actorId: actor.userId, status: 'pending', code: 'EMAIL_SEND_ATTEMPT' },
    { operation: 'email.send_outcome', attemptId: f.rows[0].id, kind: 'reply', docId: 'doc-1', actorId: actor.userId, status: 'confirmed', code: 'EMAIL_SEND_CONFIRMED' },
  ]);
  assert.doesNotMatch(JSON.stringify(f.logs), /vendor@example.com|Please clarify|11111111|Original/);
});
for (const [name, failure, status, code] of [
  ['definite Graph400', () => Error('Graph 400 Bad Request: PRIVATE-BODY PRIVATE-TOKEN recipient@secret.example'), 'failed', 'EMAIL_SEND_FAILED'],
  ['network ambiguity', () => Error('PRIVATE-BODY PRIVATE-TOKEN recipient@secret.example'), 'ambiguous', 'EMAIL_SEND_AMBIGUOUS'],
  ['timeout ambiguity', () => Object.assign(Error('PRIVATE-BODY PRIVATE-TOKEN'), { code: 'EMAIL_TRANSPORT_TIMEOUT' }), 'ambiguous', 'EMAIL_SEND_AMBIGUOUS'],
]) test(`${name} logs an outcome even when cleanup and persistence succeed, without raw errors`, async () => {
  const f = fixture({ graph: async url => { if (url.endsWith('/send')) throw failure(); } });
  await assert.rejects(send(f), error => error.code === code);
  const entries = f.logs.map(([entry]) => entry);
  assert.equal(entries.filter(entry => entry.operation === 'email.send_attempt').length, 1);
  const outcomes = entries.filter(entry => entry.operation === 'email.send_outcome');
  assert.equal(outcomes.length, 1);
  assert.deepEqual({ ...outcomes[0], graphStatus: undefined, transportCode: undefined }, {
    operation: 'email.send_outcome', attemptId: f.rows[0].id, kind: 'reply', docId: 'doc-1', actorId: actor.userId,
    status, code, graphStatus: undefined, transportCode: undefined,
  });
  if (name === 'definite Graph400') assert.equal(outcomes[0].graphStatus, 400);
  if (name === 'timeout ambiguity') assert.equal(outcomes[0].transportCode, 'EMAIL_TRANSPORT_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE|secret.example|vendor@example.com|Please clarify|11111111/);
});

function reconciliationFixture(options = {}) {
  let row = {
    id: 'attempt-1', document_id: 'doc-1', direction: 'out', kind: 'reply', status: options.status || 'ambiguous',
    internet_message_id: null, graph_message_id: 'immutable-attempt', conversation_id: 'conversation-1',
    from_address: 'invoices@northwindcg.example', to_json: JSON.stringify(['vendor@example.com']), subject: 'RE: Original',
    has_attachments: false, actor_user_id: actor.userId, actor_name: 'Actual Actor', actor_role: 'accountant', attempted_at: '2026-09-15T12:00:00Z',
    send_started_at: '2026-09-15T12:00:01Z', resolved_at: null, sent_at: null,
  };
  const calls = []; const audits = []; let graphReads = 0; let lockTail = Promise.resolve();
  const acquire = async () => { const previous = lockTail; let release; lockTail = new Promise(resolve => { release = resolve; }); await previous; return release; };
  const clone = () => ({ ...row });
  async function query(sql, values = []) {
    if (sql.includes('SELECT id FROM document_email_messages')) return { rows: row.status === 'ambiguous' ? [{ id: row.id }] : [] };
    if (sql.includes('FROM document_email_messages')) return { rows: values[0] === row.id ? [clone()] : [] };
    if (sql.includes("SET status='confirmed'")) {
      if (!['ambiguous', 'pending'].includes(row.status)) return { rows: [] };
      row = { ...row, status: 'confirmed', internet_message_id: row.internet_message_id || values[1],
        conversation_id: row.conversation_id || values[2], sent_at: row.sent_at || values[3], resolved_at: 'now' };
      return { rows: [clone()] };
    }
    if (sql.includes("SET status='failed'")) {
      if (row.status !== 'ambiguous') return { rows: [] };
      row = { ...row, status: 'failed', resolved_at: 'now' }; return { rows: [clone()] };
    }
    return { rows: [] };
  }
  const pool = {
    query,
    async connect() {
      let release;
      return { async query(sql, values) {
        if (sql === 'BEGIN') { release = await acquire(); return { rows: [] }; }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') { release?.(); release = null; return { rows: [] }; }
        return query(sql, values);
      }, release() {} };
    },
  };
  const graph = async (url) => {
    calls.push(url); graphReads++;
    if (options.graphError) throw options.graphError;
    return typeof options.evidence === 'function' ? options.evidence(graphReads) : options.evidence;
  };
  const service = createReconciliationService({ pool, graph,
    config: { mailbox: 'invoices@northwindcg.example', reconciliation: { batchSize: 20, timeoutMs: 100 } },
    logger: { warn() {}, error() {} }, insertAuditEvent: async event => audits.push(event),
  });
  return { service, calls, audits, get row() { return row; } };
}

test('reconciliation requires exact immutable identity, not similar subject/time', async () => {
  assert.equal(classifyEvidence({ id: 'other-id', isDraft: false, internetMessageId: '<other>', sentDateTime: '2026-09-15T12:00:00Z' }, 'immutable-attempt'), 'ambiguous');
  const f = reconciliationFixture({ evidence: { id: 'other-id', isDraft: false, internetMessageId: '<other>', sentDateTime: '2026-09-15T12:00:00Z' } });
  const result = await f.service.reconcileAttempt('attempt-1');
  assert.equal(result.attempt.status, 'ambiguous'); assert.equal(f.audits.length, 0);
  assert.deepEqual(f.calls, ['/users/invoices%40northwindcg.example/messages/immutable-attempt?$select=id,isDraft,internetMessageId,conversationId,sentDateTime']);
  assert.equal(f.calls.some(url => url.endsWith('/send')), false);
});

test('exact Sent evidence confirms once, preserves actor, and replay does not read or audit again', async () => {
  const f = reconciliationFixture({ evidence: { id: 'immutable-attempt', isDraft: false, internetMessageId: '<exact>', conversationId: 'sent-conversation', sentDateTime: '2026-09-15T12:01:00Z' } });
  const first = await f.service.reconcileAttempt('attempt-1');
  const second = await f.service.reconcileAttempt('attempt-1');
  assert.equal(first.attempt.status, 'confirmed'); assert.equal(second.attempt.status, 'confirmed');
  assert.equal(f.row.actor_user_id, actor.userId); assert.equal(f.audits.length, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.audits[0].actor.userId, actor.userId); assert.equal(f.audits[0].actor.role, 'accountant'); assert.equal(f.audits[0].changes.attemptId, 'attempt-1');
  assert.equal(f.calls.some(url => url.endsWith('/send')), false);
});

test('missing, timeout, and partial evidence stay ambiguous; definitive failure alone marks failed', async () => {
  for (const options of [{ evidence: undefined }, { graphError: Object.assign(Error('timeout'), { code: 'EMAIL_TRANSPORT_TIMEOUT' }) },
    { evidence: { id: 'immutable-attempt', isDraft: true } }]) {
    const f = reconciliationFixture(options); const result = await f.service.reconcileAttempt('attempt-1');
    assert.equal(result.attempt.status, 'ambiguous'); assert.equal(f.audits.length, 0);
  }
  const failed = reconciliationFixture({ evidence: { definitiveFailure: true } });
  assert.equal((await failed.service.reconcileAttempt('attempt-1')).attempt.status, 'failed');
  assert.equal((await failed.service.reconcileAttempt('attempt-1')).attempt.status, 'failed'); assert.equal(failed.calls.length, 1);
});

test('overlapping reconciliation is row-serialized and audit-idempotent', async () => {
  const f = reconciliationFixture({ evidence: { id: 'immutable-attempt', isDraft: false, internetMessageId: '<exact>', sentDateTime: '2026-09-15T12:01:00Z' } });
  const results = await Promise.all([f.service.reconcileAttempt('attempt-1'), f.service.reconcileAttempt('attempt-1')]);
  assert.deepEqual(results.map(result => result.attempt.status), ['confirmed', 'confirmed']);
  assert.equal(f.calls.length, 1); assert.equal(f.audits.length, 1);
});

test('bounded sweep selects ambiguous attempts and returns status counts without send work', async () => {
  const f = reconciliationFixture({ evidence: { id: 'immutable-attempt', isDraft: false, internetMessageId: '<exact>', sentDateTime: '2026-09-15T12:01:00Z' } });
  assert.deepEqual(await f.service.reconcileSweep(1), { scanned: 1, confirmed: 1, failed: 0, ambiguous: 0 });
  assert.equal(f.calls.some(url => url.endsWith('/send')), false);
});

test('pending attempts remain untouched so a prior send-path audit cannot be duplicated', async () => {
  const f = reconciliationFixture({ status: 'pending', evidence: { id: 'immutable-attempt', isDraft: false, internetMessageId: '<exact>', sentDateTime: '2026-09-15T12:01:00Z' } });
  const result = await f.service.reconcileAttempt('attempt-1');
  assert.equal(result.attempt.status, 'pending'); assert.equal(f.calls.length, 0); assert.equal(f.audits.length, 0);
});
