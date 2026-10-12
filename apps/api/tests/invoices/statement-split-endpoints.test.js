'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

const { statementLineCreateSchema } = require('../../lib/schemas');
const { fail, failFromBody } = require('../../middleware/errorResponse');
const { assertCanonicalErrorBody } = require('../helpers/assertCanonicalErrorResponse');
const { getStatementReconcileState } = require('../../modules/invoices/services/statementReconciliation');

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function freshRequire(relativePath) {
  const resolved = require.resolve(path.join(root, relativePath));
  delete require.cache[resolved];
  return require(resolved);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    locals: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      if (this.statusCode >= 400) assertCanonicalErrorBody(body);
      this.body = body;
      return this;
    },
  };
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return JSON.parse(value);
}

function rowToDoc(row, options = {}) {
  const statementReconcile = options.includeStatementReconcile
    ? getStatementReconcileState(row, options)
    : null;
  const statementLines = statementReconcile?.statementLines || parseJsonArray(row.statement_lines);
  return {
    id: row.id,
    classification: row.classification,
    statementLines,
    extracted: { statementLines },
    filed: Boolean(row.filed),
    filedAt: toIsoString(row.filed_at),
    reconciled: Boolean(row.reconciled),
    reconciledAt: toIsoString(row.reconciled_at),
    ...(statementReconcile ? {
      reconcile: {
        blockers: statementReconcile.blockers,
        counts: statementReconcile.counts,
        canReconcile: statementReconcile.canReconcile,
        permittedActions: statementReconcile.permittedActions,
      },
    } : {}),
  };
}

function makeAuditEvents(action, calls) {
  const auditEvents = {
    checkStateMatch: () => ({ match: true, staleFields: [] }),
    findUndoableAction: async () => action,
    getRequestAuditActor: (req) => ({
      userId: req.headers?.['x-user-id'] || req.headers?.['x-user-email'] || 'system',
      name: req.headers?.['x-user-email'] || 'system',
      role: req.headers?.['x-user-role'] || null,
    }),
    insertAuditEvent: async () => null,
    markActionUndone: async (id, actor) => calls.markUndone.push({ id, actor }),
  };
  auditEvents.emitInvoiceAuditEvent = async (req, res, event) => {
    calls.auditEvents.push({
      ...event,
      actor: auditEvents.getRequestAuditActor(req, res),
    });
    return { id: `event-${calls.auditEvents.length}` };
  };
  return auditEvents;
}

test('statementLineCreateSchema validates the manual line request shape', () => {
  assert.equal(statementLineCreateSchema.safeParse({
    invoiceNumber: '7552',
    date: '2026-05-06',
    amount: '32590.00',
  }).success, true);
  assert.equal(statementLineCreateSchema.safeParse({
    invoiceNumber: '7552',
    date: null,
    amount: 32590,
  }).success, true);

  assert.equal(statementLineCreateSchema.safeParse({ date: '2026-05-06', amount: 32590 }).success, false);
  assert.equal(statementLineCreateSchema.safeParse({ invoiceNumber: '7552', amount: 32590 }).success, false);
  assert.equal(statementLineCreateSchema.safeParse({ invoiceNumber: '7552', date: '2026-02-30', amount: 32590 }).success, false);
  assert.equal(statementLineCreateSchema.safeParse({ invoiceNumber: '7552', date: '2026-05-06', amount: 'Infinity' }).success, false);
  assert.equal(statementLineCreateSchema.safeParse({ invoiceNumber: '7552', date: '2026-05-06', amount: '' }).success, false);
  assert.equal(statementLineCreateSchema.safeParse({ invoiceNumber: '7552', date: '2026-05-06', amount: null }).success, false);
});

