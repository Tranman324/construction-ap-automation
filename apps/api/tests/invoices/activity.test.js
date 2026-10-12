'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { load, request } = require('../helpers/commentHarness');

// Contract-aware injected SQL boundary, not a database execution claim.
function feedPool({ documentClassification = 'invoice', omitDocumentClassification = false } = {}) {
  const state = { activityReads: 0, classificationScalars: 0 };
  const rows = [
    ['comment', 'z', '2026-09-15T12:00:00Z'], ['comment', 'a', '2026-09-14T12:00:00Z'],
    ['event', 'y', '2026-09-15T12:00:00Z'], ['event', 'x', '2026-09-14T15:00:00Z'],
    ['event', 'unrelated', '2026-09-16T15:00:00Z'],
  ].map(([kind, id, timestamp]) => ({ kind, id, timestamp, payload: {
    id, timestamp, created_at: timestamp, document_id: 'doc-1', body: 'plain text',
    type: id === 'x' ? 'document.split_requested' : 'invoice.edited',
    target_type: id === 'x' ? 'document' : id === 'unrelated' ? 'platform-user' : 'invoice', target_id: 'doc-1', actor_user_id: 'user-2', actor_name: 'Sam', actor_role: 'ap', changes: { amount: [1, 2] },
  } }));
  rows.push({ kind: 'email', id: 'mail', timestamp: '2026-09-13T12:00:00Z', payload: {
    id: 'mail', document_id: 'doc-1', direction: 'in', kind: 'inbound', status: 'confirmed',
    received_at: '2026-09-13T12:00:00Z', created_at: '2026-09-13T12:00:00Z',
    from_address: 'vendor@example.test', to_json: [], subject: 'Question', has_attachments: false,
  } });
  return { async query(sql, params) {
    if (sql.includes('FROM toolbox_users')) return { rows: [{
      user_id: 'user-2', name: 'Sam Platform', platform_role: 'Accounts Payable',
      azure_id: 'azure-sam', avatar_url: 'https://avatars.example.test/sam', email: 'sam@example.test',
    }] };
    assert.match(sql, /UNION ALL/); assert.match(sql, /type <> 'invoice.commented'/);
    const targetTypes = sql.match(/target_type IN \(([^)]+)\)/)?.[1].match(/'([^']+)'/g)?.map(type => type.slice(1, -1)) || [];
    assert.ok(targetTypes.length > 0, 'feed must bound target types');
    assert.match(sql, /ORDER BY timestamp DESC, id DESC, kind DESC LIMIT \$2 OFFSET \$3/);
    assert.equal(sql.match(/LIMIT/g).length, 1, 'only merged source may be paginated');
    assert.match(sql, /COUNT\(\*\)::int FROM activity/);
    assert.match(sql, /jsonb_agg\(to_jsonb\(page\) ORDER BY timestamp DESC, id DESC, kind DESC\)/);
    const classificationScalars = sql.match(/SELECT classification FROM documents WHERE id = \$1/g) || [];
    assert.equal(classificationScalars.length, 1, 'classification must be a single request-scoped SQL scalar');
    state.classificationScalars += classificationScalars.length;
    state.activityReads += 1;
    const merged = rows.filter(row => row.kind === 'comment' || row.kind === 'email' || targetTypes.includes(row.payload.target_type)).sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
    const result = { document_exists: params[0] !== 'gone', total: merged.length, entries: merged.slice(params[2], params[2] + params[1]) };
    if (!omitDocumentClassification) result.document_classification = documentClassification;
    return { rows: [result] };
  }, state };
}


test('actual activity route serializes interleaved cross-source boundary/tie pages truthfully', async () => {
  await load(feedPool(), async ({ router, getActivity }) => {
    const first = await request(router, 'get', '/:id/activity', { query: { limit: '2', offset: '0' } });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.body.entries.map(e => [e.kind, e.id]), [['comment', 'z'], ['event', 'y']]);
    assert.deepEqual(first.body.entries[1].actor, {
      userId: 'user-2', name: 'Sam Platform', role: 'ap', azureId: 'azure-sam',
      avatarUrl: '/api/users/azure-sam/photo',
    });
    assert.deepEqual(first.body.pagination, { limit: 2, offset: 0, total: 5, hasMore: true });
    const next = await getActivity('doc-1', { limit: 2, offset: 2 });
    assert.deepEqual(next.entries.map(e => [e.kind, e.id]), [['event', 'x'], ['comment', 'a']]);
    assert.equal(next.pagination.hasMore, true);
    assert.equal(next.entries[0].type, 'document.split_requested');
    assert.equal(next.entries[0].target.type, 'document');
    const empty = await getActivity('doc-1', { limit: 2, offset: 99 });
    assert.deepEqual(empty.entries, []); assert.equal(empty.pagination.total, 5);
    await assert.rejects(getActivity('gone'), { statusCode: 404 });
  });
});

