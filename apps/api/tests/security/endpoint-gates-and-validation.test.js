'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const {
  classificationsQuerySchema,
  glAccountsQuerySchema,
  jobsQuerySchema,
  lienWaiverOrphansQuerySchema,
  orphanCandidatesQuerySchema,
  pipelineErrorsQuerySchema,
  resourceIdParamsSchema,
  sharePointFolderQuerySchema,
  subcontractsQuerySchema,
  vendorsQuerySchema,
} = require('../../lib/schemas');
const { validate } = require('../../middleware/validate');

const root = path.resolve(__dirname, '..', '..');

const ROUTE_FILES = [
  ['modules/invoices/routes/invoices.js', 65, '/api/invoices'],
  ['modules/invoices/routes/vendors.js', 3, '/api/vendors'],
  ['modules/invoices/routes/jobs.js', 3, '/api/jobs'],
  ['modules/invoices/routes/subcontracts.js', 1, '/api/subcontracts'],
  ['modules/invoices/routes/rules.js', 6, '/api/rules'],
  ['modules/invoices/routes/pipeline.js', 7, '/api/pipeline'],
  ['modules/invoices/routes/ignore-rules.js', 3, '/api/ignore-rules'],
  ['modules/invoices/routes/feedback.js', 2, '/api/feedback'],
  ['modules/invoices/routes/lien-waivers.js', 2, '/api/lien-waivers'],
  ['modules/invoices/routes/users.js', 2, '/api/users'],
  ['modules/invoices/routes/splits.js', 9, '/api/splits'],
  ['modules/invoices/routes/document-destinations.js', 4, '/api/document-destinations'],
  ['modules/invoices/routes/coi-config.js', 4, '/api/coi-config'],
  ['modules/invoices/routes/documents.js', 5, '/api/documents'],
  ['modules/invoices/routes/settings.js', 18, '/api'],
  ['modules/feature-requests/routes.js', 6, '/api/feature-requests'],
  ['routes/roles.js', 4, '/api/roles'],
  ['routes/permissions.js', 5, '/api'],
  ['routes/title-rules.js', 5, '/api/title-rules'],
  ['routes/admin-users.js', 2, '/api/admin/users'],
  ['routes/audit-events.js', 2, '/api/audit'],
  ['modules/invoices/routes/health.js', 1, '/api/health'],
];

const ROUTER_WIDE_GATES = new Set([
  'modules/invoices/routes/rules.js',
  'routes/roles.js',
  'routes/permissions.js',
  'routes/title-rules.js',
  'routes/admin-users.js',
]);