test('addStatementLine appends a non-colliding manual line and emits actor audits', async () => {
  const calls = {
    auditEvents: [],
    legacyAudit: [],
    markUndone: [],
    updates: [],
  };
  let row = {
    id: 'statement-1',
    classification: 'statement',
    vendor_code: 'LARK01',
    statement_lines: JSON.stringify([
      {
        id: '7552',
        invoiceNumber: '7552',
        date: '2026-05-06',
        amount: 32590,
        status: 'not_received',
        source: 'extracted',
      },
    ]),
  };
  const pool = {
    query: async (sql, params = []) => {
      if (/^SELECT \* FROM documents WHERE id = \$1/.test(sql)) {
        return { rows: [row] };
      }
      if (/UPDATE documents\s+SET statement_lines =/.test(sql)) {
        calls.updates.push({ sql, params });
        row = {
          ...row,
          statement_lines: params[0],
          updated_at: new Date('2026-07-02T22:00:00Z'),
        };
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const req = {
    params: { id: 'statement-1' },
    body: { invoiceNumber: '7552', date: '2026-05-06', amount: 32590 },
    headers: { 'x-user-email': 'worker@example.com', 'x-user-id': 'user-1' },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': {
      pool,
      audit: async (id, event, changes, actor) => calls.legacyAudit.push({ id, event, changes, actor }),
      rowToDoc,
    },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      safeError(response, err) {
        return response.status(500).json({ error: err.message });
      },
    },
  }, async () => {
    const { addStatementLine } = freshRequire('modules/invoices/services/statementLineService.js');
    await addStatementLine(req, res, {
      lookups: {
        findToolboxInvoice: async (input) => ({
          invoiceNumber: input.invoiceNumber,
          vendorCode: input.vendorCode,
          amount: input.amount,
        }),
        findSpectrumInvoice: async (input) => ({
          invoiceNumber: input.invoiceNumber,
          vendorCode: input.vendorCode,
          amount: input.amount,
        }),
      },
    });
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.updates.length, 1);
  assert.equal(res.body.addedLine.id, '7552-2');
  assert.equal(res.body.addedLine.source, 'manual');
  assert.equal(res.body.addedLine.status, 'matched');
  assert.equal(res.body.statementLines.length, 2);
  assert.deepEqual(calls.legacyAudit.map((entry) => [entry.event, entry.actor]), [
    ['statement-line-added', 'worker@example.com'],
  ]);
  assert.deepEqual(calls.auditEvents.map((entry) => [entry.type, entry.actor.name, entry.targetType]), [
    ['document.statement_line_added', 'worker@example.com', 'document'],
  ]);
});

test('reconciling a statement shelves it locally without SharePoint state', async () => {
  const calls = {
    auditEvents: [],
    markUndone: [],
    updates: [],
  };
  let row = {
    id: 'statement-1',
    classification: 'statement',
    file_name: 'statement.pdf',
    statement_lines: [{ id: 'line-1', status: 'matched' }],
    reconciled: false,
    reconciled_at: null,
    filed: false,
    filed_at: null,
    needs_review: true,
  };
  const pool = {
    query: async (sql, params = []) => {
      if (/^SELECT \* FROM documents WHERE id = \$1/.test(sql)) {
        return { rows: [row] };
      }
      if (/UPDATE documents\s+SET reconciled = true/.test(sql)) {
        calls.updates.push({ sql, params });
        row = {
          ...row,
          reconciled: true,
          reconciled_at: new Date('2026-07-02T22:10:00Z'),
          filed: true,
          filed_at: new Date('2026-07-02T22:10:00Z'),
        };
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const req = {
    params: { id: 'statement-1' },
    headers: { 'x-user-email': 'worker@example.com', 'x-user-id': 'user-1' },
    user: { permissions: ['accounting.invoices.approve'] },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': { pool, audit: async () => {}, rowToDoc },
    './sharepointUndoService': { deleteFiledSharePointCopy: async () => assert.fail('SharePoint delete must not run') },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      safeError(response, err) {
        return response.status(500).json({ error: err.message });
      },
    },
  }, async () => {
    const { reconcileInvoice } = freshRequire('modules/invoices/services/invoiceStatusService.js');
    await reconcileInvoice(req, res);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice.reconciled, true);
  assert.equal(res.body.invoice.filed, true);
  assert.equal(res.body.invoice.statementLines[0].clear, true);
  assert.equal(res.body.invoice.reconcile.canReconcile, true);
  assert.deepEqual(res.body.invoice.reconcile.permittedActions, []);
  assert.equal(calls.updates.length, 1);
  assert.doesNotMatch(calls.updates[0].sql, /sharepoint|sp_file_url|sharepoint_item_id/i);
  assert.deepEqual(calls.auditEvents[0].beforeState, {
    reconciled: false,
    reconciled_at: null,
    filed: false,
    filed_at: null,
  });
  assert.equal(calls.auditEvents[0].afterState.filed, true);
  assert.deepEqual(calls.auditEvents[0].changes.filed, [false, true]);
});

test('review action keeps the legacy statement invoice shape', async () => {
  let row = {
    id: 'statement-review',
    classification: 'statement',
    status: 'pending',
    statement_lines: [{ id: 'ready', status: 'matched' }],
  };
  const calls = { auditEvents: [], markUndone: [] };
  const pool = {
    query: async (sql) => {
      if (/^SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row] };
      if (/UPDATE documents SET status = \$1/.test(sql)) {
        row = { ...row, status: 'reviewed', reviewed_at: new Date('2026-07-30T00:00:00Z') };
        return { rows: [] };
      }
      return { rows: [row] };
    },
  };
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool, audit: async () => {}, rowToDoc },
    './sharepointUndoService': { deleteFiledSharePointCopy: async () => {} },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': { safeError: (response, err) => response.status(500).json({ error: err.message }) },
  }, async () => {
    const { reviewInvoice } = freshRequire('modules/invoices/services/invoiceStatusService.js');
    await reviewInvoice({ params: { id: row.id }, headers: {} }, res);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice.reconcile, undefined);
  assert.equal(res.body.invoice.statementLines[0].clear, undefined);
});