test('activity exposes request classification only on event entries with one SQL scalar', async () => {
  const db = feedPool();
  await load(db, async ({ router }) => {
    const response = await request(router, 'get', '/:id/activity', { query: { limit: '20', offset: '0' } });
    assert.equal(response.statusCode, 200);
    const eventEntries = response.body.entries.filter((entry) => entry.kind === 'event');
    assert.ok(eventEntries.length > 0);
    eventEntries.forEach((entry) => assert.equal(entry.documentClassification, 'invoice'));
    response.body.entries.filter((entry) => entry.kind !== 'event').forEach((entry) =>
      assert.equal(Object.hasOwn(entry, 'documentClassification'), false)
    );
  });
  assert.equal(db.state.activityReads, 1);
  assert.equal(db.state.classificationScalars, 1);
});

test('activity safely serializes null or missing request classification on event entries', async () => {
  for (const options of [{ documentClassification: null }, { omitDocumentClassification: true }]) {
    await load(feedPool(options), async ({ getActivity }) => {
      const { entries } = await getActivity('doc-1', { limit: 20, offset: 0 });
      entries.filter((entry) => entry.kind === 'event').forEach((entry) =>
        assert.equal(entry.documentClassification, null)
      );
    });
  }
});


function identityPool() {
  const users = [
    ['comment-user', 'Comment Canonical', 'legacy-comment@example.test', 'azure-comment', 'https://avatars.example.test/comment'],
    ['audit-user', 'Audit Canonical', 'audit@example.test', 'azure-audit', 'https://avatars.example.test/audit'],
    ['email-user', 'Email Canonical', 'email@example.test', 'azure-email', 'https://avatars.example.test/email'],
  ].map(([user_id, name, email, azure_id, avatar_url]) => ({
    user_id, name, email, azure_id, avatar_url, platform_role: 'Accounts Payable',
  }));
  const timestamp = '2026-09-15T12:00:00Z';
  const entries = [
    { kind: 'comment', id: 'comment', timestamp, payload: {
      id: 'comment', document_id: 'doc-1', body: 'Comment', created_at: timestamp,
      actor_user_id: 'legacy-comment@example.test', actor_name: 'legacy-comment@example.test', actor_role: 'ap',
    } },
    { kind: 'event', id: 'audit', timestamp, payload: {
      id: 'audit', timestamp, type: 'invoice.edited', target_type: 'invoice', target_id: 'doc-1',
      actor_user_id: 'audit-user', actor_name: 'audit@example.test', actor_role: 'ap', summary: 'Edited', module: 'invoices', severity: 'info',
    } },
    { kind: 'email', id: 'outbound', timestamp, payload: {
      id: 'outbound', document_id: 'doc-1', direction: 'out', kind: 'reply', status: 'confirmed', actor_user_id: 'email-user',
      sent_at: timestamp, created_at: timestamp, to_json: [], subject: 'Reply', has_attachments: false,
    } },
    { kind: 'event', id: 'former', timestamp, payload: {
      id: 'former', timestamp, type: 'invoice.edited', target_type: 'invoice', target_id: 'doc-1',
      actor_user_id: 'former@example.test', actor_name: 'former@example.test', actor_role: 'ap', summary: 'Edited', module: 'invoices', severity: 'info',
    } },
    { kind: 'email', id: 'inbound', timestamp, payload: {
      id: 'inbound', document_id: 'doc-1', direction: 'in', kind: 'inbound', status: 'confirmed',
      from_address: 'vendor@example.test', received_at: timestamp, created_at: timestamp, to_json: [], subject: 'Vendor reply', has_attachments: false,
    } },
    { kind: 'email', id: 'ndr', timestamp, payload: {
      id: 'ndr', document_id: 'doc-1', direction: 'in', kind: 'ndr', status: 'confirmed',
      from_address: 'mailer-daemon@example.test', received_at: timestamp, created_at: timestamp, to_json: [], subject: 'Delivery failure', has_attachments: false,
    } },
    { kind: 'event', id: 'system', timestamp, payload: {
      id: 'system', timestamp, type: 'invoice.intake', target_type: 'invoice', target_id: 'doc-1',
      actor_user_id: null, actor_name: 'System', actor_role: 'pipeline', summary: 'Received', module: 'invoices', severity: 'info',
    } },
  ];
  return { async query(sql, params) {
    if (sql.includes('FROM toolbox_users')) {
      assert.deepEqual(params[1], ['legacy-comment@example.test', 'audit@example.test', 'former@example.test']);
      return { rows: users };
    }
    return { rows: [{ document_exists: true, total: entries.length, entries }] };
  } };
}

