'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const { canonicalizeErrorBody, errorBody } = require('../../lib/response');
const { fail, failFromBody } = require('../../middleware/errorResponse');
const { DEFAULT_LIMIT, MAX_LIMIT, getPagination } = require('../../lib/pagination');
const {
  featureRequestsQuerySchema,
  invoiceListQuerySchema,
  invoiceStatsQuerySchema,
  invoiceTrashQuerySchema,
  paginationQuerySchema,
  splitQueueQuerySchema,
  waiverPanelQuerySchema,
} = require('../../lib/schemas');
const { validate } = require('../../middleware/validate');
const { assertCanonicalErrorBody } = require('../helpers/assertCanonicalErrorResponse');

const root = path.resolve(__dirname, '..', '..');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

async function withMockedModule(relativePath, mocks, work) {
  const resolved = require.resolve(path.join(root, relativePath));
  const originalLoad = Module._load;
  delete require.cache[resolved];
  Module._load = function load(request, parent, isMain) {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await work(require(resolved));
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolved];
  }
}

function makeRes(method = 'GET') {
  return {
    req: { method },
    statusCode: 200,
    body: undefined,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

function makeHeadRes() {
  return {
    ...makeRes('HEAD'),
    req: { method: 'HEAD', log: { error() {} } },
  };
}

function queryValidationResult(schema, query) {
  const req = {
    query,
    originalUrl: '/api/test',
    log: { warn() {} },
  };
  const res = makeRes();
  let nextCalled = false;
  validate(schema, 'query')(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

function routeHandler(router, routePath) {
  const route = router.stack.find((layer) => layer.route?.path === routePath);
  assert.ok(route, `expected route ${routePath}`);
  return route.route.stack.at(-1).handle;
}

test('errorBody preserves a top-level machine-readable code and nests metadata', () => {
  assert.deepEqual(errorBody('State changed', 'STATE_CHANGED', { actionId: 'a-1' }), {
    error: 'State changed',
    code: 'STATE_CHANGED',
    details: { actionId: 'a-1' },
  });
  assert.deepEqual(canonicalizeErrorBody({
    error: 'State changed',
    code: 'STATE_CHANGED',
    actionId: 'a-1',
    staleFields: ['status'],
  }), {
    error: 'State changed',
    code: 'STATE_CHANGED',
    details: { actionId: 'a-1', staleFields: ['status'] },
  });
});

test('shared responders and legacy outcome conversion obey the canonical runtime shape', () => {
  const direct = makeRes();
  fail(direct, 409, 'Request conflict', { actionId: 'a-1' });
  assertCanonicalErrorBody(direct.body);
  assert.deepEqual(direct.body, { error: 'Request conflict', details: { actionId: 'a-1' } });

  const legacyCode = makeRes();
  fail(legacyCode, 409, 'Request conflict', { code: 'STATE_CHANGED', actionId: 'a-1' });
  assertCanonicalErrorBody(legacyCode.body);
  assert.deepEqual(legacyCode.body, {
    error: 'Request conflict',
    code: 'STATE_CHANGED',
    details: { actionId: 'a-1' },
  });

  const outcome = makeRes();
  failFromBody(outcome, 409, {
    error: 'Request conflict',
    code: 'STATE_CHANGED',
    actionId: 'a-1',
  });
  assertCanonicalErrorBody(outcome.body);
  assert.deepEqual(outcome.body, {
    error: 'Request conflict',
    code: 'STATE_CHANGED',
    details: { actionId: 'a-1' },
  });

  const head = makeRes('HEAD');
  fail(head, 404, 'Document not found');
  assert.equal(head.ended, true);
  assert.equal(head.body, undefined);
});

test('the four transaction outcome helpers canonicalize their constructed errors', () => {
  const services = [
    'modules/invoices/services/invoiceApprovalService.js',
    'modules/invoices/services/invoiceStatusService.js',
    'modules/invoices/services/invoiceEditService.js',
  ];
  for (const service of services) {
    assert.match(source(service), /canonicalizeErrorBody/);
    assert.match(source(service), /function (?:makeJsonResponse|sendJsonOutcome)/);
  }
  assert.match(source('modules/invoices/services/bulkActionService.js'), /\{ fail, safeError \}/);
});

test('pagination defaults invalid values and clamps safe integer bounds', () => {
  assert.deepEqual(getPagination({}), { limit: DEFAULT_LIMIT, offset: 0 });
  assert.deepEqual(getPagination({ limit: '999', offset: '-5' }), { limit: MAX_LIMIT, offset: 0 });
  assert.deepEqual(getPagination({ limit: '0', offset: '12' }), { limit: 1, offset: 12 });
  assert.deepEqual(getPagination({ limit: '1.5', offset: 'abc' }), { limit: DEFAULT_LIMIT, offset: 0 });
});

test('new strict list-query boundaries reject unknown, invalid, and out-of-range pagination inputs', () => {
  const cases = [
    [featureRequestsQuerySchema, { category: 'unknown' }],
    [featureRequestsQuerySchema, { status: 'blocked' }],
    [featureRequestsQuerySchema, { limit: '201' }],
    [splitQueueQuerySchema, { sort: 'sql' }],
    [splitQueueQuerySchema, { sortDir: 'sideways' }],
    [splitQueueQuerySchema, { offset: '-1' }],
    [paginationQuerySchema, { unexpected: 'value' }],
    [waiverPanelQuerySchema, { search: 'x'.repeat(201) }],
    [invoiceListQuerySchema, { unexpected: 'value' }],
    [invoiceListQuerySchema, { limit: '201' }],
    [invoiceStatsQuerySchema, { limit: '50' }],
    [invoiceTrashQuerySchema, { offset: '-1' }],
  ];
  for (const [schema, query] of cases) {
    const result = queryValidationResult(schema, query);
    assert.equal(result.nextCalled, false, JSON.stringify(query));
    assert.equal(result.res.statusCode, 400, JSON.stringify(query));
    assertCanonicalErrorBody(result.res.body);
  }

  assert.deepEqual(featureRequestsQuerySchema.parse({}), { status: 'open', limit: 50, offset: 0 });
  assert.deepEqual(splitQueueQuerySchema.parse({}), { sort: 'received', sortDir: 'desc', limit: 50, offset: 0 });
  assert.equal(Object.hasOwn(invoiceListQuerySchema.parse({ page: '2' }), 'offset'), false);
  assert.match(source('modules/feature-requests/routes.js'), /router\.get\('\/', validate\(featureRequestsQuerySchema, 'query'\)/);
  assert.match(source('modules/invoices/routes/splits.js'), /router\.get\('\/queue', requirePermission\('accounting\.invoices\.manage_splits'\), validate\(splitQueueQuerySchema, 'query'\)/);
});

test('bounded list reads bind pagination before their external query', () => {
  const routeSources = [
    'modules/invoices/services/invoiceCollectionService.js',
    'modules/invoices/services/lienWaiverQueryService.js',
    'modules/invoices/services/rulesService.js',
    'modules/invoices/services/settingsService.js',
    'modules/invoices/services/splitService.js',
    'services/adminUserService.js',
    'services/permissionService.js',
    'services/roleService.js',
    'services/titleRuleService.js',
  ].map(source).join('\n');

  assert.match(routeSources, /getPagination\(req\.query\)/);
  assert.match(routeSources, /LIMIT \$1 OFFSET \$2/);
  assert.match(routeSources, /\.range\(offset, offset \+ limit - 1\)/);
  assert.match(source('modules/invoices/services/spectrum.js'), /OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY/);
});

test('pipeline errors bind default, clamped, and offset pagination with deterministic ties', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{
          id: 'pipeline-error-1', email_message_id: 'email-1', email_subject: 'Invoice',
          email_from: 'vendor@example.com', error_message: 'parse failed', error_stage: 'extract',
          retry_count: 1, max_retries: 3, resolved: false,
          created_at: new Date('2026-07-16T00:00:00.000Z'), last_retry_at: null,
        }, {
          id: 'pipeline-error-0', email_message_id: 'email-0', email_subject: 'Earlier stable tie',
          email_from: 'vendor@example.com', error_message: 'parse failed', error_stage: 'extract',
          retry_count: 1, max_retries: 3, resolved: false,
          created_at: new Date('2026-07-16T00:00:00.000Z'), last_retry_at: null,
        }],
      };
    },
  };

  await withMockedModule('modules/invoices/routes/pipeline.js', {
    '../services/pipelineErrorService': { listPipelineErrors: async ({ resolved, limit, offset }) => (await pool.query(`SELECT * FROM pipeline_errors ${resolved === 'all' ? '' : `WHERE resolved = ${resolved === 'true'}`} ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`, [limit, offset])).rows, resolvePipelineError: async () => {}, retryPipelineError: async () => {} },
    '../services/utils': { readJSON: () => ({}) },
    '../../../config': { PIPELINE_STATUS_PATH: '/tmp/pipeline-status.json' },
    '../../../middleware/permissions': { requirePermission: () => (_req, _res, next) => next() },
    '../../../middleware/validate': { validate: () => (_req, _res, next) => next() },
    '../../../lib/schemas': { pipelineErrorResolveSchema: {}, pipelineErrorsQuerySchema: {}, resourceIdParamsSchema: {} },
  }, async (router) => {
    const errorsRoute = router.stack.find((layer) => layer.route?.path === '/errors');
    const handler = errorsRoute.route.stack.at(-1).handle;

    for (const [query, expectedParams] of [
      [{}, [50, 0]],
      [{ limit: '999', offset: '-2' }, [200, 0]],
      [{ limit: '25', offset: '75' }, [25, 75]],
    ]) {
      const res = makeRes();
      await handler({ query }, res);
      assert.deepEqual(calls.at(-1).params, expectedParams);
      assert.match(calls.at(-1).sql, /LIMIT \$1 OFFSET \$2/);
      assert.match(calls.at(-1).sql, /ORDER BY created_at DESC, id DESC/);
      assert.deepEqual(res.body.map((row) => row.id), ['pipeline-error-1', 'pipeline-error-0']);
    }
  });
});

test('rules, feature requests, and split queue keep tied rows disjoint across offset pages', async () => {
  const makeRule = (id) => ({
    id, user_id: 'user-1', name: id, is_active: true, rule_order: 0,
    stop_on_match: false, shared: false, criteria: [], actions: [],
    created_at: new Date('2026-07-16T00:00:00.000Z'), updated_at: new Date('2026-07-16T00:00:00.000Z'),
  });
  const rulePages = { 0: [makeRule('rule-a'), makeRule('rule-b')], 2: [makeRule('rule-c'), makeRule('rule-d')] };
  const ruleCalls = [];
  const rulePool = { query: async (sql, params = []) => {
    ruleCalls.push({ sql, params });
    return { rows: rulePages[params.at(-1)] || [] };
  } };
  await withMockedModule('modules/invoices/routes/rules.js', {
    '../services/rulesService': { listRules: async ({ limit, offset }) => (await rulePool.query('SELECT * FROM rules ORDER BY rule_order ASC, created_at ASC, id ASC LIMIT $1 OFFSET $2', [limit, offset])).rows },
    '../scripts/rules-engine': { buildPatchUpdate: () => ({}), evaluateBatch: () => [] },
  }, async (router) => {
    const handler = routeHandler(router, '/');
    const first = makeRes(); const second = makeRes();
    await handler({ query: { limit: 2, offset: 0 } }, first);
    await handler({ query: { limit: 2, offset: 2 } }, second);
    assert.deepEqual(first.body.rules.map((row) => row.id), ['rule-a', 'rule-b']);
    assert.deepEqual(second.body.rules.map((row) => row.id), ['rule-c', 'rule-d']);
  });
  for (const call of ruleCalls) assert.match(call.sql, /ORDER BY rule_order ASC, created_at ASC, id ASC/);

  const makeRequest = (id) => ({
    id, title: id, description: 'desc', category: 'workflow', status: 'open', author_name: 'A', author_email: 'a@example.com',
    must_have_votes: 1, nice_to_have_votes: 0, total_votes: 1, current_user_vote: null, voters: [],
    created_at: new Date('2026-07-16T00:00:00.000Z'), updated_at: new Date('2026-07-16T00:00:00.000Z'),
  });
  const requestPages = { 0: [makeRequest('request-d'), makeRequest('request-c')], 2: [makeRequest('request-b'), makeRequest('request-a')] };
  const featureCalls = [];
  await withMockedModule('modules/feature-requests/routes.js', {
    './featureRequestService': { listFeatureRequests: async ({ limit, offset }) => {
      const sql = 'SELECT * FROM feature_requests ORDER BY total_votes DESC, fr.created_at DESC, fr.id DESC LIMIT $1 OFFSET $2';
      const params = [limit, offset];
      featureCalls.push({ sql, params });
      return requestPages[offset] || [];
    } },
    '../invoices/routes/users': { getAvatarUrlByEmail: () => null },
    '../../lib/requestLog': { logRequestError() {} },
  }, async (router) => {
    const handler = routeHandler(router, '/');
    const first = makeRes(); const second = makeRes();
    await handler({ query: { status: 'open', limit: 2, offset: 0 }, user: { email: 'user@example.com' } }, first);
    await handler({ query: { status: 'open', limit: 2, offset: 2 }, user: { email: 'user@example.com' } }, second);
    assert.deepEqual(first.body.requests.map((row) => row.id), ['request-d', 'request-c']);
    assert.deepEqual(second.body.requests.map((row) => row.id), ['request-b', 'request-a']);
  });
  for (const call of featureCalls) assert.match(call.sql, /ORDER BY total_votes DESC, fr\.created_at DESC, fr\.id DESC/);

  const splitPages = {
    0: [{ id: 'split-d', status: 'needs-split', file_name: 'd.pdf', split_suggestion: { pageCount: 2 }, queued_at: new Date('2026-07-16T00:00:00.000Z') }, { id: 'split-c', status: 'needs-split', file_name: 'c.pdf', split_suggestion: { pageCount: 2 }, queued_at: new Date('2026-07-16T00:00:00.000Z') }],
    2: [{ id: 'split-b', status: 'needs-split', file_name: 'b.pdf', split_suggestion: { pageCount: 2 }, queued_at: new Date('2026-07-16T00:00:00.000Z') }, { id: 'split-a', status: 'needs-split', file_name: 'a.pdf', split_suggestion: { pageCount: 2 }, queued_at: new Date('2026-07-16T00:00:00.000Z') }],
  };
  const splitCalls = [];
  const splitPool = { query: async (sql, params = []) => {
    splitCalls.push({ sql, params });
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ count: '4' }] };
    return { rows: splitPages[params.at(-1)] || [] };
  } };
  await withMockedModule('modules/invoices/routes/splits.js', {
    '../services/splitService': { listSplitQueue: async ({ sort, sortDir, limit, offset }) => {
      const direction = sortDir === 'asc' ? 'ASC' : 'DESC';
      const orderBy = sort === 'pages'
        ? `COALESCE((split_suggestion->>'pageCount')::int, 0) ${direction}, id ${direction}`
        : sort === 'vendor'
          ? `email_from ${direction} NULLS LAST, id ${direction}`
          : `queued_at ${direction}, id ${direction}`;
      const count = await splitPool.query("SELECT COUNT(*) FROM documents WHERE status = 'needs-split'");
      const data = await splitPool.query(`SELECT * FROM documents WHERE status = 'needs-split' ORDER BY ${orderBy} LIMIT $1 OFFSET $2`, [limit, offset]);
      return { total: parseInt(count.rows[0].count, 10), rows: data.rows };
    } },
    '../services/pdf-split': { getPageCount() {}, extractPages() {}, renderPageThumbnail() {}, renderAllPages() {}, validateSplitLayout() {} },
    '../../../config': { DATA_DIR: '/tmp' },
    '../../../lib/requestLog': { getRequestLogger: () => ({ warn() {} }) },
    '../../../lib/auditEvents': { emitInvoiceAuditEvent: async () => null },
    './settings': { getActiveClassificationNames: async () => new Set() },
  }, async (router) => {
    const handler = routeHandler(router, '/queue');
    const first = makeRes(); const second = makeRes();
    await handler({ query: { sort: 'received', sortDir: 'desc', limit: 2, offset: 0 } }, first);
    await handler({ query: { sort: 'received', sortDir: 'desc', limit: 2, offset: 2 } }, second);
    assert.deepEqual(first.body.items.map((row) => row.id), ['split-d', 'split-c']);
    assert.deepEqual(second.body.items.map((row) => row.id), ['split-b', 'split-a']);
  });
  for (const call of splitCalls.filter((call) => /ORDER BY/.test(call.sql))) assert.match(call.sql, /ORDER BY queued_at DESC, id DESC/);
});