test('reconcile and unreconcile compose every successful envelope through the canonical helper', () => {
  const source = read('modules/invoices/services/invoiceStatusService.js');

  assert.match(source, /function canonicalReconcileEnvelope\(/);
  assert.equal((source.match(/makeJsonResponse\(canonicalReconcileEnvelope\(req, row\)\)/g) || []).length, 2);
  assert.match(source, /return res\.json\(canonicalReconcileEnvelope\(req, row, event, type, undoEndpoint, reason\)\);/);
});

test('unreconciling a statement restores the reconcile shelf fields from the action', async () => {
  const action = {
    id: 'act-reconcile-1',
    afterState: {
      reconciled: true,
      reconciled_at: '2026-07-02T22:10:00.000Z',
      filed: true,
      filed_at: '2026-07-02T22:10:00.000Z',
      needs_review: false,
    },
    beforeState: {
      reconciled: false,
      reconciled_at: null,
      filed: false,
      filed_at: null,
      needs_review: true,
    },
  };
  const calls = {
    auditEvents: [],
    markUndone: [],
    updates: [],
  };
  let row = {
    id: 'statement-1',
    classification: 'statement',
    file_name: 'statement.pdf',
    statement_lines: [{ id: 'line-1', status: 'matched' }],
    reconciled: true,
    reconciled_at: new Date('2026-07-02T22:10:00Z'),
    filed: true,
    filed_at: new Date('2026-07-02T22:10:00Z'),
    needs_review: false,
  };
  const pool = {
    query: async (sql, params = []) => {
      if (/^SELECT \* FROM documents WHERE id = \$1/.test(sql)) {
        return { rows: [row] };
      }
      if (/UPDATE documents\s+SET reconciled = \$1/.test(sql)) {
        calls.updates.push({ sql, params });
        row = {
          ...row,
          reconciled: params[0],
          reconciled_at: params[1],
          filed: params[2],
          filed_at: params[3],
        };
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const req = {
    params: { id: 'statement-1' },
    headers: { 'x-user-email': 'worker@example.com', 'x-user-id': 'user-1' },
    user: { permissions: ['accounting.invoices.approve'] },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': { pool, audit: async () => {}, rowToDoc },
    './sharepointUndoService': { deleteFiledSharePointCopy: async () => assert.fail('SharePoint delete must not run') },
    '../../../lib/auditEvents': makeAuditEvents(action, calls),
    '../../../middleware/errorResponse': {
      safeError(response, err) {
        return response.status(500).json({ error: err.message });
      },
    },
  }, async () => {
    const { unreconcileInvoice } = freshRequire('modules/invoices/services/invoiceStatusService.js');
    await unreconcileInvoice(req, res);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice.reconciled, false);
  assert.equal(res.body.invoice.filed, false);
  assert.equal(res.body.invoice.statementLines[0].clear, true);
  assert.equal(res.body.invoice.reconcile.canReconcile, true);
  assert.deepEqual(res.body.invoice.reconcile.permittedActions, ['reconcile']);
  assert.deepEqual(calls.updates[0].params, [false, null, false, null, 'statement-1']);
  assert.deepEqual(calls.markUndone, [{ id: 'act-reconcile-1', actor: 'worker@example.com' }]);
  assert.deepEqual(calls.auditEvents[0].changes.filed, [true, false]);
});

test('reconciling a statement rejects unresolved lines without changing shelf state', async () => {
  const calls = { auditEvents: [], markUndone: [], updates: [] };
  const row = {
    id: 'statement-open',
    classification: 'statement',
    statement_lines: [{ id: 'open-line', status: 'not_received' }],
    reconciled: false,
    filed: false,
  };
  const pool = {
    query: async (sql) => {
      if (/^SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row] };
      calls.updates.push(sql);
      return { rows: [] };
    },
  };
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool, audit: async () => {}, rowToDoc },
    './sharepointUndoService': { deleteFiledSharePointCopy: async () => {} },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      fail,
      failFromBody,
      safeError: (response, err) => response.status(500).json({ error: err.message }),
    },
  }, async () => {
    const { reconcileInvoice } = freshRequire('modules/invoices/services/invoiceStatusService.js');
    await reconcileInvoice({ params: { id: row.id }, headers: {} }, res);
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'STATEMENT_LINES_UNRESOLVED');
  assert.deepEqual(res.body.details.unresolvedLineIds, ['open-line']);
  assert.equal(calls.updates.length, 0);
});

