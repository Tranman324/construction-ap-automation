'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const EMAIL_TEMPLATE = fs.readFileSync(path.join(root, 'templates', 'lien-waiver-request.html'), 'utf-8');
// Outbound waiver emails carry a reply-correlation ref tag (subject) and body token.
const { stampSubjectRefTag, buildBodyToken } = require(path.join(root, 'modules', 'invoices', 'services', 'refTag'));

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function freshRequire(relativePath) {
  const resolvedPath = require.resolve(path.join(root, relativePath));
  delete require.cache[resolvedPath];
  return require(resolvedPath);
}

function makeDoc(overrides = {}) {
  return {
    id: 'doc-1',
    email_message_id: 'graph-msg-1',
    email_from: 'billing@vendor.example',
    email_subject: 'Invoice 100',
    vendor_name: 'Vendor Co',
    vendor_code: 'VC1',
    job_match_number: 'J-1',
    waiver_requested_at: null,
    classification: 'invoice',
    ...overrides,
  };
}

// Mock Graph at the graphFetch boundary; records every call and routes by URL.
function makeGraph(replyBehavior) {
  const calls = [];
  async function graphFetch(url, opts = {}) {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (/\/createReply$/.test(url)) {
      if (replyBehavior === '404') throw new Error('Graph 404 Not Found: The specified object was not found in the store.');
      if (replyBehavior === '500') throw new Error('Graph 500 Internal Server Error: transient');
      return { id: 'reply-draft-1', conversationId: 'reply-thread-1', body: { content: '<div>-- quoted original thread --</div>' } };
    }
    if (/\/messages$/.test(url) && opts.method === 'POST') return { id: 'fresh-msg-1', conversationId: 'fresh-thread-1' }; // createMessage
    if (/\/send$/.test(url)) return null;
    return null; // PATCH / DELETE
  }
  return { graphFetch, calls };
}