test('cached vendor and subcontract lists sort a stable key before slicing offset pages', async () => {
  const vendorRows = [
    { Name: 'Acme', Vendor_Code: 'B' }, { Name: 'Acme', Vendor_Code: 'D' },
    { Name: 'Acme', Vendor_Code: 'A' }, { Name: 'Acme', Vendor_Code: 'C' },
  ];
  await withMockedModule('modules/invoices/routes/vendors.js', {
    '../services/utils': { readJSON: () => vendorRows, writeJSON() {} },
    '../services/spectrum': { spectrumState: { running: false } },
    '../../../config': { VENDORS_PATH: '/tmp/vendors.json', SPECTRUM_REFRESH_PATH: '/tmp/refresh.json' },
  }, async (router) => {
    const handler = routeHandler(router, '/');
    const first = makeRes(); const second = makeRes();
    await handler({ query: { search: '', limit: 2, offset: 0 } }, first);
    await handler({ query: { search: '', limit: 2, offset: 2 } }, second);
    assert.deepEqual(first.body.map((row) => row.code), ['A', 'B']);
    assert.deepEqual(second.body.map((row) => row.code), ['C', 'D']);
  });

  const subcontractRows = [
    { subcontract_number: 'S-2', job: 'J', vendor_code: 'V' }, { subcontract_number: 'S-4', job: 'J', vendor_code: 'V' },
    { subcontract_number: 'S-1', job: 'J', vendor_code: 'V' }, { subcontract_number: 'S-3', job: 'J', vendor_code: 'V' },
  ];
  await withMockedModule('modules/invoices/routes/subcontracts.js', {
    '../services/utils': { readJSON: () => subcontractRows },
    '../../../config': { SUBCONTRACTS_PATH: '/tmp/subcontracts.json' },
  }, async (router) => {
    const handler = routeHandler(router, '/');
    const first = makeRes(); const second = makeRes();
    await handler({ query: { vendorCode: '', jobNumber: '', limit: 2, offset: 0 } }, first);
    await handler({ query: { vendorCode: '', jobNumber: '', limit: 2, offset: 2 } }, second);
    assert.deepEqual(first.body.map((row) => row.subcontractNumber), ['S-1', 'S-2']);
    assert.deepEqual(second.body.map((row) => row.subcontractNumber), ['S-3', 'S-4']);
  });
});