test('statement detail serves caller-aware reconciliation state from canonical serialization', async () => {
  const row = makeStatementRow([
    { id: 'matched', status: 'matched' },
    { id: 'open', status: 'not_received' },
  ]);
  const pool = { query: async () => ({ rows: [row] }) };
  const mocks = {
    './supabase': {
      pool,
      rowToDoc,
      getVendorBypassCounts: async () => ({}),
      getWaiverActionSerializationOptions: () => ({ includeWaiverActions: true, canRequestWaiver: false, canApproveWaiver: false }),
    },
    '../../../middleware/errorResponse': { fail, safeError: (response, err) => response.status(500).json({ error: err.message }) },
    '../../../lib/pagination': { getPagination: () => ({ limit: 50, offset: 0 }) },
    './coiComplianceService': { evaluateCoiCompliance: () => ({}) },
  };

  const permitted = makeRes();
  await withMockedModules(mocks, async () => {
    const { getInvoice } = freshRequire('modules/invoices/services/invoiceCollectionService.js');
    await getInvoice({
      params: { id: row.id },
      query: {},
      user: { permissions: ['accounting.invoices.approve'] },
    }, permitted);
  });
  assert.equal(permitted.body.statementLines[0].clear, true);
  assert.equal(permitted.body.statementLines[1].clear, false);
  assert.deepEqual(permitted.body.reconcile.counts, { total: 2, clear: 1, unresolved: 1 });
  assert.equal(permitted.body.reconcile.canReconcile, false);
  assert.deepEqual(permitted.body.reconcile.permittedActions, []);

  const clearRow = makeStatementRow([{ id: 'ready', status: 'matched' }]);
  pool.query = async () => ({ rows: [clearRow] });
  const allowed = makeRes();
  await withMockedModules(mocks, async () => {
    const { getInvoice } = freshRequire('modules/invoices/services/invoiceCollectionService.js');
    await getInvoice({
      params: { id: clearRow.id },
      query: {},
      user: { permissions: ['accounting.invoices.approve'] },
    }, allowed);
  });
  assert.equal(allowed.body.reconcile.canReconcile, true);
  assert.deepEqual(allowed.body.reconcile.permittedActions, ['reconcile']);

  const denied = makeRes();
  await withMockedModules(mocks, async () => {
    const { getInvoice } = freshRequire('modules/invoices/services/invoiceCollectionService.js');
    await getInvoice({ params: { id: clearRow.id }, query: {}, user: { permissions: [] } }, denied);
  });
  assert.equal(denied.body.reconcile.canReconcile, true);
  assert.deepEqual(denied.body.reconcile.permittedActions, []);
});

test('split doc types accept active custom classifications and reject inactive names', async () => {
  await withMockedModules({
    '../services/splitService': {
      cancelSplit: async () => {},
      confirmSplit: async () => ({}),
      getSplitChildStatus: async () => null,
      getSplitDocument: async () => null,
      getSplitSourceDocument: async () => null,
      listSplitQueue: async () => ({ rows: [], total: 0 }),
      rejectSplit: async () => {},
      saveSplitSuggestion: async () => {},
    },
    '../services/pdf-split': {
      getPageCount: () => 1,
      extractPages: () => {},
      renderPageThumbnail: () => {},
      renderAllPages: () => {},
      validateSplitLayout: () => ({ valid: true }),
    },
    '../../../config': { DATA_DIR: '/tmp/toolbox-tests', FILES_DIR: '/tmp/toolbox-tests' },
    '../../../lib/auditEvents': { emitInvoiceAuditEvent: async () => null },
    '../../../lib/requestLog': { getRequestLogger: () => ({ warn() {}, error() {} }) },
    '../../../middleware/permissions': { requirePermission: () => (req, res, next) => next() },
    '../../../middleware/validate': { validate: () => (req, res, next) => next() },
    '../../../middleware/errorResponse': { safeError: (res, err) => res.status(500).json({ error: err.message }) },
    './settings': { getActiveClassificationNames: async () => new Set() },
  }, async () => {
    const { validateSplitDocTypes } = freshRequire('modules/invoices/routes/splits.js');
    const activeTypes = new Set(['invoice', 'receipt', 'building-permit', 'change-order']);

    assert.equal(validateSplitDocTypes([
      { docType: 'invoice' },
      { docType: 'building-permit' },
      { docType: 'change-order' },
    ], activeTypes), null);
    assert.equal(validateSplitDocTypes([{ pages: [1] }], activeTypes), null);
    assert.equal(
      validateSplitDocTypes([{ docType: 'warranty' }], activeTypes),
      'Group 1 has invalid docType: warranty'
    );
  });
});

test('split source keeps child queue timestamps and invoice queue received ordering', () => {
  const splitsSource = read('modules/invoices/services/splitService.js');
  const splitsRoute = read('modules/invoices/routes/splits.js');
  const collectionSource = read('modules/invoices/services/invoiceCollectionService.js');

  assert.match(splitsRoute, /getActiveClassificationNames/);
  assert.doesNotMatch(splitsSource, /validDocTypes = new Set/);
  assert.match(splitsSource, /queued_at,\s*updated_at,\s*created_at/);
  assert.match(splitsSource, /NOW\(\), NOW\(\), NOW\(\)/);
  assert.match(collectionSource, /case 'received': return `queued_at \$\{dir\}, id \$\{dir\}`;/);
});

// ─── PATCH/DELETE statement line endpoints ──────────────────────────────────

function makeStatementRow(lines) {
  return {
    id: 'statement-1',
    classification: 'statement',
    vendor_code: 'LARK01',
    statement_lines: JSON.stringify(lines),
  };
}