test('activity uses canonical platform identities and preserves external provenance without platform photos', async () => {
  await load(identityPool(), async ({ getActivity }) => {
    const { entries } = await getActivity('doc-1', { limit: 20 });
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    assert.deepEqual(byId.get('comment').actor, {
      userId: 'comment-user', name: 'Comment Canonical', role: 'ap', azureId: 'azure-comment',
      avatarUrl: '/api/users/azure-comment/photo',
    });
    assert.deepEqual(byId.get('audit').actor, {
      userId: 'audit-user', name: 'Audit Canonical', role: 'ap', azureId: 'azure-audit',
      avatarUrl: '/api/users/azure-audit/photo',
    });
    assert.deepEqual(byId.get('outbound').actor, {
      userId: 'email-user', name: 'Email Canonical', role: 'Accounts Payable', azureId: 'azure-email',
      avatarUrl: '/api/users/azure-email/photo',
    });
    assert.deepEqual(byId.get('former').actor, {
      userId: 'former@example.test', name: 'former@example.test', role: 'ap', azureId: null, avatarUrl: null,
    });
    for (const id of ['inbound', 'ndr', 'system']) {
      assert.equal(byId.get(id).actor.userId, null);
      assert.equal(byId.get(id).actor.azureId, null);
      assert.equal(byId.get(id).actor.avatarUrl, null);
    }
    assert.equal(byId.get('inbound').actor.name, 'vendor@example.test');
    assert.equal(byId.get('ndr').actor.name, 'System');
    assert.equal(byId.get('system').actor.name, 'System');
  });
});

function event({
  id,
  timestamp,
  actorId = 'actor-1',
  type = 'invoice.edited',
  changes = { phaseCode: ['old', 'new'] },
  undoneAt = null,
  summary = 'Invoice edited',
} = {}) {
  return {
    kind: 'event', id, timestamp, type, changes, undoneAt, summary,
    actor: { userId: actorId, name: 'Pat Reviewer', role: 'ap' },
  };
}

test('coalesces same-actor edits with earliest from, latest to, and the latest entry metadata', async () => {
  await load(feedPool(), async ({ coalesceEvents }) => {
    const entries = coalesceEvents([
      event({ id: 'latest', timestamp: '2026-09-15T12:00:50Z', changes: { phaseCode: ['00710', '08360'] }, summary: 'Latest edit' }),
      event({ id: 'earliest', timestamp: '2026-09-15T12:00:20Z', changes: { phaseCode: ['', '00710'], glAccount: ['5300', '5600'] } }),
    ]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'latest');
    assert.equal(entries[0].timestamp, '2026-09-15T12:00:50Z');
    assert.equal(entries[0].summary, 'Latest edit');
    assert.deepEqual(entries[0].changes, { phaseCode: ['', '08360'], glAccount: ['5300', '5600'] });
  });
});

test('coalesces events exactly 60 seconds apart', async () => {
  await load(feedPool(), async ({ coalesceEvents }) => {
    const entries = coalesceEvents([
      event({ id: 'latest', timestamp: '2026-09-15T12:01:00Z', changes: { phaseCode: ['00710', '08360'] } }),
      event({ id: 'earliest', timestamp: '2026-09-15T12:00:00Z', changes: { phaseCode: ['', '00710'] } }),
    ]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].timestamp, '2026-09-15T12:01:00Z');
    assert.deepEqual(entries[0].changes, { phaseCode: ['', '08360'] });
  });
});

test('does not coalesce events from different actors or events more than 60 seconds apart', async () => {
  await load(feedPool(), async ({ coalesceEvents }) => {
    assert.equal(coalesceEvents([
      event({ id: 'a', timestamp: '2026-09-15T12:01:00Z' }),
      event({ id: 'b', timestamp: '2026-09-15T12:00:30Z', actorId: 'actor-2' }),
    ]).length, 2);
    assert.equal(coalesceEvents([
      event({ id: 'a', timestamp: '2026-09-15T12:01:01Z' }),
      event({ id: 'b', timestamp: '2026-09-15T12:00:00Z' }),
    ]).length, 2);
    assert.equal(coalesceEvents([
      event({ id: 'a', timestamp: '2026-09-15T12:00:50Z', actorId: null }),
      event({ id: 'b', timestamp: '2026-09-15T12:00:20Z', actorId: null }),
    ]).length, 2);
    assert.equal(coalesceEvents([
      event({ id: 'a', timestamp: '2026-09-15T12:00:50Z', type: 'invoice.classified' }),
      event({ id: 'b', timestamp: '2026-09-15T12:00:20Z' }),
    ]).length, 2);
  });
});

