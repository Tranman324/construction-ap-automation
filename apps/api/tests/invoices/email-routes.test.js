'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { fixture, actor, token, recipient } = require('./email-fixtures');
const { EmailError } = require('../../modules/invoices/services/email');
const publicEmailService = require('../../modules/invoices/services/email');
const permission = 'accounting.invoices.request_waiver';
async function routerFor(f, work) {
  const target = require.resolve('../../modules/invoices/routes/documents');
  const collaboration = require.resolve('../../modules/invoices/routes/collaboration');
  const original = Module._load; delete require.cache[target]; delete require.cache[collaboration];
  Module._load = function(name, parent, main) {
    if (name === '../services/email') return { ...f.service, EmailError };
    if (name === '../services/commentService') return { createComment: async () => ({}) };
    if (name === '../services/activityService') return { getActivity: async () => ({}), viewActivity: async () => ({}) };
    if (name === '../services/spectrumCoiUploadService') return {};
    return original.call(this, name, parent, main);
  };
  try { await work(require(target)); } finally { Module._load = original; delete require.cache[target]; delete require.cache[collaboration]; }
}
async function routerForPublic(work) {
  const target = require.resolve('../../modules/invoices/routes/documents');
  const collaboration = require.resolve('../../modules/invoices/routes/collaboration');
  const original = Module._load; delete require.cache[target]; delete require.cache[collaboration];
  Module._load = function(name, parent, main) {
    if (name === '../services/email') return publicEmailService;
    if (name === '../services/commentService') return { createComment: async () => ({}) };
    if (name === '../services/activityService') return { getActivity: async () => ({}), viewActivity: async () => ({}) };
    if (name === '../services/spectrumCoiUploadService') return {};
    return original.call(this, name, parent, main);
  };
  try { await work(require(target)); } finally { Module._load = original; delete require.cache[target]; delete require.cache[collaboration]; }
}
async function invoke(router, name, body, opts = {}) {
  const route = router.stack.find(l => l.route?.path === `/:id/${name}`).route;
  const req = { params: { id: 'doc-1' }, query: {}, body,
    user: opts.anonymous ? null : { ...actor, permissions: opts.denied ? [] : [permission] },
    get: () => opts.badToken ? 'bad' : token };
  let done; const finished = new Promise(resolve => { done = resolve; });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; done(); return this; } };
  let i = 0; const next = async () => { if (route.stack[i]) await route.stack[i++].handle(req, res, next); };
  await next(); await finished; return res;
}
async function invokeAttempt(router, path, body, opts = {}) {
  const route = router.stack.find(layer => layer.route?.path === path).route;
  const req = { params: { attemptId: 'attempt-1' }, query: {}, body,
    user: opts.anonymous ? null : { ...actor, permissions: opts.denied ? [] : ['accounting.invoices.view_details'] } };
  let done; const finished = new Promise(resolve => { done = resolve; });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; done(); return this; } };
  let i = 0; const next = async () => { if (route.stack[i]) await route.stack[i++].handle(req, res, next); };
  await next(); await finished; return res;
}
test('actual routes protect all three endpoints and reject spoofed actor/retired attachment flag before side effects', async () => {
  const f = fixture(); await routerFor(f, async router => {
    for (const name of ['reply', 'forward', 'forward-defaults']) {
      for (const opts of [{ denied: true }, { anonymous: true }]) {
        assert.equal((await invoke(router, name, { body: 'hello' }, opts)).statusCode, 403);
      }
    }
    for (const body of [{ body: 'hello', actor: 'spoof' }, { body: 'hello', attachPdf: false }]) {
      assert.equal((await invoke(router, 'reply', body)).statusCode, 400);
    }
    assert.equal((await invoke(router, 'reply', { body: 'hello' }, { badToken: true })).statusCode, 400);
  }); assert.equal(f.calls.length, 0);
});
test('actual routes accept5000 reject5001 and forward IDs cannot be addresses', async () => {
  for (const name of ['reply', 'forward']) {
    const f = fixture(); await routerFor(f, async router => {
      const body = { body: 'a'.repeat(5000), ...(name === 'forward' ? { recipients: [recipient] } : {}) };
      assert.equal((await invoke(router, name, { ...body, body: 'a'.repeat(5001) })).statusCode, 400);
      assert.equal((await invoke(router, name, body)).statusCode, 200);
    });
  }
  const f = fixture(); await routerFor(f, async router => {
    for (const recipients of [[], ['outside@example.com']]) {
      assert.equal((await invoke(router, 'forward', { body: '', recipients })).statusCode, 400);
    }
  });
});
test('actual routes emit canonical kill switch, ambiguous attempt metadata and no-thread errors', async () => {
  for (const [options, status, code] of [[{ disabled: true }, 503, undefined],
    [{ doc: { email_message_id: null } }, 409, 'EMAIL_NO_THREAD'],
    [{ graph: async url => { if (url.endsWith('/send')) throw Error('network'); } }, 502, 'EMAIL_SEND_AMBIGUOUS']]) {
    const f = fixture(options); await routerFor(f, async router => {
      const res = await invoke(router, 'reply', { body: 'hello' });
      assert.equal(res.statusCode, status); assert.equal(res.body.code, code);
      if (status === 503) assert.deepEqual(res.body, { error: 'email_sends_disabled' });
      if (code === 'EMAIL_SEND_AMBIGUOUS') assert.ok(res.body.details.attemptId);
    });
  }
});