function makeStatementPool(rowRef, calls) {
  return {
    query: async (sql, params = []) => {
      if (/^SELECT \* FROM documents WHERE id = \$1/.test(sql)) {
        return { rows: [rowRef.row] };
      }
      if (/UPDATE documents\s+SET statement_lines =/.test(sql)) {
        calls.updates.push({ sql, params });
        rowRef.row = { ...rowRef.row, statement_lines: params[0] };
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test('resolve and unresolve statement lines persist canonical resolution metadata', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = { row: makeStatementRow([
    { id: '45195', invoiceNumber: '45195', date: null, amount: 757.02, status: 'not_received', source: 'extracted' },
  ]) };
  const mocks = {
    './supabase': {
      pool: makeStatementPool(rowRef, calls),
      audit: async (id, event, changes, actor) => calls.legacyAudit.push({ id, event, changes, actor }),
      rowToDoc,
    },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      fail,
      failFromBody,
      safeError: (response, err) => response.status(500).json({ error: err.message }),
    },
  };

  const resolved = makeRes();
  await withMockedModules(mocks, async () => {
    const { resolveStatementLine } = freshRequire('modules/invoices/services/statementLineService.js');
    await resolveStatementLine({
      params: { id: 'statement-1', lineId: '45195' },
      body: { resolutionType: 'accept_line' },
      headers: { 'x-user-email': 'worker@example.com' },
    }, resolved);
  });
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.body.updatedLine.resolutionType, 'accept_line');
  assert.equal(resolved.body.updatedLine.resolvedBy, 'worker@example.com');
  assert.ok(resolved.body.updatedLine.resolvedAt);
  assert.equal(resolved.body.invoice.statementLines[0].clear, true);
  assert.equal(resolved.body.invoice.reconcile.canReconcile, true);

  const reopened = makeRes();
  await withMockedModules(mocks, async () => {
    const { unresolveStatementLine } = freshRequire('modules/invoices/services/statementLineService.js');
    await unresolveStatementLine({
      params: { id: 'statement-1', lineId: '45195' },
      body: {},
      headers: { 'x-user-email': 'worker@example.com' },
    }, reopened);
  });
  assert.equal(reopened.statusCode, 200);
  assert.equal(reopened.body.updatedLine.resolvedAt, undefined);
  assert.equal(reopened.body.invoice.statementLines[0].clear, false);
  assert.equal(reopened.body.invoice.reconcile.canReconcile, false);
  assert.deepEqual(calls.auditEvents.map((event) => event.type), [
    'document.statement_line_resolved',
    'document.statement_line_unresolved',
  ]);
});

const noMatchLookups = {
  findToolboxInvoice: async () => null,
  findSpectrumInvoice: async () => null,
};

test('updateStatementLine edits invoice number, re-matches, and audits before/after', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = {
    row: makeStatementRow([
      { id: '518168', invoiceNumber: '518168', date: '2026-06-03', amount: 2261.81, status: 'not_received', source: 'extracted' },
      { id: '519537', invoiceNumber: '519537', date: '2026-06-15', amount: 267.95, status: 'not_received', source: 'extracted' },
    ]),
  };
  const req = {
    params: { id: 'statement-1', lineId: '518168' },
    body: { invoiceNumber: '518169' },
    headers: { 'x-user-email': 'worker@example.com' },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': {
      pool: makeStatementPool(rowRef, calls),
      audit: async (id, event, changes, actor) => calls.legacyAudit.push({ id, event, changes, actor }),
      rowToDoc,
    },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      fail,
      failFromBody,
      safeError(response, err) { return response.status(500).json({ error: err.message }); },
    },
  }, async () => {
    const { updateStatementLine } = freshRequire('modules/invoices/services/statementLineService.js');
    await updateStatementLine(req, res, { lookups: noMatchLookups });
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.updates.length, 1);
  assert.equal(res.body.updatedLine.invoiceNumber, '518169');
  assert.equal(res.body.updatedLine.id, '518168'); // stable line id
  assert.equal(res.body.statementLines.length, 2);
  assert.equal(res.body.statementLines[1].invoiceNumber, '519537'); // untouched sibling
  assert.deepEqual(calls.legacyAudit.map((e) => [e.event, e.actor]), [
    ['statement-line-edited', 'worker@example.com'],
  ]);
  assert.deepEqual(calls.legacyAudit[0].changes.invoiceNumber, ['518168', '518169']);
  assert.deepEqual(calls.auditEvents.map((e) => e.type), ['document.statement_line_edited']);
});

test('updateStatementLine rejects protected (matched) lines with 409', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = {
    row: makeStatementRow([
      { id: '7552', invoiceNumber: '7552', date: '2026-05-06', amount: 32590, status: 'matched', source: 'extracted' },
    ]),
  };
  const req = {
    params: { id: 'statement-1', lineId: '7552' },
    body: { invoiceNumber: '9999' },
    headers: { 'x-user-email': 'worker@example.com' },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': {
      pool: makeStatementPool(rowRef, calls),
      audit: async () => {},
      rowToDoc,
    },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      fail,
      failFromBody,
      safeError(response, err) { return response.status(500).json({ error: err.message }); },
    },
  }, async () => {
    const { updateStatementLine } = freshRequire('modules/invoices/services/statementLineService.js');
    await updateStatementLine(req, res, { lookups: noMatchLookups });
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'LINE_STATUS_PROTECTED');
  assert.equal(calls.updates.length, 0);
});