test('cached settings slices apply a structural tie-breaker before offset pagination', async () => {
  await withMockedModule('modules/invoices/routes/settings.js', {
    '../services/settingsService': { query: async () => ({ rows: [] }) },
    '../services/spectrum': { getGlAccounts: async () => [] },
    '../services/utils': { readJSON: () => null },
    '../../../config': { ROUTING_CODES_PATH: '/tmp/routing.json', PHASE_CODES_PATH: '/tmp/phase.json' },
    '../services/approvalValidator': { getApprovalSchema: () => ({}), validateApproval: () => ({}) },
    '../services/matching': { getSubcontractsMap: () => ({}) },
    '../../../lib/auditEvents': { emitPlatformAuditEvent: async () => null },
  }, async ({ stableCachedSlice }) => {
    const rows = [
      { code: 'same', label: 'delta', nested: { rank: 4 } },
      { code: 'same', label: 'bravo', nested: { rank: 2 } },
      { code: 'same', label: 'charlie', nested: { rank: 3 } },
      { code: 'same', label: 'alpha', nested: { rank: 1 } },
    ];
    const firstPermutation = [rows[0], rows[2], rows[1], rows[3]];
    const secondPermutation = [...firstPermutation].reverse();
    const firstPage = stableCachedSlice(firstPermutation, 0, 2, ['code']);
    const secondPage = stableCachedSlice(firstPermutation, 2, 2, ['code']);

    assert.deepEqual(stableCachedSlice(secondPermutation, 0, 2, ['code']), firstPage);
    assert.deepEqual(stableCachedSlice(secondPermutation, 2, 2, ['code']), secondPage);
    assert.deepEqual(firstPage.map((row) => row.label), ['alpha', 'bravo']);
    assert.deepEqual(secondPage.map((row) => row.label), ['charlie', 'delta']);
    assert.equal(new Set([...firstPage, ...secondPage].map((row) => row.label)).size, 4);
  });
});