test('greedily collapses a chain of three edits and drops net no-op fields', async () => {
  await load(feedPool(), async ({ coalesceEvents }) => {
    const entries = coalesceEvents([
      event({ id: 'latest', timestamp: '2026-09-15T12:00:50Z', changes: { phaseCode: ['08360', '00710'], costType: ['M', 'M'] } }),
      event({ id: 'middle', timestamp: '2026-09-15T12:00:30Z', changes: { phaseCode: ['00710', '08360'] } }),
      event({ id: 'earliest', timestamp: '2026-09-15T12:00:00Z', changes: { phaseCode: ['00710', '00710'], costType: ['M', 'M'] } }),
    ]);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].changes, {});
  });
});

test('drops structurally equal object values after a coalesced edit reversal', async () => {
  await load(feedPool(), async ({ coalesceEvents }) => {
    const entries = coalesceEvents([
      event({
        id: 'latest', timestamp: '2026-09-15T12:00:50Z',
        changes: { routingMetadata: [{ state: 'edited', codes: ['A', 'B'] }, { codes: ['A', 'B'], state: 'original' }] },
      }),
      event({
        id: 'earliest', timestamp: '2026-09-15T12:00:20Z',
        changes: { routingMetadata: [{ state: 'original', codes: ['A', 'B'] }, { state: 'edited', codes: ['A', 'B'] }] },
      }),
    ]);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].changes, {});
  });
});

test('does not coalesce undone events, intervening comments or emails, or non-object changes', async () => {
  await load(feedPool(), async ({ coalesceEvents }) => {
    assert.equal(coalesceEvents([
      event({ id: 'new', timestamp: '2026-09-15T12:00:50Z' }),
      event({ id: 'old', timestamp: '2026-09-15T12:00:20Z', undoneAt: '2026-09-15T12:00:55Z' }),
    ]).length, 2);
    assert.equal(coalesceEvents([
      event({ id: 'new', timestamp: '2026-09-15T12:00:50Z', undoneAt: '2026-09-15T12:00:55Z' }),
      event({ id: 'old', timestamp: '2026-09-15T12:00:20Z' }),
    ]).length, 2);
    assert.equal(coalesceEvents([
      event({ id: 'new', timestamp: '2026-09-15T12:00:50Z' }),
      { kind: 'comment', id: 'comment', timestamp: '2026-09-15T12:00:40Z' },
      event({ id: 'old', timestamp: '2026-09-15T12:00:20Z' }),
    ]).length, 3);
    assert.equal(coalesceEvents([
      event({ id: 'new', timestamp: '2026-09-15T12:00:50Z' }),
      { kind: 'email', id: 'email', timestamp: '2026-09-15T12:00:40Z' },
      event({ id: 'old', timestamp: '2026-09-15T12:00:20Z' }),
    ]).length, 3);
    assert.equal(coalesceEvents([
      event({ id: 'new', timestamp: '2026-09-15T12:00:50Z' }),
      event({ id: 'old', timestamp: '2026-09-15T12:00:20Z', changes: false }),
    ]).length, 2);
    assert.equal(coalesceEvents([
      event({ id: 'new', timestamp: '2026-09-15T12:00:50Z', changes: false }),
      event({ id: 'old', timestamp: '2026-09-15T12:00:20Z' }),
    ]).length, 2);
  });
});

test('activity response keeps SQL pagination totals and hasMore semantics after coalescing', async () => {
  const timestamp = '2026-09-15T12:00:50Z';
  const rawEntries = [
    { kind: 'event', timestamp, payload: { id: 'latest', timestamp, type: 'invoice.edited', actor_user_id: 'actor-1', actor_name: 'Pat', actor_role: 'ap', changes: { phaseCode: ['00710', '08360'] }, summary: 'Latest' } },
    { kind: 'event', timestamp: '2026-09-15T12:00:20Z', payload: { id: 'older', timestamp: '2026-09-15T12:00:20Z', type: 'invoice.edited', actor_user_id: 'actor-1', actor_name: 'Pat', actor_role: 'ap', changes: { phaseCode: ['', '00710'] }, summary: 'Older' } },
  ];
  const db = { async query(sql) {
    if (sql.includes('FROM toolbox_users')) return { rows: [] };
    return { rows: [{ document_exists: true, total: 2, entries: rawEntries }] };
  } };
  await load(db, async ({ getActivity }) => {
    const response = await getActivity('doc-1', { limit: 2, offset: 0 });
    assert.equal(response.entries.length, 1);
    assert.deepEqual(response.pagination, { limit: 2, offset: 0, total: 2, hasMore: false });
  });
});