test('deleteStatementLine removes an unprotected line and audits it', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = {
    row: makeStatementRow([
      { id: '45195', invoiceNumber: '45195', date: '2025-11-10', amount: 757.02, status: 'not_received', source: 'extracted' },
      { id: '45200', invoiceNumber: '45200', date: '2026-01-05', amount: 100, status: 'not_received', source: 'manual' },
    ]),
  };
  const req = {
    params: { id: 'statement-1', lineId: '45195' },
    body: {},
    headers: { 'x-user-email': 'worker@example.com' },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': {
      pool: makeStatementPool(rowRef, calls),
      audit: async (id, event, changes, actor) => calls.legacyAudit.push({ id, event, changes, actor }),
      rowToDoc,
    },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      safeError(response, err) { return response.status(500).json({ error: err.message }); },
    },
  }, async () => {
    const { deleteStatementLine } = freshRequire('modules/invoices/services/statementLineService.js');
    await deleteStatementLine(req, res);
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.updates.length, 1);
  assert.equal(res.body.removedLine.id, '45195');
  assert.equal(res.body.statementLines.length, 1);
  assert.equal(res.body.statementLines[0].id, '45200');
  assert.deepEqual(calls.legacyAudit.map((e) => [e.event, e.actor]), [
    ['statement-line-removed', 'worker@example.com'],
  ]);
  assert.deepEqual(calls.auditEvents.map((e) => e.type), ['document.statement_line_removed']);
});

test('deleteStatementLine returns 404 for unknown line and 409 for protected line', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = {
    row: makeStatementRow([
      { id: '7552', invoiceNumber: '7552', date: '2026-05-06', amount: 32590, status: 'in_toolbox_not_spectrum', source: 'extracted' },
    ]),
  };
  const mocks = {
    './supabase': { pool: makeStatementPool(rowRef, calls), audit: async () => {}, rowToDoc },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      fail,
      failFromBody,
      safeError(response, err) { return response.status(500).json({ error: err.message }); },
    },
  };

  // Unknown line id → 404
  const res404 = makeRes();
  await withMockedModules(mocks, async () => {
    const { deleteStatementLine } = freshRequire('modules/invoices/services/statementLineService.js');
    await deleteStatementLine({ params: { id: 'statement-1', lineId: 'nope' }, body: {}, headers: {} }, res404);
  });
  assert.equal(res404.statusCode, 404);

  // Protected status → 409
  const res409 = makeRes();
  await withMockedModules(mocks, async () => {
    const { deleteStatementLine } = freshRequire('modules/invoices/services/statementLineService.js');
    await deleteStatementLine({ params: { id: 'statement-1', lineId: '7552' }, body: {}, headers: {} }, res409);
  });
  assert.equal(res409.statusCode, 409);
  assert.equal(res409.body.code, 'LINE_STATUS_PROTECTED');
  assert.equal(calls.updates.length, 0);
});

test('statementLineUpdateSchema requires at least one field and rejects extras', () => {
  const { statementLineUpdateSchema } = require('../../lib/schemas');
  assert.equal(statementLineUpdateSchema.safeParse({ invoiceNumber: '7552' }).success, true);
  assert.equal(statementLineUpdateSchema.safeParse({ amount: 100.5 }).success, true);
  assert.equal(statementLineUpdateSchema.safeParse({ date: null }).success, true);
  assert.equal(statementLineUpdateSchema.safeParse({}).success, false);
  assert.equal(statementLineUpdateSchema.safeParse({ status: 'matched' }).success, false); // status not editable
  assert.equal(statementLineUpdateSchema.safeParse({ id: 'x' }).success, false); // id not editable
});

test('rematchStatementLines updates statuses via lookups and audits changes', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = {
    row: makeStatementRow([
      { id: '518168', invoiceNumber: '518168', date: '2026-06-03', amount: 2261.81, status: 'not_received', source: 'extracted' },
      { id: '519537', invoiceNumber: '519537', date: '2026-06-15', amount: 267.95, status: 'not_received', source: 'extracted' },
    ]),
  };
  const req = {
    params: { id: 'statement-1' },
    body: {},
    headers: { 'x-user-email': 'worker@example.com' },
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': {
      pool: makeStatementPool(rowRef, calls),
      audit: async (id, event, changes, actor) => calls.legacyAudit.push({ id, event, changes, actor }),
      rowToDoc,
    },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      safeError(response, err) { return response.status(500).json({ error: err.message }); },
    },
  }, async () => {
    const { rematchStatementLines } = freshRequire('modules/invoices/services/statementLineService.js');
    await rematchStatementLines(req, res, {
      lookups: {
        // 518168 now exists in both Toolbox and Spectrum; 519537 still nowhere.
        findToolboxInvoice: async (input) => input.invoiceNumber === '518168'
          ? { invoiceNumber: '518168', vendorCode: input.vendorCode, amount: 2261.81 }
          : null,
        findSpectrumInvoice: async (input) => input.invoiceNumber === '518168'
          ? { invoiceNumber: '518168', vendorCode: input.vendorCode, amount: 2261.81 }
          : null,
      },
    });
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(res.body.statusChanges, [
    { lineId: '518168', invoiceNumber: '518168', status: ['not_received', 'matched'] },
  ]);
  assert.equal(res.body.statementLines[0].status, 'matched');
  assert.equal(res.body.statementLines[0].id, '518168'); // id stable
  assert.equal(res.body.statementLines[1].status, 'not_received'); // untouched
  assert.deepEqual(calls.legacyAudit.map((e) => [e.event, e.actor]), [
    ['statement-lines-rematched', 'worker@example.com'],
  ]);
});