test('confirmed Sent copy plus outbox finish failure returns200, still audits and never retries or deletes', async () => {
  const f = fixture({ confirmationFailure: true });
  await routerFor(f, async router => {
    const res = await invoke(router, 'reply', { body: 'hello' });
    assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { ok: true, sentTo: 'vendor@example.com' });
  });
  assert.equal(f.rows[0].status, 'pending', 'failed finish did not persist confirmation');
  assert.equal(f.events.filter(e => e === 'confirmation-persist-failed').length, 1);
  assert.equal(f.events.filter(e => typeof e === 'object' && e.type === 'invoice.email_replied').length, 1);
  assert.equal(f.calls.filter(c => c.url.endsWith('/send')).length, 1);
  assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 0);
  assert.ok(f.logs.some(([entry]) => entry.operation === 'email.confirmation_persist_failed'));
  assert.ok(f.logs.some(([entry]) => entry.operation === 'email.send_outcome' && entry.status === 'confirmed'));
});

test('forward recipient boundary accepts10 directory IDs and rejects11 before transport', async () => {
  const { randomUUID } = require('node:crypto');
  const users = Array.from({ length: 11 }, (_, index) => ({ id: randomUUID(), displayName: `User ${index}`, mail: `user${index}@northwindcg.example` }));
  const f = fixture({ users });
  await routerFor(f, async router => {
    const tooMany = await invoke(router, 'forward', { body: '', recipients: users.map(user => user.id) });
    assert.equal(tooMany.statusCode, 400); assert.equal(f.calls.length, 0); assert.equal(f.rows.length, 0);
    const accepted = await invoke(router, 'forward', { body: '', recipients: users.slice(0, 10).map(user => user.id) });
    assert.equal(accepted.statusCode, 200); assert.equal(accepted.body.sentTo.length, 10);
  });
});

test('reconciliation status routes require view permission and preserve response boundaries', async () => {
  const f = fixture();
  f.service.getEmailAttemptStatus = async id => ({ attemptId: id, status: 'ambiguous' });
  f.service.reconcileEmailAttempt = async id => ({ attempt: { attemptId: id, status: 'ambiguous' }, transitioned: false });
  await routerFor(f, async router => {
    for (const path of ['/email-attempts/:attemptId', '/email-attempts/:attemptId/reconcile']) {
      assert.equal((await invokeAttempt(router, path, {}, { denied: true })).statusCode, 403);
    }
    assert.deepEqual((await invokeAttempt(router, '/email-attempts/:attemptId', {})).body, { attemptId: 'attempt-1', status: 'ambiguous' });
    assert.deepEqual((await invokeAttempt(router, '/email-attempts/:attemptId/reconcile', {})).body, {
      attempt: { attemptId: 'attempt-1', status: 'ambiguous' }, transitioned: false,
    });
    assert.equal((await invokeAttempt(router, '/email-attempts/:attemptId/reconcile', { unexpected: true })).statusCode, 400);
  });
});

test('public email service surface exports all reconciliation entry points before route use', () => {
  for (const name of ['getEmailAttemptStatus', 'reconcileEmailAttempt', 'reconcileEmailSweep']) {
    assert.equal(typeof publicEmailService[name], 'function', `${name} must be publicly callable`);
  }
});

test('reconciliation routes call the module-level public email service surface', async () => {
  const names = ['getEmailAttemptStatus', 'reconcileEmailAttempt', 'reconcileEmailSweep'];
  const originals = Object.fromEntries(names.map(name => [name, publicEmailService[name]]));
  for (const name of names) assert.equal(typeof originals[name], 'function', `${name} must be publicly callable`);
  const calls = [];
  publicEmailService.getEmailAttemptStatus = async id => {
    calls.push(['getEmailAttemptStatus', id]); return { attemptId: id, status: 'ambiguous' };
  };
  publicEmailService.reconcileEmailAttempt = async id => {
    calls.push(['reconcileEmailAttempt', id]);
    return { attempt: { attemptId: id, status: 'confirmed' }, transitioned: true };
  };
  try {
    await routerForPublic(async router => {
      assert.deepEqual((await invokeAttempt(router, '/email-attempts/:attemptId', {})).body,
        { attemptId: 'attempt-1', status: 'ambiguous' });
      assert.deepEqual((await invokeAttempt(router, '/email-attempts/:attemptId/reconcile', {})).body,
        { attempt: { attemptId: 'attempt-1', status: 'confirmed' }, transitioned: true });
    });
  } finally {
    Object.assign(publicEmailService, originals);
  }
  assert.deepEqual(calls, [
    ['getEmailAttemptStatus', 'attempt-1'], ['reconcileEmailAttempt', 'attempt-1'],
  ]);
});
