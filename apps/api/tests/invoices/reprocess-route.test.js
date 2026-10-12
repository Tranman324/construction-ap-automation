'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return await fn(); } finally { Module._load = originalLoad; }
}

function freshRequire(relativePath) {
  const resolved = require.resolve(path.join(root, relativePath));
  delete require.cache[resolved];
  return require(resolved);
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function loadReprocessService(row, { fileExists = true } = {}) {
  const queries = [];
  const legacyAudits = [];
  const auditEvents = [];
  const spawns = [];
  const fsCalls = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: row ? [row] : [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const fakeFs = {
    existsSync(target) {
      fsCalls.push(['exists', target]);
      return target === row?.file_path ? fileExists : false;
    },
    mkdirSync(target, options) { fsCalls.push(['mkdir', target, options]); },
    openSync(target, flags) { fsCalls.push(['open', target, flags]); return 43; },
    closeSync(fd) { fsCalls.push(['close', fd]); },
  };
  const child = { unref() { spawns.push({ unref: true }); } };

  return withMockedModules({
    fs: fakeFs,
    child_process: {
      spawn(command, args, options) {
        spawns.push({ command, args, options });
        return child;
      },
    },
    './supabase': {
      pool,
      audit: async (...args) => legacyAudits.push(args),
      rowToDoc: (document) => document,
    },
    '../../../lib/auditEvents': {
      getRequestAuditActor: (req) => ({ name: req.user?.email || 'system', role: req.user?.role || 'user' }),
      emitInvoiceAuditEvent: async (req, _res, event) => auditEvents.push({ ...event, actor: req.user?.email || 'system' }),
    },
    '../../../middleware/errorResponse': {
      fail: (res, status, error) => res.status(status).json({ error }),
      safeError: (res, error) => res.status(500).json({ error: error.message }),
    },
    '../../../lib/response': {},
    '../../../middleware/permissions': {},
    './statementReconciliation': {},
    './sharepointUndoService': {},
    './statusConstants': {},
    './transaction': {},
    './documentDiscardService': {},
    './junkFilterService': {},
    './filingValueResolver': {},
    './sharepointFilename': {},
  }, async () => {
    const service = freshRequire('modules/invoices/services/invoiceStatusService.js');
    return { service, queries, legacyAudits, auditEvents, spawns, fsCalls };
  });
}

function storedDocument(overrides = {}) {
  return {
    id: 'doc-reprocess',
    classification: 'invoice',
    status: 'pending',
    file_name: 'invoice.pdf',
    file_path: '/stored/invoice.pdf',
    ...overrides,
  };
}

test('reprocess accepts a stored non-error document, attributes request audits, and logs the child', async () => {
  const loaded = await loadReprocessService(storedDocument());
  const res = response();
  await loaded.service.reprocessInvoice({ params: { id: 'doc-reprocess' }, user: { email: 'requester@example.com', role: 'accountant' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, id: 'doc-reprocess', status: 'pending' });
  assert.deepEqual(loaded.legacyAudits, [[
    'doc-reprocess',
    'reprocess_requested',
    { status: 'pending' },
    'requester@example.com',
  ]]);
  assert.equal(loaded.auditEvents.length, 1);
  assert.equal(loaded.auditEvents[0].type, 'document.reprocess_requested');
  assert.equal(loaded.auditEvents[0].actor, 'requester@example.com');
  assert.equal(loaded.auditEvents[0].targetType, 'document');
  assert.equal(loaded.queries.some(({ sql }) => /UPDATE documents/.test(sql)), false);

  const spawn = loaded.spawns.find((entry) => entry.command === 'node');
  assert.ok(spawn);
  assert.match(spawn.args[0], /modules\/invoices\/scripts\/reprocess-errors\.js$/);
  assert.deepEqual(spawn.args.slice(1), ['--id', 'doc-reprocess']);
  assert.match(spawn.options.cwd, /modules\/invoices$/);
  assert.equal(spawn.options.detached, true);
  assert.deepEqual(spawn.options.stdio, ['ignore', 43, 43]);
  assert.ok(loaded.spawns.some((entry) => entry.unref));
  assert.ok(loaded.fsCalls.some(([operation, target, flags]) => operation === 'open' && /logs\/pipeline\.log$/.test(target) && flags === 'a'));
  assert.ok(loaded.fsCalls.some(([operation, fd]) => operation === 'close' && fd === 43));
});

test('reprocess rejects protected statuses before state, audit, or child side effects', async () => {
  for (const status of ['submitted', 'submitting', 'split-processing']) {
    const loaded = await loadReprocessService(storedDocument({ status }));
    const res = response();
    await loaded.service.reprocessInvoice({ params: { id: 'doc-reprocess' }, user: { email: 'requester@example.com' } }, res);

    assert.equal(res.statusCode, 400, status);
    assert.equal(loaded.legacyAudits.length, 0, status);
    assert.equal(loaded.auditEvents.length, 0, status);
    assert.equal(loaded.spawns.length, 0, status);
    assert.equal(loaded.queries.some(({ sql }) => /UPDATE documents/.test(sql)), false, status);
  }
});

test('reprocess rejects absent database or disk files before audit or child spawn', async () => {
  for (const [row, options] of [
    [storedDocument({ file_path: null }), {}],
    [storedDocument(), { fileExists: false }],
  ]) {
    const loaded = await loadReprocessService(row, options);
    const res = response();
    await loaded.service.reprocessInvoice({ params: { id: 'doc-reprocess' }, user: { email: 'requester@example.com' } }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(loaded.legacyAudits.length, 0);
    assert.equal(loaded.auditEvents.length, 0);
    assert.equal(loaded.spawns.length, 0);
    assert.equal(loaded.queries.some(({ sql }) => /UPDATE documents/.test(sql)), false);
  }
});

test('reprocess route has the view-details gate while retry remains error-only and pipeline completion stays pipeline-attributed', () => {
  const routes = fs.readFileSync(path.join(root, 'modules/invoices/routes/invoices.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'modules/invoices/services/invoiceStatusService.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'modules/invoices/scripts/reprocess-errors.js'), 'utf8');

  assert.match(routes, /router\.post\('\/:id\/reprocess', requirePermission\('accounting\.invoices\.view_details'\), validate\(resourceIdParamsSchema, 'params'\), async/);
  assert.match(routes, /router\.post\('\/:id\/retry', requirePermission\('accounting\.invoices\.view_details'\), async/);
  assert.match(service, /async function retryInvoice[\s\S]*Only error items can be retried/);
  assert.match(worker, /\[doc\.id, 'reprocessed', 'pipeline', JSON\.stringify/);
  // Reprocessed docs drop to the back of the queue (list orders by queued_at),
  // matching the split-children precedent. True arrival time stays in email_received_at.
  assert.match(worker, /queued_at = NOW\(\),\s*\n\s*updated_at = NOW\(\)/);
});