test('rematchStatementLines is a no-op write when nothing changed', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = {
    row: makeStatementRow([
      { id: '45195', invoiceNumber: '45195', date: '2025-11-10', amount: 757.02, status: 'not_received', source: 'extracted' },
    ]),
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': {
      pool: makeStatementPool(rowRef, calls),
      audit: async (id, event, changes, actor) => calls.legacyAudit.push({ id, event, changes, actor }),
      rowToDoc,
    },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      safeError(response, err) { return response.status(500).json({ error: err.message }); },
    },
  }, async () => {
    const { rematchStatementLines } = freshRequire('modules/invoices/services/statementLineService.js');
    await rematchStatementLines(
      { params: { id: 'statement-1' }, body: {}, headers: {} },
      res,
      { lookups: noMatchLookups }
    );
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.updates.length, 0); // no DB write
  assert.equal(calls.legacyAudit.length, 0); // no audit noise
  assert.deepEqual(res.body.statusChanges, []);
});

test('rematchStatementLinesForDocument re-matches after vendor assignment', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = {
    row: {
      ...makeStatementRow([
        { id: '7552', invoiceNumber: '7552', date: '2026-05-06', amount: 32590, status: 'not_received', source: 'extracted' },
      ]),
      vendor_code: 'LARK01', // vendor just assigned
    },
  };

  let result;
  await withMockedModules({
    './supabase': {
      pool: makeStatementPool(rowRef, calls),
      audit: async () => {},
      rowToDoc,
    },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      safeError(response, err) { return response.status(500).json({ error: err.message }); },
    },
  }, async () => {
    const { rematchStatementLinesForDocument } = freshRequire('modules/invoices/services/statementLineService.js');
    result = await rematchStatementLinesForDocument('statement-1', {
      lookups: {
        findToolboxInvoice: async () => ({ invoiceNumber: '7552', vendorCode: 'LARK01', amount: 32590 }),
        findSpectrumInvoice: async () => ({ invoiceNumber: '7552', vendorCode: 'LARK01', amount: 32590 }),
      },
    });
  });

  assert.deepEqual(result.statusChanges, [
    { lineId: '7552', invoiceNumber: '7552', status: ['not_received', 'matched'] },
  ]);
  assert.equal(result.statementLines[0].status, 'matched');
  assert.equal(calls.updates.length, 1);
});

test('HTTP rematch refuses a vendorless statement after locking and before lookups, writes, or audits', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = {
    row: {
      ...makeStatementRow([{ id: 'line-1', invoiceNumber: '7552', amount: 10, status: 'matched', source: 'extracted' }]),
      vendor_code: null,
    },
  };
  let lookupCalls = 0;
  const res = makeRes();

  await withMockedModules({
    './supabase': {
      pool: makeStatementPool(rowRef, calls),
      audit: async (...args) => calls.legacyAudit.push(args),
      rowToDoc,
    },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      safeError(response, err) { return response.status(500).json({ error: err.message }); },
      failFromBody(response, statusCode, body) { return response.status(statusCode).json(body); },
    },
  }, async () => {
    const { rematchStatementLines } = freshRequire('modules/invoices/services/statementLineService.js');
    await rematchStatementLines(
      { params: { id: 'statement-1' }, body: {}, headers: {} },
      res,
      { lookups: {
        findToolboxInvoice: async () => { lookupCalls += 1; return null; },
        findSpectrumInvoice: async () => { lookupCalls += 1; return null; },
      } }
    );
  });

  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'STATEMENT_VENDOR_REQUIRED');
  assert.equal(lookupCalls, 0);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.legacyAudit.length, 0);
  assert.equal(calls.auditEvents.length, 0);
});

test('internal rematch refuses a vendorless statement without invoking lookups or changing a matched line', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = {
    row: {
      ...makeStatementRow([{ id: 'line-1', invoiceNumber: '7552', amount: 10, status: 'matched', source: 'extracted' }]),
      vendor_code: '   ',
    },
  };
  let lookupCalls = 0;
  let result;

  await withMockedModules({
    './supabase': { pool: makeStatementPool(rowRef, calls), audit: async () => {}, rowToDoc },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
  }, async () => {
    const { rematchStatementLinesForDocument } = freshRequire('modules/invoices/services/statementLineService.js');
    result = await rematchStatementLinesForDocument('statement-1', {
      lookups: {
        findToolboxInvoice: async () => { lookupCalls += 1; return null; },
        findSpectrumInvoice: async () => { lookupCalls += 1; return null; },
      },
    });
  });

  assert.equal(result, null);
  assert.equal(lookupCalls, 0);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.legacyAudit.length, 0);
  assert.equal(calls.auditEvents.length, 0);
});