test('audit events use id as the final tie-breaker across equal timestamp pages', async () => {
  const tiedTimestamp = new Date('2026-07-16T00:00:00.000Z');
  const rows = ['event-d', 'event-c', 'event-b', 'event-a'].map((id) => ({
    id,
    type: 'invoice.approved',
    timestamp: tiedTimestamp,
    created_at: tiedTimestamp,
    actor_user_id: null,
    actor_name: 'Tester',
    actor_role: null,
    target_type: 'invoice',
    target_id: 'invoice-1',
    target_label: null,
    changes: null,
    before_state: null,
    after_state: null,
    undoable: false,
    undone_at: null,
    undone_by: null,
    summary: 'Approved',
    module: 'invoices',
    severity: 'info',
  }));
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/COUNT\(\*\)::int/.test(sql)) return { rows: [{ total: 4 }] };
      return { rows: rows.slice(params.at(-1), params.at(-1) + params.at(-2)) };
    },
  };

  await withMockedModule('lib/auditEvents.js', { './db': pool }, async ({ listAuditEvents }) => {
    const firstPage = await listAuditEvents({ page: 1, limit: 2 });
    const secondPage = await listAuditEvents({ page: 2, limit: 2 });
    assert.deepEqual(firstPage.events.map((event) => event.id), ['event-d', 'event-c']);
    assert.deepEqual(secondPage.events.map((event) => event.id), ['event-b', 'event-a']);
    assert.equal(new Set([...firstPage.events, ...secondPage.events].map((event) => event.id)).size, 4);
  });
  for (const call of calls.filter((call) => /FROM audit_events/.test(call.sql) && /ORDER BY/.test(call.sql))) {
    assert.match(call.sql, /ORDER BY timestamp DESC, created_at DESC, id DESC/);
  }
});

