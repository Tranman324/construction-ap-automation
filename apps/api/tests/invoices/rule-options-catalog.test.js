'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
// The original frontend catalogs (ruleOptions.ts labels, SpectrumSubmitSection
// COST_TYPE_LABELS) were DELETED in the P1 rewire — the frontend now renders
// the served catalogs. Parity pins against the frontend's test-only fixture
// (rule options) and a frozen expected list (cost types, whose only remaining
// definition IS the backend catalog) so accidental catalog edits fail loudly.
const webSettings = path.resolve(
  root, '..', 'web', 'src', 'modules', 'accounting', 'modules', 'invoices',
  'components', 'settings', 'ruleOptionsFixture.ts',
);

const FROZEN_COST_TYPE_OPTIONS = [
  { value: 'S', label: 'S - Subcontract' },
  { value: 'M', label: 'M - Material' },
  { value: 'L', label: 'L - Labor' },
  { value: 'O', label: 'O - Other' },
  { value: 'E', label: 'E - Equipment' },
  { value: 'B', label: 'B - Bond' },
];

const {
  RULE_ACTIONS, RULE_FIELDS, RULE_OPERATORS, RULE_STATUSES, COST_TYPE_OPTIONS, values,
} = require('../../lib/ruleCatalog');
const { ruleActionSchema, ruleCriterionSchema } = require('../../lib/schemas');

function extractBalanced(src, name, open, close) {
  const eq = src.indexOf('=', src.indexOf(name));
  const start = src.indexOf(open, eq);
  let depth = 0;
  let i = start;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === open) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) break; }
  }
  // eslint-disable-next-line no-eval
  return eval(`(${src.slice(start, i + 1)})`);
}

function recordToOptions(record) {
  return Object.entries(record).map(([value, label]) => ({ value, label }));
}

// Load the settings router with lib/db stubbed so the static catalog handlers
// can be executed without a live database.
function loadSettingsRouter() {
  const dbPath = require.resolve('../../lib/db.js');
  const before = require.cache[dbPath];
  const fakePool = Object.assign(async () => {}, {
    query: async () => ({ rows: [] }),
    on() {},
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
    supabase: {},
  });
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePool };
  const routerPath = require.resolve('../../modules/invoices/routes/settings.js');
  delete require.cache[routerPath];
  const router = require(routerPath);
  const restore = () => {
    if (before) require.cache[dbPath] = before; else delete require.cache[dbPath];
    delete require.cache[routerPath];
  };
  return { router, restore };
}

function runGet(router, routePath) {
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route.methods.get);
  assert.ok(layer, `expected GET ${routePath}`);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  let body = null;
  handler({}, { json: (b) => { body = b; return b; } });
  return body;
}

test('GET /rule-options serves all four catalogs value-identical to the frontend constants', () => {
  const src = fs.readFileSync(webSettings, 'utf8');
  const expected = extractBalanced(src, 'SEEDED_RULE_OPTIONS', '{', '}');

  const { router, restore } = loadSettingsRouter();
  try {
    const body = runGet(router, '/rule-options');
    assert.deepEqual(Object.keys(body).sort(), ['actions', 'fields', 'operators', 'statuses']);
    assert.deepEqual(body.actions, expected.actions);
    assert.deepEqual(body.fields, expected.fields);
    assert.deepEqual(body.operators, expected.operators);
    assert.deepEqual(body.statuses, expected.statuses);
    for (const entry of [...body.actions, ...body.fields, ...body.operators, ...body.statuses]) {
      assert.equal(typeof entry.value, 'string');
      assert.equal(typeof entry.label, 'string');
    }
  } finally {
    restore();
  }
});

test('GET /cost-types serves the Spectrum cost-type catalog value-identical to COST_TYPE_LABELS', () => {
  const expected = FROZEN_COST_TYPE_OPTIONS;

  const { router, restore } = loadSettingsRouter();
  try {
    const body = runGet(router, '/cost-types');
    assert.deepEqual(Object.keys(body), ['costTypes']);
    assert.deepEqual(body.costTypes, expected);
    assert.deepEqual(body.costTypes, COST_TYPE_OPTIONS);
  } finally {
    restore();
  }
});

// LOAD-BEARING: serving and validation cannot drift because both derive from the
// single lib/ruleCatalog definitions. Introspect the schema enums + prove the
// dropped legacy operators are refused.
test('rule validation enums are exactly the served catalog values (single source)', () => {
  const actionEnum = ruleActionSchema.shape.type.options;
  const operatorEnum = ruleCriterionSchema.shape.operator.options;
  const fieldEnum = ruleCriterionSchema.shape.field.options;

  assert.deepEqual([...actionEnum].sort(), values(RULE_ACTIONS).sort());
  assert.deepEqual([...operatorEnum].sort(), values(RULE_OPERATORS).sort());
  assert.deepEqual([...fieldEnum].sort(), values(RULE_FIELDS).sort());
});

test('single source is enforced behaviorally: every catalog value validates; non-catalog + dropped legacy values are refused', () => {
  for (const { value } of RULE_ACTIONS) {
    assert.ok(ruleActionSchema.safeParse({ type: value, value: 'x' }).success, `action ${value} must validate`);
  }
  assert.equal(ruleActionSchema.safeParse({ type: 'not_a_real_action', value: 'x' }).success, false);

  // Canonical operators validate; the dropped legacy greater_than/less_than are refused.
  assert.ok(ruleCriterionSchema.safeParse({ field: 'amount', operator: 'gt', values: ['1'] }).success);
  assert.ok(ruleCriterionSchema.safeParse({ field: 'amount', operator: 'lt', values: ['1'] }).success);
  assert.equal(ruleCriterionSchema.safeParse({ field: 'amount', operator: 'greater_than', values: ['1'] }).success, false);
  assert.equal(ruleCriterionSchema.safeParse({ field: 'amount', operator: 'less_than', values: ['1'] }).success, false);

  // Fields are now enum-validated from the catalog; a non-catalog field is refused.
  assert.ok(ruleCriterionSchema.safeParse({ field: 'vendor_name', operator: 'equals', values: ['x'] }).success);
  assert.equal(ruleCriterionSchema.safeParse({ field: 'not_a_field', operator: 'equals', values: ['x'] }).success, false);
});