test('a cross-vendor lookup cannot clear an already matched statement line', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = {
    row: makeStatementRow([{ id: 'line-1', invoiceNumber: '7552', amount: 10, status: 'matched', source: 'extracted' }]),
  };
  const res = makeRes();

  await withMockedModules({
    './supabase': {
      pool: makeStatementPool(rowRef, calls),
      audit: async (...args) => calls.legacyAudit.push(args),
      rowToDoc,
    },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      safeError(response, err) { return response.status(500).json({ error: err.message }); },
    },
  }, async () => {
    const { rematchStatementLines } = freshRequire('modules/invoices/services/statementLineService.js');
    await rematchStatementLines(
      { params: { id: 'statement-1' }, body: {}, headers: {} },
      res,
      { lookups: {
        findToolboxInvoice: async () => ({ invoiceNumber: '7552', vendorCode: 'OTHER01', amount: 10 }),
        findSpectrumInvoice: async () => ({ invoiceNumber: '7552', vendorCode: 'OTHER01', amount: 10 }),
      } }
    );
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.statementLines[0].status, 'matched');
  assert.deepEqual(res.body.statusChanges, []);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.legacyAudit.length, 0);
});

test('HTTP rematch clears a matched line when scoped lookups find no record', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = { row: makeStatementRow([{ id: 'line-1', invoiceNumber: '7552', amount: 10, status: 'matched', source: 'extracted' }]) };
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool: makeStatementPool(rowRef, calls), audit: async (...args) => calls.legacyAudit.push(args), rowToDoc },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': { safeError(response, err) { return response.status(500).json({ error: err.message }); } },
  }, async () => {
    const { rematchStatementLines } = freshRequire('modules/invoices/services/statementLineService.js');
    await rematchStatementLines({ params: { id: 'statement-1' }, body: {}, headers: { 'x-user-email': 'worker@example.com' } }, res, { lookups: noMatchLookups });
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.statementLines[0].status, 'not_received');
  assert.deepEqual(res.body.statusChanges, [{ lineId: 'line-1', invoiceNumber: '7552', status: ['matched', 'not_received'] }]);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.legacyAudit.length, 1);
  assert.equal(calls.auditEvents.length, 1);
});

test('internal rematch clears a matched line when scoped lookups find no record', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const rowRef = { row: makeStatementRow([{ id: 'line-1', invoiceNumber: '7552', amount: 10, status: 'matched', source: 'extracted' }]) };
  let result;
  await withMockedModules({
    './supabase': { pool: makeStatementPool(rowRef, calls), audit: async () => {}, rowToDoc },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
  }, async () => {
    const { rematchStatementLinesForDocument } = freshRequire('modules/invoices/services/statementLineService.js');
    result = await rematchStatementLinesForDocument('statement-1', { lookups: noMatchLookups });
  });
  assert.deepEqual(result.statusChanges, [{ lineId: 'line-1', invoiceNumber: '7552', status: ['matched', 'not_received'] }]);
  assert.equal(result.statementLines[0].status, 'not_received');
  assert.equal(calls.updates.length, 1);
});

test('a matcher failure leaves statement lines, writes, and audits untouched', async () => {
  const calls = { auditEvents: [], legacyAudit: [], markUndone: [], updates: [] };
  const originalLine = { id: 'line-1', invoiceNumber: '7552', amount: 10, status: 'matched', source: 'extracted' };
  const rowRef = { row: makeStatementRow([originalLine]) };
  const res = makeRes();

  await withMockedModules({
    './supabase': {
      pool: makeStatementPool(rowRef, calls),
      audit: async (...args) => calls.legacyAudit.push(args),
      rowToDoc,
    },
    '../../../lib/auditEvents': makeAuditEvents(null, calls),
    '../../../middleware/errorResponse': {
      safeError(response, err) { return response.status(500).json({ error: err.message }); },
      failFromBody(response, statusCode, body) { return response.status(statusCode).json(body); },
    },
  }, async () => {
    const { rematchStatementLines } = freshRequire('modules/invoices/services/statementLineService.js');
    await rematchStatementLines(
      { params: { id: 'statement-1' }, body: {}, headers: {} },
      res,
      { lookups: {
        findToolboxInvoice: async () => { throw new Error('lookup offline'); },
        findSpectrumInvoice: async () => null,
      } }
    );
  });

  assert.equal(res.statusCode, 500);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.legacyAudit.length, 0);
  assert.equal(calls.auditEvents.length, 0);
  assert.deepEqual(parseJsonArray(rowRef.row.statement_lines), [originalLine]);
});
