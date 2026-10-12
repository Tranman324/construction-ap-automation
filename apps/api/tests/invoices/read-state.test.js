'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { load, request } = require('../helpers/commentHarness');

const cutoff = new Date('2026-09-15T12:00:05.000Z');

function readStatePool() {
  const state = {
    document: { id: 'doc-1', activity_viewed_at: null },
    collectionRow: {
      id: 'doc-1', classification: 'invoice', status: 'pending', file_name: 'invoice.pdf',
      activity_viewed_at: null,
    },
    emails: [
      { id: 'in-old-1', direction: 'in', kind: 'inbound', status: 'confirmed', created_at: '2026-09-15T12:00:01.000Z', read_at: null },
      { id: 'in-old-2', direction: 'in', kind: 'inbound', status: 'confirmed', created_at: '2026-09-15T12:00:02.000Z', read_at: null },
      { id: 'out', direction: 'out', kind: 'reply', status: 'confirmed', created_at: '2026-09-15T12:00:03.000Z', read_at: null },
    ],
    comments: [{ created_at: '2026-09-15T12:00:01.000Z' }],
    queries: [],
  };
  const query = async (sql, params = []) => {
    state.queries.push(sql);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.startsWith('SELECT id, activity_viewed_at')) return { rows: [state.document] };
    if (sql === 'SELECT * FROM documents WHERE id = $1') return { rows: [state.collectionRow] };
    if (sql.startsWith('SELECT COUNT(*) FROM documents')) return { rows: [{ count: '1' }] };
    if (sql.includes('SELECT id, classification') && sql.includes('FROM documents')) {
      const viewedAt = state.collectionRow.activity_viewed_at;
      const unreadReplies = state.emails.filter((email) => email.direction === 'in'
        && email.kind === 'inbound' && (!viewedAt || new Date(email.created_at) > viewedAt)).length;
      const unreadComments = state.comments.filter((comment) => !viewedAt
        || new Date(comment.created_at) > viewedAt).length;
      return { rows: [{ ...state.collectionRow, unread_replies: unreadReplies, unread_comments: unreadComments }] };
    }
    if (sql.startsWith('UPDATE documents')) {
      state.document.activity_viewed_at = cutoff;
      return { rows: [state.document] };
    }
    if (sql.includes('UPDATE document_email_messages')) {
      for (const email of state.emails) {
        if (email.direction === 'in' && email.kind === 'inbound' && !email.read_at
          && new Date(email.created_at) <= params[1]) email.read_at = params[1];
      }
      return { rows: [] };
    }
    if (sql.includes('COUNT(*)::int FROM document_email_messages')) {
      const viewedAt = params[1] && new Date(params[1]);
      const unreadReplies = state.emails.filter((email) => email.direction === 'in'
        && email.kind === 'inbound' && (!viewedAt || new Date(email.created_at) > viewedAt)).length;
      const unreadComments = state.comments.filter((comment) => !viewedAt
        || new Date(comment.created_at) > viewedAt).length;
      return { rows: [{ unread_replies: unreadReplies, unread_comments: unreadComments }] };
    }
    throw new Error('Unexpected SQL: ' + sql);
  };
  return { state, query, connect: async () => ({ query, release() {} }) };
}

test('view returns prior cutoff, advances atomically, and bulk marks inbound only', async () => {
  const pool = readStatePool();
  await load(pool, async ({ viewActivity }) => {
    const first = await viewActivity('doc-1');
    assert.deepEqual(first, {
      documentId: 'doc-1',
      priorActivityViewedAt: null,
      activityViewedAt: cutoff.toISOString(),
      unreadReplies: 0,
      unreadComments: 0,
    });
    assert.equal(pool.state.emails[0].read_at, cutoff);
    assert.equal(pool.state.emails[1].read_at, cutoff);
    assert.equal(pool.state.emails[2].read_at, null);
    assert.deepEqual(pool.state.queries.slice(0, 2), ['BEGIN', 'SELECT id, activity_viewed_at FROM documents WHERE id = $1 FOR UPDATE']);
  });
});

test('later server arrivals remain unread even when display time is backdated', async () => {
  const pool = readStatePool();
  pool.state.document.activity_viewed_at = cutoff;
  pool.state.emails.push({
    id: 'in-late', direction: 'in', kind: 'inbound', status: 'confirmed',
    created_at: '2026-09-15T12:00:06.000Z', received_at: '2026-09-15T11:00:00.000Z', read_at: null,
  });
  pool.state.comments.push({ created_at: '2026-09-15T12:00:07.000Z' });
  await load(pool, async ({ getUnreadAggregates }) => {
    assert.deepEqual(await getUnreadAggregates('doc-1', cutoff), { unreadReplies: 1, unreadComments: 1 });
  });
});

test('permission denial is a no-clear negative control for the view route', async () => {
  const pool = readStatePool();
  await load(pool, async ({ router }) => {
    const response = await request(router, 'post', '/:id/activity/view', { allowed: false });
    assert.equal(response.statusCode, 403);
    assert.equal(pool.state.queries.length, 0);
  });
});

