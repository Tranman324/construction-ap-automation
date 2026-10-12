'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { load, database, request } = require('../helpers/commentHarness');
const actor = { userId: 'user-1', email: 'jane@example.test', role: 'ap' };
const janeProjection = {
  userId: 'user-1', name: 'Jane Reviewer', role: 'ap', azureId: 'azure-jane',
  avatarUrl: '/api/users/azure-jane/photo',
};

test('real protected route creates one trimmed immutable comment and body-free audit atomically', async () => {
  const pool = database();
  await load(pool, async ({ router }) => {
    const res = await request(router, 'post', '/:id/comments', { body: { body: '  <script>plain text</script>  ' } });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.comment.body, '<script>plain text</script>');
    assert.deepEqual(res.body.comment.actor, janeProjection);
    assert.equal(pool.state.comments.length, 1); assert.equal(pool.state.events.length, 1);
    assert.equal(pool.state.events[0].type, 'invoice.commented');
    assert.deepEqual(pool.state.events[0].changes, { commentId: res.body.comment.id, documentId: 'doc-1' });
    assert.ok(!JSON.stringify(pool.state.events).includes('<script>'));
    assert.deepEqual(pool.state.queries.filter(q => ['BEGIN','COMMIT','ROLLBACK'].includes(q)), ['BEGIN', 'COMMIT']);
    assert.ok(!pool.state.queries.some(q => q.includes('audit_log')));
  });
});

test('real route rejects empty/overlong/spoofed bodies and unauthorized comments and reads', async () => {
  const pool = database();
  await load(pool, async ({ router }) => {
    for (const body of [{ body: '  ' }, { body: 'x'.repeat(2001) }, { body: 'ok', actor: { name: 'spoof' } }]) {
      assert.equal((await request(router, 'post', '/:id/comments', { body })).statusCode, 400);
    }
    assert.equal((await request(router, 'post', '/:id/comments', { body: { body: 'ok' }, allowed: false })).statusCode, 403);
    assert.equal((await request(router, 'get', '/:id/activity', { allowed: false })).statusCode, 403);
    assert.equal((await request(router, 'get', '/:id/activity', { query: { unexpected: 'x' } })).statusCode, 400);
    assert.equal(pool.state.queries.length, 0);
  });
});

test('audit insertion failure rolls back the actual comment insert; connection always released', async () => {
  const pool = database({ failAudit: true });
  await load(pool, async ({ createComment }) => {
    await assert.rejects(createComment({ documentId: 'doc-1', body: 'private words', actor }), /audit unavailable/);
    assert.deepEqual(pool.state.comments, []); assert.deepEqual(pool.state.events, []);
    assert.ok(pool.state.queries.includes('ROLLBACK')); assert.equal(pool.state.released, 1);
  });
});

test('comment response uses canonical platform identity and neutralizes unresolved internal actors', async () => {
  await load(database({ userId: 'canonical-user' }), async ({ createComment }) => {
    const value = await createComment({ documentId: 'doc-1', body: 'ok', actor: { email: actor.email, role: 'ap' } });
    assert.deepEqual(value.actor, { ...janeProjection, userId: 'canonical-user' });
  });
  const pool = database({ name: null });
  await load(pool, async ({ createComment }) => {
    const value = await createComment({ documentId: 'discarded-doc', body: 'ok', actor });
    assert.deepEqual(value.actor, { userId: 'user-1', name: 'jane@example.test', role: 'ap', azureId: null, avatarUrl: null });
    for (const body of ['', ' '.repeat(5), 'x'.repeat(2001)]) await assert.rejects(createComment({ documentId: 'doc-1', body, actor }), { statusCode: 400 });
  });
  await load(database({ missing: true }), async ({ createComment }) => {
    await assert.rejects(createComment({ documentId: 'gone', body: 'ok', actor }), { statusCode: 404 });
  });
});

test('invoice-only audit writer resolves request identity at write and preserves transaction client', async () => {
  const pool = database();
  await load(pool, async ({ audit }) => {
    await audit.emitInvoiceAuditEvent({ user: actor }, {}, { type: 'invoice.approved', targetId: 'doc-1', summary: 'Approved', client: pool });
    assert.equal(pool.state.events[0].actor_name, 'Jane Reviewer');
    assert.equal(pool.state.events[0].actor_user_id, actor.userId);
    assert.equal(pool.state.events[0].actor_role, actor.role);
    await audit.emitInvoiceAuditEvent({ user: { email: actor.email } }, {}, { type: 'invoice.reviewed', targetId: 'doc-1', summary: 'Reviewed', client: pool });
    assert.equal(pool.state.events[1].actor_user_id, actor.email);
  });
});

test('migration offline structure is rerunnable, reversible, private and cascade-only deletion', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/2026-09-16_document_comments.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS document_comments/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS/); assert.match(sql, /ON DELETE CASCADE/);
  assert.match(sql, /CHECK \(char_length\(body\) BETWEEN 1 AND 2000/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/); assert.match(sql, /FOR ALL TO postgres, service_role/);
  assert.match(sql, /Rollback: DROP TABLE document_comments/);
});