function makePool(doc) {
  const clientCalls = [];
  let committedDocument = doc ? { ...doc } : null;
  return {
    clientCalls,
    async query(sql) {
      if (/FROM documents WHERE id = \$1/.test(sql)) return { rows: doc ? [doc] : [] };
      return { rows: [] };
    },
    async connect() {
      return {
        query: async (sql, params) => {
          clientCalls.push({ sql, params });
          if (/UPDATE documents\s+SET waiver_requested_at/.test(sql)) {
            committedDocument = {
              ...committedDocument,
              waiver_requested_at: new Date('2026-08-03T12:00:00.000Z'),
              waiver_requested_by: params[1],
              waiver_request_conversation_id: params[2],
            };
            return { rows: [committedDocument] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
}

function runWaiver({ graphFetch, pool }, docId, opts) {
  return withMockedModules({
    '../../../lib/graph': { graphFetch },
    './supabase': { pool, audit: async () => {} },
    '../../../lib/auditEvents': { emitInvoiceAuditEvent: async () => ({ id: 'evt-1' }) },
  }, async () => {
    const { requestWaiver } = freshRequire('modules/invoices/services/waiverRequestService.js');
    return requestWaiver(docId, { email: 'clerk@northwindcg.example' }, opts);
  });
}

function loadRequestWaiverRoute({ requestWaiver, rowToDoc, getWaiverActionSerializationOptions }) {
  const routePath = path.join(root, 'modules', 'invoices', 'routes', 'invoices.js');
  const dbPath = path.join(root, 'lib', 'db.js');
  const supabasePath = path.join(root, 'modules', 'invoices', 'services', 'supabase.js');
  const requestServicePath = path.join(root, 'modules', 'invoices', 'services', 'waiverRequestService.js');
  const registrations = [];
  const router = {};
  for (const method of ['get', 'post', 'delete', 'patch', 'put', 'head']) {
    router[method] = (route, ...handlers) => registrations.push({ method, route, handlers });
  }
  const previousRoute = require.cache[routePath];
  const previousDb = require.cache[dbPath];
  const previousSupabase = require.cache[supabasePath];
  const previousRequestService = require.cache[requestServicePath];
  delete require.cache[routePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: Object.assign(async () => {}, { query: async () => ({ rows: [] }), on() {}, supabase: {} }),
  };
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: { rowToDoc, getWaiverActionSerializationOptions },
  };
  require.cache[requestServicePath] = {
    id: requestServicePath,
    filename: requestServicePath,
    loaded: true,
    exports: { requestWaiver },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === routePath && request === 'express') return { Router: () => router };
    if (parent?.filename === routePath && request === '../../../middleware/permissions') {
      return { checkPermission: () => true, requirePermission: () => (_req, _res, next) => next() };
    }
    if (parent?.filename === routePath && request === '../../../middleware/validate') {
      return { validate: () => (_req, _res, next) => next() };
    }
    if (parent?.filename === routePath && request === '../../../middleware/errorResponse') {
      return { fail: () => undefined, safeError: (res, err) => res.status(500).json({ error: err.message }) };
    }
    if (parent?.filename === routePath && request === '../../../lib/schemas') return {};
    if (parent?.filename === routePath && request === '../services/supabase') {
      return { rowToDoc, getWaiverActionSerializationOptions };
    }
    if (parent?.filename === routePath && request.startsWith('../services/')) {
      return new Proxy({}, { get: (_target, key) => key === 'ACTION_PERMISSIONS' ? {} : async () => undefined });
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    require(routePath);
    return {
      requestRoute: registrations.find((entry) => entry.method === 'post' && entry.route === '/:id/request-waiver'),
      cleanup() {
        delete require.cache[routePath];
        if (previousRoute) require.cache[routePath] = previousRoute;
        if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
        if (previousSupabase) require.cache[supabasePath] = previousSupabase; else delete require.cache[supabasePath];
        if (previousRequestService) require.cache[requestServicePath] = previousRequestService; else delete require.cache[requestServicePath];
      },
    };
  } finally {
    Module._load = originalLoad;
  }
}

async function invoke(handlers, req, res) {
  let index = 0;
  const next = () => {
    const handler = handlers[index++];
    return handler ? handler(req, res, next) : undefined;
  };
  await next();
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('fresh-email fallback: a 404 on createReply sends a fresh templated message to the resolved recipient', async () => {
  const doc = makeDoc();
  const graph = makeGraph('404');
  const pool = makePool(doc);

  const result = await runWaiver({ graphFetch: graph.graphFetch, pool }, 'doc-1', {
    recipientOverride: 'vendor@vendor.example',
  });

  // Not a 500 — a successful send.
  assert.equal(result.success, true);
  assert.equal(result.sentTo, 'vendor@vendor.example');
  assert.equal(result.invoiceRow.waiver_requested_by, 'clerk@northwindcg.example');
  assert.equal(result.invoiceRow.waiver_request_conversation_id, 'fresh-thread-1');

  // createMessage FIRED with the resolved recipient and the exact template body.
  const createMsg = graph.calls.find((c) => /\/messages$/.test(c.url) && c.method === 'POST');
  assert.ok(createMsg, 'createMessage was called');
  assert.equal(createMsg.body.toRecipients[0].emailAddress.address, 'vendor@vendor.example');
  assert.equal(createMsg.body.body.content, EMAIL_TEMPLATE + buildBodyToken('doc-1'));
  assert.equal(createMsg.body.subject, stampSubjectRefTag('Invoice 100 — Lien Waiver Request', 'doc-1')); // no RE: prefix
  assert.match(createMsg.body.subject, /^Invoice 100 — Lien Waiver Request \[Ref:/);
  assert.ok(graph.calls.find((c) => /\/send$/.test(c.url)), 'fresh message was sent');
  // The document row was still recorded (waiver_requested_at update happened).
  assert.ok(pool.clientCalls.find((c) => /UPDATE documents/.test(c.sql)));
  const update = pool.clientCalls.find((c) => /UPDATE documents/.test(c.sql));
  assert.equal(update.params[2], 'fresh-thread-1');
});

test('request-waiver route serializes the committed invoice with caller-aware waiver actions', async () => {
  const invoiceRow = {
    id: 'doc-route',
    classification: 'invoice',
    email_message_id: 'source-message',
    waiver_requested_at: new Date('2026-08-03T12:00:00.000Z'),
  };
  let serializationOptions = null;
  const loaded = loadRequestWaiverRoute({
    requestWaiver: async () => ({
      success: true,
      sentTo: 'vendor@example.com',
      requestedAt: '2026-08-03T12:00:00.000Z',
      invoiceRow,
    }),
    getWaiverActionSerializationOptions: (req) => ({
      includeWaiverActions: true,
      canRequestWaiver: req.user.permissions.includes('accounting.invoices.request_waiver'),
      canApproveWaiver: req.user.permissions.includes('accounting.invoices.approve'),
    }),
    rowToDoc: (row, options) => {
      serializationOptions = options;
      return {
        id: row.id,
        waiverActions: {
          request: { permitted: false, blockers: [{ code: 'WAIVER_REQUEST_ALREADY_SENT' }] },
          resend: { permitted: true, blockers: [] },
        },
      };
    },
  });
  const req = {
    params: { id: invoiceRow.id },
    body: {},
    user: { permissions: ['accounting.invoices.request_waiver'] },
  };
  const res = makeResponse();
  try {
    assert.ok(loaded.requestRoute, 'the request-waiver route must be registered');
    await invoke(loaded.requestRoute.handlers, req, res);
  } finally {
    loaded.cleanup();
  }

  assert.equal(res.statusCode, 200, res.body?.error);
  assert.ok(res.body.invoice, 'successful request response includes a canonical invoice');
  assert.equal(res.body.invoice.id, invoiceRow.id);
  assert.equal(res.body.invoice.waiverActions.resend.permitted, true);
  assert.deepEqual(serializationOptions, {
    includeWaiverActions: true,
    canRequestWaiver: true,
    canApproveWaiver: false,
  });
});

test('happy path unchanged: createReply succeeds → reply flow patches and sends with the quoted chain', async () => {
  const doc = makeDoc();
  const graph = makeGraph('ok');
  const pool = makePool(doc);

  const result = await runWaiver({ graphFetch: graph.graphFetch, pool }, 'doc-1', {
    recipientOverride: 'vendor@vendor.example',
  });

  assert.equal(result.success, true);
  const patch = graph.calls.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'reply draft was patched');
  assert.equal(patch.body.subject, stampSubjectRefTag('RE: Invoice 100 — Lien Waiver Request', 'doc-1'));
  assert.match(patch.body.subject, /^RE: Invoice 100 — Lien Waiver Request \[Ref:/);
  // Template (+ ref body token) prepended above the preserved quoted chain.
  assert.ok(patch.body.body.content.startsWith(EMAIL_TEMPLATE + buildBodyToken('doc-1')));
  assert.match(patch.body.body.content, /quoted original thread/);
  assert.ok(graph.calls.find((c) => /\/send$/.test(c.url)), 'reply was sent');
  // No fresh message on the happy path.
  assert.equal(graph.calls.filter((c) => /\/messages$/.test(c.url) && c.method === 'POST').length, 0);
  const update = pool.clientCalls.find((c) => /UPDATE documents/.test(c.sql));
  assert.equal(update.params[2], 'reply-thread-1');
});

test('resend replaces the stored request conversation with the new reply conversation in the durable record and audit', async () => {
  const doc = makeDoc({
    waiver_requested_at: '2026-08-01T12:00:00.000Z',
    waiver_request_conversation_id: 'previous-request-thread',
  });
  const graph = makeGraph('ok');
  const pool = makePool(doc);

  const result = await runWaiver({ graphFetch: graph.graphFetch, pool }, 'doc-1', {
    recipientOverride: 'vendor@vendor.example',
    resend: true,
  });

  assert.equal(result.success, true);
  const update = pool.clientCalls.find((c) => /UPDATE documents/.test(c.sql));
  assert.ok(update, 'request record was updated');
  assert.equal(update.params[2], 'reply-thread-1');
  assert.notEqual(update.params[2], doc.waiver_request_conversation_id);

  const auditInsert = pool.clientCalls.find((c) => /INSERT INTO audit_log/.test(c.sql));
  assert.ok(auditInsert, 'request audit was recorded');
  const changes = JSON.parse(auditInsert.params[3]);
  assert.equal(changes.resend, true);
  assert.equal(changes.requestConversationId, 'reply-thread-1');
  assert.notEqual(changes.requestConversationId, doc.waiver_request_conversation_id);
});

test('missing email_message_id still returns 422 with no Graph calls', async () => {
  const doc = makeDoc({ email_message_id: null });
  const graph = makeGraph('ok');
  const pool = makePool(doc);

  await assert.rejects(
    () => runWaiver({ graphFetch: graph.graphFetch, pool }, 'doc-1', { recipientOverride: 'vendor@vendor.example' }),
    (err) => err.statusCode === 422,
  );
  assert.equal(graph.calls.length, 0);
});

test('a non-404 Graph error on createReply still propagates (no silent fallback)', async () => {
  const doc = makeDoc();
  const graph = makeGraph('500');
  const pool = makePool(doc);

  await assert.rejects(
    () => runWaiver({ graphFetch: graph.graphFetch, pool }, 'doc-1', { recipientOverride: 'vendor@vendor.example' }),
    /Graph 500/,
  );
  // The fallback must NOT fire for a non-404 error.
  assert.equal(graph.calls.filter((c) => /\/messages$/.test(c.url) && c.method === 'POST').length, 0);
});