test('Spectrum GL account pagination orders tied account codes by stable secondary fields', async () => {
  const queries = [];
  const request = {
    input() { return this; },
    async query(sql) {
      queries.push(sql);
      return {
        recordset: [
          { GL_Account: '5000', Cost_Type: 'S', Account_Type_Code: 'E', Description: 'Zeta', Status: 'A' },
          { GL_Account: '5000', Cost_Type: 'L', Account_Type_Code: 'E', Description: 'Alpha', Status: 'A' },
        ],
      };
    },
  };
  await withMockedModule('modules/invoices/services/spectrum.js', {
    fs: {
      readFileSync(file) {
        return file === '/tmp/spectrum-config.json'
          ? JSON.stringify({ sql: { passwordFile: '/tmp/spectrum-password' } })
          : 'test-password';
      },
    },
    mssql: { Int: 'Int', VarChar: 'VarChar', connect: async () => ({ request: () => request }) },
    '../../../config': {
      SPECTRUM_REST_PASS: '', SPECTRUM_REST_URL: '', SPECTRUM_REST_USER: '',
      SPECTRUM_SQL_CONFIG_PATH: '/tmp/spectrum-config.json',
    },
    '../../../lib/logger': { warn() {}, error() {} },
  }, async ({ getGlAccounts }) => {
    const accounts = await getGlAccounts({ limit: 2, offset: 2 });
    assert.deepEqual(accounts.map((account) => account.code), ['5000', '5000']);
  });
  assert.match(queries[0], /ORDER BY GL_Account, Cost_Type, Account_Type_Code, Description/);
  assert.match(queries[0], /OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY/);
});