const MOUNT_PATTERNS = new Map([
  ['modules/invoices/routes/invoices.js', /app\.use\('\/api\/invoices',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/invoices'\)\)/],
  ['modules/invoices/routes/vendors.js', /app\.use\('\/api\/vendors',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/vendors'\)\)/],
  ['modules/invoices/routes/jobs.js', /app\.use\('\/api\/jobs',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/jobs'\)\)/],
  ['modules/invoices/routes/subcontracts.js', /app\.use\('\/api\/subcontracts',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/subcontracts'\)\)/],
  ['modules/invoices/routes/rules.js', /app\.use\('\/api\/rules',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/rules'\)\)/],
  ['modules/invoices/routes/pipeline.js', /app\.use\('\/api\/pipeline',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/pipeline'\)\)/],
  ['modules/invoices/routes/ignore-rules.js', /app\.use\('\/api\/ignore-rules',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/ignore-rules'\)\)/],
  ['modules/invoices/routes/feedback.js', /app\.use\('\/api\/feedback',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/feedback'\)\)/],
  ['modules/invoices/routes/lien-waivers.js', /app\.use\('\/api\/lien-waivers',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/lien-waivers'\)\)/],
  ['modules/invoices/routes/users.js', /app\.use\('\/api\/users',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/users'\)\)/],
  ['modules/invoices/routes/splits.js', /app\.use\('\/api\/splits',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/splits'\)\)/],
  ['modules/invoices/routes/document-destinations.js', /app\.use\('\/api\/document-destinations',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/document-destinations'\)\)/],
  ['modules/invoices/routes/coi-config.js', /app\.use\('\/api\/coi-config',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/coi-config'\)\)/],
  ['modules/invoices/routes/documents.js', /app\.use\('\/api\/documents',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/invoices\/routes\/documents'\)\)/],
  ['modules/invoices/routes/settings.js', /app\.use\('\/api',\s+requireAuth,\s+methodLimiter,\s+settingsRouter\)/],
  ['modules/feature-requests/routes.js', /app\.use\('\/api\/feature-requests',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/modules\/feature-requests\/routes'\)\)/],
  ['routes/roles.js', /app\.use\('\/api\/roles',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/routes\/roles'\)\)/],
  ['routes/permissions.js', /app\.use\('\/api',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/routes\/permissions'\)\)/],
  ['routes/title-rules.js', /app\.use\('\/api\/title-rules',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/routes\/title-rules'\)\)/],
  ['routes/admin-users.js', /app\.use\('\/api\/admin\/users',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/routes\/admin-users'\)\)/],
  ['routes/audit-events.js', /app\.use\('\/api\/audit',\s+requireAuth,\s+methodLimiter,\s+require\('\.\/routes\/audit-events'\)\)/],
]);

const CUSTOM_GATES = new Map([
  ['modules/invoices/routes/invoices.js:post:/bulk', /requireBulkActionPermission/],
  ['modules/feature-requests/routes.js:patch:/:id', /requireManageForStatusChange/],
  ['modules/feature-requests/routes.js:delete:/:id', /requireFeatureRequestManage/],
]);

const AUTH_ONLY_EXCEPTIONS = new Set([
  // SEC-01: all authenticated invoice users can emit actor-derived audit events.
  'routes/audit-events.js:post:/events',
  // Stage 3 approval: the zero-permission feature-request landing must remain
  // usable by every authenticated Toolbox user. PATCH is still constrained by
  // author ownership and requires feature_requests.manage for status changes.
  'modules/feature-requests/routes.js:get:/',
  'modules/feature-requests/routes.js:post:/',
  'modules/feature-requests/routes.js:post:/:id/vote',
  'modules/feature-requests/routes.js:delete:/:id/vote',
]);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function registrations(source) {
  return [...source.matchAll(/router\.(get|post|put|patch|delete)\(\s*(?:\r?\n\s*)?(['"])([^'"]+)\2/g)]
    .map((match) => ({ method: match[1], path: match[3], index: match.index }));
}

function routeHeader(source, registration) {
  const tail = source.slice(registration.index, registration.index + 500);
  const handlerStart = tail.search(/(?:async\s*)?\(\s*_?req\s*,\s*res\s*\)\s*=>/);
  const directHandlerEnd = tail.indexOf(');');
  const headerEnd = [handlerStart, directHandlerEnd]
    .filter((position) => position >= 0)
    .sort((left, right) => left - right)[0];
  return tail.slice(0, headerEnd === undefined ? tail.length : headerEnd);
}

async function withRouter(relativePath, mocks, fn) {
  const resolved = path.join(root, relativePath);
  const prior = require.cache[require.resolve(resolved)];
  const originalLoad = Module._load;

  delete require.cache[require.resolve(resolved)];
  Module._load = function load(requestName, parent, isMain) {
    if (Object.hasOwn(mocks, requestName)) return mocks[requestName];
    return originalLoad.call(this, requestName, parent, isMain);
  };

  try {
    return await fn(require(resolved));
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(resolved)];
    if (prior) require.cache[require.resolve(resolved)] = prior;
  }
}

function routeStack(router, method, routePath) {
  const layer = router.stack.find((candidate) => candidate.route?.path === routePath && candidate.route.methods[method]);
  assert.ok(layer, `expected ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack;
}

function assertFirstRouteGateDenies(router, method, routePath) {
  const gate = routeStack(router, method, routePath)[0].handle;
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;
  gate({ user: { role: 'viewer', permissions: [] } }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false, `${method.toUpperCase()} ${routePath} must stop before its handler`);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Forbidden' });
}

test('static route inventory covers all 178 registered endpoints and leaves no accidental auth-only endpoint', () => {
  const server = read('server.js');
  let total = 1; // POST /api/users/:id/bump-version in server.js

  for (const [file, expectedCount, mount] of ROUTE_FILES) {
    const source = read(file);
    const routes = registrations(source);
    assert.equal(routes.length, expectedCount, `${file} changed; update this security inventory`);
    total += routes.length;

    if (file === 'modules/invoices/routes/health.js') {
      assert.match(server, /app\.use\('\/api\/health', healthLimiter/);
      continue;
    }

    assert.match(server, MOUNT_PATTERNS.get(file), `${file} must remain mounted behind requireAuth`);

    if (file === 'modules/invoices/routes/pipeline.js') {
      assert.match(
        source,
        /router\.post\('\/run',\s*pipelineLimiter,/,
        'POST /api/pipeline/run must keep its dedicated pipelineLimiter'
      );
    }

    const routerWideGate = ROUTER_WIDE_GATES.has(file);
    if (routerWideGate) {
      assert.match(source, /router\.use\(requirePermission\(/, `${file} must retain its router-wide permission gate`);
    }

    for (const route of routes) {
      const key = `${file}:${route.method}:${route.path}`;
      if (AUTH_ONLY_EXCEPTIONS.has(key) || routerWideGate) continue;

      const header = routeHeader(source, route);
      if (CUSTOM_GATES.has(key)) {
        assert.match(header, CUSTOM_GATES.get(key), `${key} must retain its specialized access control`);
      } else {
        assert.match(header, /requirePermission\(/, `${key} is authenticated but lacks a handler-level permission gate`);
      }
    }
  }

  const collaboration = read('modules/invoices/routes/collaboration.js');
  const collaborationRoutes = registrations(collaboration);
  assert.equal(collaborationRoutes.length, 9, 'shared collaboration route registration changed; update this security inventory');
  for (const route of collaborationRoutes) {
    assert.match(routeHeader(collaboration, route), /requirePermission\(/,
      `shared collaboration ${route.method.toUpperCase()} ${route.path} must retain a permission gate`);
  }
  total += collaborationRoutes.length * 2;

  assert.equal(total, 178, 'route registration count is an explicit security inventory');
  const adminUsers = read('routes/admin-users.js');
  assert.match(server, /app\.use\('\/api\/users',\s*requireAuth,\s*bumpVersionRouter\)/);
  assert.match(
    adminUsers,
    /bumpVersionRouter\.post\('\/:id\/bump-version',\s*requirePermission\('platform\.manage_users'\)/s
  );
});

test('newly gated route families reject an authenticated user with no matching permission', async () => {
  const denied = { role: 'viewer', permissions: [] };
  const families = [
    ['modules/invoices/routes/jobs.js', 'get', '/', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/jobs.js', 'get', '/sharepoint/folders', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/jobs.js', 'get', '/:jobNumber/folders', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/vendors.js', 'get', '/', 'accounting.invoices.view'],
    ['modules/invoices/routes/vendors.js', 'get', '/refresh/status', 'accounting.invoices.manage_settings'],
    ['modules/invoices/routes/subcontracts.js', 'get', '/', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/feedback.js', 'post', '/vendor', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/feedback.js', 'post', '/subcontract', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/users.js', 'get', '/', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/users.js', 'get', '/:id/photo', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/pipeline.js', 'get', '/errors', 'accounting.invoices.manage_settings'],
    ['modules/invoices/routes/pipeline.js', 'post', '/errors/:id/resolve', 'accounting.invoices.manage_settings'],
    ['modules/invoices/routes/settings.js', 'get', '/classifications', 'accounting.invoices.view'],
    ['modules/invoices/routes/settings.js', 'get', '/routing-codes', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/settings.js', 'get', '/gl-accounts', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/settings.js', 'get', '/retention', 'accounting.invoices.manage_settings'],
    ['modules/invoices/routes/settings.js', 'get', '/approval-schema', 'accounting.invoices.view'],
    ['modules/invoices/routes/settings.js', 'get', '/validate-approval/:id', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/lien-waivers.js', 'get', '/orphans', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/lien-waivers.js', 'get', '/:id/orphan-invoices', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/invoices.js', 'get', '/:id/orphan-waivers', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/invoices.js', 'post', '/:id/reprocess', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/documents.js', 'post', '/:id/upload-to-spectrum', 'accounting.invoices.submit_spectrum'],
    ['modules/invoices/routes/documents.js', 'get', '/:id/inbound-attachments', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/documents.js', 'get', '/:id/inbound-attachments/:attachmentId/preview', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/documents.js', 'get', '/:id/inbound-attachments/:attachmentId/download', 'accounting.invoices.view_details'],
    ['modules/invoices/routes/documents.js', 'post', '/:id/inbound-attachments/:attachmentId/promote', 'accounting.invoices.view_details'],
  ];

  for (const [file, method, routePath, permission] of families) {
    const source = read(file);
    const escapedRoute = routePath.replace(/[\\/]/g, '\\$&').replace(/:/g, '\\:');
    const gatePattern = new RegExp(`router\\.${method}\\(\\s*(?:\\r?\\n\\s*)?'${escapedRoute}',\\s*(?:requirePermission\\('${permission.replace(/\./g, '\\.')}'\\))`);
    assert.match(source, gatePattern, `${method.toUpperCase()} ${file}${routePath}`);

    const { requirePermission } = require('../../middleware/permissions');
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    let nextCalled = false;
    requirePermission(permission)({ user: denied }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Forbidden' });
  }

  const safeError = (res, err) => res.status(500).json({ error: err.message });
  const routerCases = [
    ['modules/invoices/routes/jobs.js', { '../services/utils': { readJSON: () => [] }, '../../../config': {}, '../../../middleware/errorResponse': { safeError } }, [['get', '/'], ['get', '/sharepoint/folders'], ['get', '/:jobNumber/folders']]],
    ['modules/invoices/routes/vendors.js', { '../services/utils': { readJSON: () => ({}), writeJSON() {} }, '../services/spectrum': { spectrumState: { running: false } }, '../../../config': {}, '../../../middleware/errorResponse': { safeError } }, [['get', '/'], ['get', '/refresh/status']]],
    ['modules/invoices/routes/subcontracts.js', { '../services/utils': { readJSON: () => [] }, '../../../config': {}, '../../../middleware/errorResponse': { safeError } }, [['get', '/']]],
    ['modules/invoices/routes/feedback.js', { '../services/matcher': { recordVendorFeedback: async () => ({}), recordSubcontractFeedback: async () => ({}) }, '../../../middleware/errorResponse': { safeError } }, [['post', '/vendor'], ['post', '/subcontract']]],
    ['modules/invoices/routes/users.js', { '../../../lib/logger': { info() {}, warn() {}, error() {} } }, [['get', '/'], ['get', '/:id/photo']]],
    ['modules/invoices/routes/pipeline.js', { '../services/pipelineErrorService': { listPipelineErrors: async () => [], resolvePipelineError: async () => {}, retryPipelineError: async () => {} }, '../services/utils': { readJSON: () => ({}) }, '../../../config': {}, '../../../middleware/errorResponse': { safeError }, child_process: { spawn() { throw new Error('not reached'); } } }, [['get', '/errors'], ['post', '/errors/:id/resolve']]],
    ['modules/invoices/routes/settings.js', { '../services/settingsService': { createCustomClassification: async () => ({}), createRetentionSetting: async () => ({}), deleteCustomClassification: async () => false, deleteRetentionSetting: async () => false, getClassificationOverride: async () => null, getDocumentById: async () => null, listRetentionSettings: async () => [], loadClassificationRows: async () => [], updateCustomClassification: async () => null, updateRetentionSetting: async () => null, upsertBuiltInClassificationOverride: async () => ({}) }, '../services/spectrum': { getGlAccounts: async () => [] }, '../services/utils': { readJSON: () => [] }, '../../../config': {}, '../services/approvalValidator': { getApprovalSchema: () => ({}), validateApproval: () => ({}) }, '../services/matching': { getSubcontractsMap: () => ({}) }, '../../../lib/auditEvents': { emitPlatformAuditEvent: async () => null }, '../../../middleware/errorResponse': { safeError } }, [['get', '/classifications'], ['get', '/routing-codes'], ['get', '/gl-accounts'], ['get', '/retention'], ['get', '/approval-schema'], ['get', '/validate-approval/:id']]],
    ['modules/invoices/routes/lien-waivers.js', { '../services/lienWaiverQueryService': { getOrphanInvoicesForWaiver: async () => ({ invoices: [], total: 0 }), listFiledOrphanWaivers: async () => ({ rows: [], total: 0 }) }, '../../../middleware/errorResponse': { safeError } }, [['get', '/orphans'], ['get', '/:id/orphan-invoices']]],
    ['modules/invoices/routes/documents.js', { '../services/spectrumCoiUploadService': { uploadToSpectrum: async () => ({}) } }, [['post', '/:id/upload-to-spectrum'], ['get', '/:id/inbound-attachments'], ['get', '/:id/inbound-attachments/:attachmentId/preview'], ['get', '/:id/inbound-attachments/:attachmentId/download'], ['post', '/:id/inbound-attachments/:attachmentId/promote']]],
  ];

  for (const [file, mocks, routes] of routerCases) {
    await withRouter(file, mocks, (router) => {
      for (const [method, routePath] of routes) {
        assertFirstRouteGateDenies(router, method, routePath);
      }
    });
  }
});

test('new route-boundary schemas reject malformed query and path inputs', () => {
  const cases = [
    [jobsQuerySchema, { limit: '0' }],
    [vendorsQuerySchema, { search: 'x'.repeat(201) }],
    [subcontractsQuerySchema, { unexpected: 'value' }],
    [sharePointFolderQuerySchema, { path: 'x'.repeat(1001) }],
    [lienWaiverOrphansQuerySchema, { limit: '201' }],
    [orphanCandidatesQuerySchema, { q: 'x'.repeat(201) }],
    [pipelineErrorsQuerySchema, { resolved: 'maybe' }],
    [classificationsQuerySchema, { include: 'all' }],
    [glAccountsQuerySchema, { type: 'DROP' }],
    [resourceIdParamsSchema, { id: '  ' }],
  ];

  for (const [schema, input] of cases) {
    assert.equal(schema.safeParse(input).success, false, JSON.stringify(input));
  }
});

test('classifications query preserves the established status=all frontend contract without allowing other status values', () => {
  assert.deepEqual(
    classificationsQuerySchema.parse({ include: 'associations', status: 'all' }),
    { include: 'associations', status: 'all', limit: 50, offset: 0 }
  );
  assert.equal(classificationsQuerySchema.safeParse({ include: 'associations', status: 'active' }).success, false);
  assert.equal(classificationsQuerySchema.safeParse({ include: 'associations', status: 'all', unexpected: 'value' }).success, false);
});

test('bounded lookup schemas normalize defaults and reject out-of-range offsets', () => {
  const boundedSchemas = [
    jobsQuerySchema,
    vendorsQuerySchema,
    subcontractsQuerySchema,
    pipelineErrorsQuerySchema,
    classificationsQuerySchema,
    glAccountsQuerySchema,
  ];

  for (const schema of boundedSchemas) {
    const parsed = schema.parse({});
    assert.equal(parsed.limit, 50);
    assert.equal(parsed.offset, 0);
    assert.equal(schema.safeParse({ offset: '-1' }).success, false);
    assert.equal(schema.safeParse({ limit: '201' }).success, false);
  }
});

test('newly protected endpoint families wire their shared schemas before handlers', () => {
  const bindings = [
    ['modules/invoices/routes/jobs.js', 'get', '/', /validate\(jobsQuerySchema, 'query'\)/],
    ['modules/invoices/routes/jobs.js', 'get', '/sharepoint/folders', /validate\(sharePointFolderQuerySchema, 'query'\)/],
    ['modules/invoices/routes/jobs.js', 'get', '/:jobNumber/folders', /validate\(jobNumberParamsSchema, 'params'\)/],
    ['modules/invoices/routes/vendors.js', 'get', '/', /validate\(vendorsQuerySchema, 'query'\)/],
    ['modules/invoices/routes/subcontracts.js', 'get', '/', /validate\(subcontractsQuerySchema, 'query'\)/],
    ['modules/invoices/routes/users.js', 'get', '/:id/photo', /validate\(resourceIdParamsSchema, 'params'\)/],
    ['modules/invoices/routes/pipeline.js', 'get', '/errors', /validate\(pipelineErrorsQuerySchema, 'query'\)/],
    ['modules/invoices/routes/pipeline.js', 'post', '/errors/:id/resolve', /validate\(resourceIdParamsSchema, 'params'\).*validate\(pipelineErrorResolveSchema\)/],
    ['modules/invoices/routes/pipeline.js', 'post', '/errors/:id/retry', /validate\(resourceIdParamsSchema, 'params'\)/],
    ['modules/invoices/routes/settings.js', 'get', '/classifications', /validate\(classificationsQuerySchema, 'query'\)/],
    ['modules/invoices/routes/settings.js', 'get', '/gl-accounts', /validate\(glAccountsQuerySchema, 'query'\)/],
    ['modules/invoices/routes/settings.js', 'get', '/backend/gl-accounts', /validate\(glAccountsQuerySchema, 'query'\)/],
    ['modules/invoices/routes/settings.js', 'get', '/validate-approval/:id', /validate\(resourceIdParamsSchema, 'params'\)/],
    ['modules/invoices/routes/lien-waivers.js', 'get', '/orphans', /validate\(lienWaiverOrphansQuerySchema, 'query'\)/],
    ['modules/invoices/routes/lien-waivers.js', 'get', '/:id/orphan-invoices', /validate\(resourceIdParamsSchema, 'params'\).*validate\(orphanCandidatesQuerySchema, 'query'\)/],
    ['modules/invoices/routes/invoices.js', 'get', '/:id/orphan-waivers', /validate\(resourceIdParamsSchema, 'params'\).*validate\(orphanCandidatesQuerySchema, 'query'\)/],
    ['modules/invoices/routes/documents.js', 'post', '/:id/upload-to-spectrum', /validate\(resourceIdParamsSchema, 'params'\)/],
    ['modules/invoices/routes/documents.js', 'get', '/:id/inbound-attachments', /validate\(resourceIdParamsSchema, 'params'\)/],
    ['modules/invoices/routes/documents.js', 'get', '/:id/inbound-attachments/:attachmentId/preview', /validate\(documentAttachmentParamsSchema, 'params'\)/],
    ['modules/invoices/routes/documents.js', 'get', '/:id/inbound-attachments/:attachmentId/download', /validate\(documentAttachmentParamsSchema, 'params'\)/],
    ['modules/invoices/routes/documents.js', 'post', '/:id/inbound-attachments/:attachmentId/promote', /validate\(documentAttachmentParamsSchema, 'params'\).*validate\(documentAttachmentEmptyBodySchema\)/],
  ];

  for (const [file, method, routePath, pattern] of bindings) {
    const source = read(file);
    const route = registrations(source).find((entry) => entry.method === method && entry.path === routePath);
    assert.ok(route, `${method.toUpperCase()} ${file}${routePath}`);
    assert.match(routeHeader(source, route), pattern, `${method.toUpperCase()} ${file}${routePath}`);
  }
});

test('validate() writes normalized path parameters without mutating req.query', () => {
  const req = {
    params: { id: ' document-1 ' },
    query: { keep: 'query' },
    originalUrl: '/api/documents/document-1/upload-to-spectrum',
    log: { warn() {} },
  };
  const res = { status() { return this; }, json() { return this; } };
  let nextCalled = false;

  validate(resourceIdParamsSchema, 'params')(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.params, { id: 'document-1' });
  assert.deepEqual(req.query, { keep: 'query' });
});
