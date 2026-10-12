'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const test = require('node:test');

const calls = [];
let missing = false;
class EmailError extends Error {}
const fakeEmail = {
  EmailError,
  getEmailAttemptStatus: async (id) => ({ attemptId: id, status: 'confirmed' }),
  reconcileEmailAttempt: async (id) => ({ attempt: { attemptId: id, status: 'confirmed' }, transitioned: true }),
  sendReply: async (id) => ({ ok: true, sentTo: `${id}@vendor.test` }),
  sendForward: async (id) => ({ ok: true, sentTo: [`${id}@recipient.test`] }),
  getReplyRecipient: async () => ({ recipientType: 'direct', directEmail: 'vendor@test.example', candidates: [], directoryContacts: [] }),
  getForwardDefaults: async (id) => ({ documentId: id, defaultRecipients: [] }),
};

function missingDocument() {
  const error = new Error('Document not found'); error.statusCode = 404; return error;
}

function loadSharedRoutes() {
  const target = require.resolve('../../modules/invoices/routes/collaboration');
  const dependencies = {
    commentService: {
      createComment: async ({ documentId }) => { calls.push(['comment', documentId]); if (missing) throw missingDocument(); return { kind: 'comment', id: 'comment-1', documentId, body: 'note' }; },
    },
    activityService: {
      getActivity: async (documentId) => { calls.push(['activity', documentId]); if (missing) throw missingDocument(); return { entries: [], pagination: { limit: 50, offset: 0, total: 0, hasMore: false } }; },
      viewActivity: async (documentId) => { calls.push(['view', documentId]); if (missing) throw missingDocument(); return { documentId, priorActivityViewedAt: null, activityViewedAt: '2026-09-16T00:00:00.000Z', unreadReplies: 0, unreadComments: 0 }; },
    },
    email: fakeEmail,
  };
  return { ...require(target), dependencies };
}

function routeRequest(router, method, path, options = {}) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route;
  const params = path.includes(':attemptId') ? { attemptId: 'attempt-1' } : { id: 'doc-1' };
  const req = {
    params, query: options.query || {}, body: options.body || {},
    user: { userId: 'user-1', email: 'user@example.test', role: 'ap', permissions: options.allowed === false ? [] : ['accounting.invoices.view_details', 'accounting.invoices.request_waiver'] },
    get: () => '4f3f7f2a-2b5f-4e12-8d72-d6d3bb0fd0f3',
  };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  let index = 0;
  return (async () => {
    const next = async () => { const layer = route.stack[index++]; if (layer) await layer.handle(req, res, next); };
    await next();
    return res;
  })();
}

const ENDPOINTS = [
  ['post', '/:id/comments', { body: { body: 'note' } }, 'accounting.invoices.view_details'],
  ['get', '/:id/activity', { query: { limit: '50', offset: '0' } }, 'accounting.invoices.view_details'],
  ['post', '/:id/activity/view', { body: {} }, 'accounting.invoices.view_details'],
  ['get', '/email-attempts/:attemptId', {}, 'accounting.invoices.view_details'],
  ['post', '/email-attempts/:attemptId/reconcile', { body: {} }, 'accounting.invoices.view_details'],
  ['post', '/:id/reply', { body: { body: 'reply' } }, 'accounting.invoices.request_waiver'],
  ['get', '/:id/reply-recipient', {}, 'accounting.invoices.request_waiver'],
  ['post', '/:id/forward', { body: { body: '', recipients: ['4f3f7f2a-2b5f-4e12-8d72-d6d3bb0fd0f3'] } }, 'accounting.invoices.request_waiver'],
  ['get', '/:id/forward-defaults', {}, 'accounting.invoices.request_waiver'],
];

test('nine document surfaces resolve to the two explicit caller route families', () => {
  const { routeFamilyForOpensAs } = loadSharedRoutes();
  const surfaces = [
    ['invoice', 'invoice'], ['receipt', 'document'], ['statement', 'document'], ['coi', 'document'],
    ['w9', 'document'], ['lien-waiver', 'document'], ['subcontract', 'document'], ['warranty', 'document'], ['other', 'document'],
  ];
  assert.equal(surfaces.length, 9);
  for (const [opensAs, family] of surfaces) assert.equal(routeFamilyForOpensAs(opensAs === 'subcontract' || opensAs === 'warranty' ? 'other' : opensAs), family);
  const customMappings = [['invoice', 'invoice'], ['receipt', 'document'], ['other', 'document'], ['custom-panel', 'document'], [null, 'document']];
  for (const [opensAs, family] of customMappings) assert.equal(routeFamilyForOpensAs(opensAs), family);
});

test('invoice and document route families expose identical collaboration envelopes', async () => {
  const { registerCollaborationRoutes, dependencies } = loadSharedRoutes();
  const routers = ['invoice', 'document'].map((family) => { const router = express.Router(); registerCollaborationRoutes(router, family, dependencies); return router; });
  for (const [method, path, options] of ENDPOINTS) {
    const responses = await Promise.all(routers.map((router) => routeRequest(router, method, path, options)));
    assert.deepEqual(responses[0].body, responses[1].body, `${method.toUpperCase()} ${path} envelope differs`);
    assert.equal(responses[0].statusCode, responses[1].statusCode);
  }
});

test('all collaboration aliases deny unauthorized callers before any service side effect', async () => {
  const { registerCollaborationRoutes, dependencies } = loadSharedRoutes();
  const router = express.Router(); registerCollaborationRoutes(router, 'document', dependencies);
  calls.length = 0;
  for (const [method, path, options] of ENDPOINTS) assert.equal((await routeRequest(router, method, path, { ...options, allowed: false })).statusCode, 403);
  assert.deepEqual(calls, []);
});

test('missing and deleted documents remain 404 through both aliases', async () => {
  const { registerCollaborationRoutes, dependencies } = loadSharedRoutes();
  const routers = ['invoice', 'document'].map((family) => { const router = express.Router(); registerCollaborationRoutes(router, family, dependencies); return router; });
  missing = true;
  try {
    for (const router of routers) {
      for (const [method, path, options] of ENDPOINTS.slice(0, 3)) assert.equal((await routeRequest(router, method, path, options)).statusCode, 404);
    }
  } finally { missing = false; }
});

test('invoice registration keeps existing workflow route families while adding only shared aliases', () => {
  const invoices = fs.readFileSync(require.resolve('../../modules/invoices/routes/invoices'), 'utf8');
  const documents = fs.readFileSync(require.resolve('../../modules/invoices/routes/documents'), 'utf8');
  assert.match(invoices, /registerCollaborationRoutes\(router, 'invoice'\)/);
  assert.match(documents, /registerCollaborationRoutes\(router, 'document'\)/);
  for (const route of ["router.get('/',", "router.get('/:id',", "router.post('/:id/approve'", "router.post('/:id/file'", "router.delete('/:id'"]) assert.match(invoices, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
