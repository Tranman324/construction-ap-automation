'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const {
  AP_DEFAULT_ROUTING_CODE,
  ensureApDefaultRoutingCode,
} = require('../../modules/invoices/services/routingCatalogService');

const root = path.resolve(__dirname, '..', '..');

async function withRoutingCatalog(data, work) {
  const settingsPath = require.resolve(path.join(root, 'modules/invoices/routes/settings.js'));
  const originalLoad = Module._load;
  delete require.cache[settingsPath];
  Module._load = function load(request, parent, isMain) {
    if (request === '../services/utils') return { readJSON: () => data };
    if (request === '../services/settingsService') return {};
    if (request === '../services/spectrum') return { getGlAccounts: async () => [] };
    if (request === '../../../config') return {
      ROUTING_CODES_PATH: '/fixtures/routing-codes.json',
      PHASE_CODES_PATH: '/fixtures/phase-codes.json',
    };
    if (request === '../services/approvalValidator') return { getApprovalSchema: () => ({}) };
    if (request === '../services/matching') return { getSubcontractsMap: () => ({}) };
    if (request === '../../../lib/auditEvents') return { emitPlatformAuditEvent: async () => null };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await work(require(settingsPath));
  } finally {
    Module._load = originalLoad;
    delete require.cache[settingsPath];
  }
}

function servedRoutingCodes(router) {
  const res = { body: null, json(body) { this.body = body; return this; } };
  router.handleRoutingCodes({ query: { limit: 50, offset: 0 } }, res);
  return res.body;
}

function defaults(codes) {
  return codes.filter((routingCode) => routingCode.code === 'D');
}

test('routing catalog adds one canonical AP Default entry when upstream omits D', () => {
  const upstream = [
    { code: 'LP', description: 'Luke P Routing', approvers: [{ sequence: '1' }] },
    { code: 'ZZ', description: 'Other Routing' },
  ];

  const served = ensureApDefaultRoutingCode(upstream);

  assert.equal(upstream.length, 2, 'normalization must not mutate upstream reference data');
  assert.equal(defaults(served).length, 1);
  assert.deepEqual(defaults(served)[0], AP_DEFAULT_ROUTING_CODE);
  assert.deepEqual(served.filter((routingCode) => routingCode.code !== 'D'), upstream);
});

test('routing catalog replaces every upstream D variant with one canonical AP Default entry', () => {
  const upstream = [
    { code: 'D', description: 'stale upstream description', approvers: [{ sequence: '9' }] },
    { Code: ' d ', description: 'duplicate legacy casing' },
    { routing_code: 'D', description: 'duplicate legacy key' },
    { code: 'LP', description: 'Luke P Routing' },
  ];

  const served = ensureApDefaultRoutingCode(upstream);

  assert.equal(defaults(served).length, 1);
  assert.deepEqual(defaults(served)[0], {
    code: 'D',
    description: 'AP Default Routing',
  });
  assert.deepEqual(served.filter((routingCode) => routingCode.code === 'LP'), [
    { code: 'LP', description: 'Luke P Routing' },
  ]);
});

test('GET routing codes serves one canonical AP Default entry when upstream omits D', async () => {
  await withRoutingCatalog({
    routing_codes: [{ code: 'LP', description: 'Luke P Routing' }],
    pm_to_routing: { 'Luke P': 'LP' },
    refreshed_at: '2026-07-27T00:00:00.000Z',
  }, async (router) => {
    const body = servedRoutingCodes(router);
    const defaults = body.routing_codes.filter((routingCode) => routingCode.code === 'D');

    assert.equal(defaults.length, 1);
    assert.deepEqual(defaults[0], {
      code: 'D',
      description: 'AP Default Routing',
      label: 'D',
    });
    assert.deepEqual(body.pm_to_routing, { 'Luke P': 'LP' });
    assert.equal(body.refreshed_at, '2026-07-27T00:00:00.000Z');
  });
});

test('GET routing codes replaces upstream D duplicates with one canonical AP Default entry', async () => {
  await withRoutingCatalog({
    routing_codes: [
      { code: 'D', description: 'stale upstream description' },
      { Code: ' d ', description: 'duplicate legacy casing' },
      { code: 'LP', description: 'Luke P Routing' },
    ],
    pm_to_routing: {},
  }, async (router) => {
    const body = servedRoutingCodes(router);
    const defaults = body.routing_codes.filter((routingCode) => routingCode.code === 'D');

    assert.equal(defaults.length, 1);
    assert.deepEqual(defaults[0], {
      code: 'D',
      description: 'AP Default Routing',
      label: 'D',
    });
  });
});