test('every paginated A7b list source has a final stable ordering key before offset or slice', () => {
  const expectations = [
    ['modules/invoices/services/invoiceCollectionService.js', /queued_at \$\{dir\}, id \$\{dir\}/],
    ['modules/invoices/services/invoiceCollectionService.js', /COALESCE\(deleted_at, discarded_at, updated_at\) DESC, id DESC/],
    ['modules/invoices/services/invoiceFileService.js', /ORDER BY timestamp DESC, created_at DESC, id DESC/],
    ['modules/invoices/services/unifiedActionService.js', /ORDER BY timestamp DESC, created_at DESC, id DESC/],
    ['modules/invoices/services/linkedDocumentsService.js', /ORDER BY queued_at ASC, id ASC/],
    ['modules/invoices/services/lienWaiverQueryService.js', /ORDER BY queued_at DESC, id DESC/],
    ['modules/invoices/services/rulesService.js', /ORDER BY rule_order ASC, created_at ASC, id ASC/],
    ['modules/invoices/services/ignoreRuleService.js', /ORDER BY created_at DESC, id DESC/],
    ['modules/invoices/services/settingsService.js', /ORDER BY added_at, name/],
    ['modules/invoices/services/settingsService.js', /ORDER BY classification, status, id/],
    ['modules/invoices/routes/settings.js', /stableCacheValue\(left\)/],
    ['modules/invoices/services/splitService.js', /queued_at \$\{direction\}, id \$\{direction\}/],
    ['modules/invoices/routes/vendors.js', /\.sort\(compareVendors\)/],
    ['modules/invoices/routes/subcontracts.js', /subcontractNumber.*job.*vendorCode/s],
    ['modules/invoices/routes/users.js', /a\.name\.localeCompare\(b\.name\) \|\| a\.id\.localeCompare\(b\.id\)/],
    ['modules/invoices/routes/jobs.js', /return a\.number\.localeCompare\(b\.number\)/],
    ['modules/feature-requests/featureRequestService.js', /ORDER BY total_votes DESC, fr\.created_at DESC, fr\.id DESC/],
    ['services/adminUserService.js', /\.order\('name', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)/s],
    ['services/titleRuleService.js', /\.order\('created_at', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)/s],
    ['services/roleService.js', /\.order\('name', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)/s],
    ['services/permissionService.js', /\.order\('module', \{ ascending: true \}\)\.order\('key', \{ ascending: true \}\)/s],
    ['lib/auditEvents.js', /ORDER BY timestamp DESC, created_at DESC, id DESC/],
    ['modules/invoices/services/spectrum.js', /ORDER BY GL_Account, Cost_Type, Account_Type_Code, Description\s+OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY/],
  ];
  for (const [file, pattern] of expectations) assert.match(source(file), pattern, file);
});

