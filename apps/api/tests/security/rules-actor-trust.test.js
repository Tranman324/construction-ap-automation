'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const routePath = path.resolve(__dirname, '../../modules/invoices/routes/rules.js');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function postHandler(router) {
  const layer = router.stack.find((candidate) => candidate.route?.path === '/' && candidate.route.methods.post);
  assert.ok(layer, 'expected POST / rules handler');
  return layer.route.stack.at(-1).handle;
}

async function withRulesRoute(pool, fn) {
  const resolved = require.resolve(routePath);
  const priorRoute = require.cache[resolved];
  const originalLoad = Module._load;

  delete require.cache[resolved];
  Module._load = function load(requestName, parent, isMain) {
    if (requestName === '../services/rulesService') return {
      createRule: async ({ createdBy, name, isActive, order, stopOnMatch, shared, criteria, actions }) => {
        const max = await pool.query('SELECT COALESCE(MAX(rule_order), -1) as max');
        const params = [createdBy, name, isActive, order ?? parseInt(max.rows[0].max, 10) + 1, stopOnMatch, shared, JSON.stringify(criteria), JSON.stringify(actions)];
        return (await pool.query('INSERT INTO rules', params)).rows[0];
      },
    };
    if (requestName === '../../../middleware/validate') return { validate: () => (req, res, next) => next() };
    if (requestName === '../../../middleware/permissions') return { requirePermission: () => (req, res, next) => next() };
    if (requestName === '../../../lib/schemas') {
      return { ruleApplySchema: {}, ruleCreateSchema: {}, ruleOrderSchema: {}, ruleUpdateSchema: {} };
    }
    return originalLoad.call(this, requestName, parent, isMain);
  };

  try {
    await fn(require(resolved));
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolved];
    if (priorRoute) require.cache[resolved] = priorRoute;
  }
}

test('rule creation never uses a spoofed x-user-id when the authenticated user has no email', async () => {
  const inserts = [];
  const pool = {
    async query(sql, params) {
      if (sql.startsWith('SELECT COALESCE(MAX')) return { rows: [{ max: '-1' }] };
      inserts.push(params);
      return {
        rows: [{
          id: 'rule-1', user_id: params[0], name: params[1], is_active: params[2],
          rule_order: params[3], stop_on_match: params[4], shared: params[5],
          criteria: JSON.parse(params[6]), actions: JSON.parse(params[7]),
        }],
      };
    },
  };

  await withRulesRoute(pool, async (router) => {
    const req = {
      user: {},
      headers: { 'x-user-id': 'spoofed-creator' },
      body: { name: 'Safe rule', criteria: [], actions: [] },
      log: { error() {} },
    };
    const res = response();

    await postHandler(router)(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.createdBy, 'system');
  });

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][0], 'system');
});
