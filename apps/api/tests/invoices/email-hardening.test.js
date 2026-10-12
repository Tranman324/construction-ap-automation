'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, actor, token } = require('./email-fixtures');
const { graphCall } = require('../../modules/invoices/services/email/graphCall');
test('R4 deliberate new token can send even when a different attempt is unresolved', async () => {
  let fail = true;
  const f = fixture({ graph: async url => { if (url.endsWith('/send') && fail) throw Error('unknown'); } });
  await assert.rejects(f.service.sendReply('doc-1', actor, { body: 'one' }, token));
  f.advance(120000); fail = false;
  assert.equal((await f.service.sendReply('doc-1', actor, { body: 'two' }, randomUUID())).ok, true);
  assert.equal(f.rows.length, 2);
});
test('ten/minute limit counts accepted attempts and resets minute without removing daily accounting', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) await f.service.sendReply('doc-1', actor, { body: 'note' }, randomUUID());
  await assert.rejects(f.service.sendReply('doc-1', actor, { body: 'note' }, randomUUID()), e => e.statusCode === 429);
  f.advance(60001); assert.equal((await f.service.sendReply('doc-1', actor, { body: 'note' }, randomUUID())).ok, true);
});
test('Graph timeout bounds never-completing auth/transport and aborts; no retry', async () => {
  let signal; let calls = 0;
  await assert.rejects(graphCall(async (_, opts) => { calls++; signal = opts.signal; return new Promise(() => {}); }, '/synthetic', {}, 5),
    e => e.code === 'EMAIL_TRANSPORT_TIMEOUT');
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
});
test('directory excludes external, disabled and shared addresses; rejects Graph pagination outside users', async () => {
  const users = [
    { id: 'a', displayName: 'PM One', mail: 'pm@external.example' },
    { id: 'b', displayName: 'PM One', mail: 'pm@northwindcg.example', accountEnabled: false },
    { id: 'c', displayName: 'PM One', mail: 'invoices@northwindcg.example' },
  ];
  assert.deepEqual(await fixture({ users }).service.getForwardDefaults('doc-1'), { defaultRecipients: [] });
  const f = fixture({ graph: async url => url.startsWith('/users?') ? { value: [], '@odata.nextLink': 'https://evil.example' } : undefined });
  await assert.rejects(f.service.getForwardDefaults('doc-1'), e => e.code === 'EMAIL_DIRECTORY_FAILED');
});
test('source404 never creates a fresh message, preflight missing PDF never creates draft', async () => {
  const f = fixture({ graph: async url => { if (url.endsWith('/createReply')) throw Error('Graph 404 Gone'); } });
  await assert.rejects(f.service.sendReply('doc-1', actor, { body: 'note' }, token), e => e.code === 'EMAIL_SEND_FAILED');
  assert.equal(f.calls.length, 1); assert.equal(f.rows[0].status, 'failed');
});