test('HEAD file errors use the shared canonical responder without a body', async () => {
  let databaseThrows = false;
  const pool = {
    async query() {
      if (databaseThrows) throw new Error('database unavailable');
      return { rows: [] };
    },
  };
  const fileServiceSource = source('modules/invoices/services/invoiceFileService.js');

  await withMockedModule('modules/invoices/services/invoiceFileService.js', {
    fs: { existsSync: () => false },
    '/etc/toolbox/paths.js': { BOX_SCRIPT: '/tmp/box.js' },
    './pdf': { ensurePdf: async () => null },
    './supabase': { pool },
  }, async ({ headInvoiceFile }) => {
    const missing = makeHeadRes();
    await headInvoiceFile({ params: { id: 'missing' } }, missing);
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.ended, true);
    assert.equal(missing.body, undefined);

    databaseThrows = true;
    const failed = makeHeadRes();
    await headInvoiceFile({ params: { id: 'database-error' } }, failed);
    assert.equal(failed.statusCode, 500);
    assert.equal(failed.ended, true);
    assert.equal(failed.body, undefined);
  });

  assert.match(fileServiceSource, /return fail\(res, 404, 'Invoice not found'\)/);
  assert.match(fileServiceSource, /return safeError\(res, err, 'HEAD \/api\/invoices\/:id\/file'\)/);
  assert.doesNotMatch(fileServiceSource, /res\.status\((?:404|500)\)\.end\(\)/);
});