test('view route requires a strict empty body and does not mutate on rejection', async () => {
  const pool = readStatePool();
  await load(pool, async ({ router }) => {
    const response = await request(router, 'post', '/:id/activity/view', {
      body: { activityViewedAt: '2026-09-15T12:00:00.000Z' },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(pool.state.document.activity_viewed_at, null);
    assert.equal(pool.state.queries.length, 0);
    const success = await request(router, 'post', '/:id/activity/view', { body: {} });
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.documentId, 'doc-1');
    assert.equal(success.body.activityViewedAt, cutoff.toISOString());
    assert.deepEqual(
      [success.body.unreadReplies, success.body.unreadComments],
      [0, 0]
    );
  });
});

test('repeated views share the server cutoff and never regress it', async () => {
  const pool = readStatePool();
  await load(pool, async ({ viewActivity }) => {
    const first = await viewActivity('doc-1');
    const second = await viewActivity('doc-1');
    assert.equal(second.priorActivityViewedAt, first.activityViewedAt);
    assert.equal(second.activityViewedAt, first.activityViewedAt);
    assert.ok(second.activityViewedAt >= first.activityViewedAt);
  });
});

test('server-arrival ordering keeps a concurrent late write unread', async () => {
  const pool = readStatePool();
  let viewUpdated = false;
  const originalConnect = pool.connect;
  pool.connect = async () => {
    const client = await originalConnect();
    const originalQuery = client.query;
    client.query = async (sql, params) => {
      const result = await originalQuery(sql, params);
      if (sql.startsWith('UPDATE documents')) {
        viewUpdated = true;
        pool.state.emails.push({ id: 'concurrent-in', direction: 'in', kind: 'inbound', status: 'confirmed', created_at: '2026-09-15T12:00:06.000Z', read_at: null });
      }
      return result;
    };
    return client;
  };
  await load(pool, async ({ viewActivity, getUnreadAggregates }) => {
    await viewActivity('doc-1');
    assert.equal(viewUpdated, true);
    assert.deepEqual(await getUnreadAggregates('doc-1', cutoff), { unreadReplies: 1, unreadComments: 0 });
  });
});

test('list and detail runtime responses agree on additive unread fields and cardinality', async () => {
  const pool = readStatePool();
  await load(pool, async () => {
    const collectionPath = require.resolve('../../modules/invoices/services/invoiceCollectionService');
    const priorCollection = require.cache[collectionPath];
    delete require.cache[collectionPath];
    try {
      const { getInvoice, listInvoices } = require(collectionPath);
      const response = () => ({
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
      });
      const list = response();
      await listInvoices({ query: {} }, list);
      const detail = response();
      await getInvoice({ params: { id: 'doc-1' }, query: {}, user: { permissions: [] } }, detail);
      assert.equal(list.body.invoices.length, 1);
      assert.deepEqual(
        [list.body.invoices[0].unreadReplies, list.body.invoices[0].unreadComments],
        [detail.body.unreadReplies, detail.body.unreadComments]
      );
    } finally {
      if (priorCollection) require.cache[collectionPath] = priorCollection;
      else delete require.cache[collectionPath];
    }
  });
});

test('list and detail serializers retain additive unread field projection', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../modules/invoices/services/supabase.js'), 'utf8');
  assert.match(source, /unreadReplies: Number\.parseInt/);
  assert.match(source, /unreadComments: Number\.parseInt/);
  const collection = fs.readFileSync(path.join(__dirname, '../../modules/invoices/services/invoiceCollectionService.js'), 'utf8');
  assert.match(collection, /unread_replies/);
  assert.match(collection, /unread_comments/);
});

test('activity email serialization exposes confirmed metadata without message body', async () => {
  const pool = {
    query: async (sql, params) => {
      assert.equal(params[0], 'doc-1');
      assert.match(sql, /document_email_messages/);
      assert.match(sql, /direction = 'out' AND status = 'confirmed'/);
      return { rows: [{ document_exists: true, total: 1, entries: [{
        kind: 'email', timestamp: '2026-09-15T12:00:04.000Z',
        payload: {
          id: 'out', document_id: 'doc-1', direction: 'out', kind: 'reply', status: 'confirmed',
          from_address: 'ap@example.test', to_json: '["vendor@example.test"]',
          subject: 'Re: invoice', body_preview: 'Preview only', body: 'must not serialize',
          has_attachments: false, attachment_reviewed: false, verified_participant: true,
        },
      }] }] };
    },
  };
  await load(pool, async ({ getActivity }) => {
    const result = await getActivity('doc-1');
    assert.equal(result.entries[0].kind, 'email');
    assert.equal(result.entries[0].status, 'confirmed');
    assert.equal(result.entries[0].body, undefined);
    assert.equal(result.entries[0].bodyPreview, 'Preview only');
  });
});

test('list projections use scalar unread counts and preserve one row per document', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../modules/invoices/services/invoiceCollectionService.js'), 'utf8');
  assert.match(source, /const LIST_UNREAD_COLUMNS/);
  assert.match(source, /FROM document_email_messages m/);
  assert.match(source, /FROM document_comments c/);
  assert.doesNotMatch(source, /JOIN document_email_messages/);
});

test('read-state migration is manual-review and has rollback guidance', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../migrations/2026-09-16_document_read_state.sql'), 'utf8');
  assert.match(source, /ADD COLUMN IF NOT EXISTS activity_viewed_at/);
  assert.equal((source.match(/SET DEFAULT clock_timestamp\(\)/g) || []).length, 2);
  assert.match(source, /direction = 'in' AND kind = 'inbound'/);
  assert.match(source, /Rollback:/);
  assert.match(source, /BEGIN;/);
  assert.match(source, /COMMIT;/);
});
