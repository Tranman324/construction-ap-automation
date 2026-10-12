'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const root = path.resolve(__dirname, '..', '..');

async function withMocks(mocks, work) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await work();
  } finally {
    Module._load = originalLoad;
  }
}

function fresh(relativePath) {
  const resolved = require.resolve(path.join(root, relativePath));
  delete require.cache[resolved];
  return require(resolved);
}

function clearServices() {
  for (const relativePath of [
    'modules/invoices/services/pipeline.js',
    'modules/invoices/services/rulesApplyService.js',
  ]) delete require.cache[require.resolve(path.join(root, relativePath))];
}

test('Amazon classification records the persisted values as a platform audit event', async () => {
  const calls = [];
  const events = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; } };
  await withMocks({
    '../../../lib/db': db,
    '../../../lib/auditEvents': { insertAuditEvent: async (event, client) => { events.push({ event, client }); } },
  }, async () => {
    clearServices();
    const { applyAmazonGLClassification } = fresh('modules/invoices/services/pipeline.js');
    await applyAmazonGLClassification(
      { id: 'doc-amazon', gl_account: null, cost_type: 'S' },
      { gl: '5300', costType: 'M', category: 'job_materials' },
      db,
    );
  });

  assert.match(calls[0].sql, /UPDATE documents SET gl_account = \$2/);
  assert.deepEqual(events[0], {
    client: db,
    event: {
      type: 'invoice.classified', actor: { userId: null, name: 'System', role: 'pipeline' },
      target: { type: 'invoice', id: 'doc-amazon' },
      changes: { glAccount: [null, '5300'], costType: ['S', 'M'] },
      summary: 'Pipeline classified: job_materials', module: 'invoices', severity: 'info',
    },
  });
});

test('pipeline intake rules emit one platform audit after the direct rule patch', async () => {
  const events = [];
  const db = {};
  await withMocks({
    '../../../lib/auditEvents': { insertAuditEvent: async (event, client) => { events.push({ event, client }); } },
  }, async () => {
    clearServices();
    const { emitPipelineRulesAppliedEvent } = fresh('modules/invoices/services/pipeline.js');
    const patchUpdate = { patches: { gl_account: '5600', phase_code: '00710' } };
    await emitPipelineRulesAppliedEvent({
      document: { id: 'doc-intake', gl_account: '5300', phase_code: null },
      patchUpdate, matchedRules: ['Rule A'], db,
    });
  });

  assert.deepEqual(events[0].event.changes, { glAccount: ['5300', '5600'], phaseCode: [null, '00710'] });
  assert.equal(events[0].event.summary, 'Rules applied: Rule A');
});

test('pipeline intake waiver discard audit includes filed side-effect clears', async () => {
  const events = [];
  await withMocks({
    '../../../lib/auditEvents': { insertAuditEvent: async (event) => { events.push(event); } },
  }, async () => {
    clearServices();
    const { emitPipelineRulesAppliedEvent } = fresh('modules/invoices/services/pipeline.js');
    await emitPipelineRulesAppliedEvent({
      document: {
        id: 'waiver-intake',
        status: 'pending',
        classification: 'lien-waiver',
        linked_lien_waiver_id: 'linked-waiver',
        filed: true,
        filed_at: '2026-09-17T12:00:00.000Z',
      },
      patchUpdate: { patches: { status: 'discarded' } },
      matchedRules: ['Discard linked waiver'],
      db: {},
    });
  });

  assert.deepEqual(events[0].changes, {
    status: ['pending', 'discarded'],
    filed: [true, false],
    filedAt: ['2026-09-17T12:00:00.000Z', null],
  });
});

async function runRules({ fillOnly, document, rules }) {
  const events = [];
  const legacy = [];
  const calls = [];
  const db = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/SELECT \* FROM documents/.test(sql)) return { rows: [document] };
    if (/SELECT \* FROM rules/.test(sql)) return { rows: rules };
    if (/UPDATE documents/.test(sql)) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  await withMocks({
    './supabase': { pool: db },
    '../../../lib/auditEvents': {
      emitLegacyInvoiceAuditEvent: async (...args) => { legacy.push(args); },
      insertAuditEvent: async (event, client) => { events.push({ event, client }); },
    },
    './invoiceEditService': { FIELD_MAP: { glAccount: 'gl_account', phaseCode: 'phase_code' } },
  }, async () => {
    clearServices();
    const { applyRulesToDocumentById } = fresh('modules/invoices/services/rulesApplyService.js');
    await applyRulesToDocumentById(document.id, { fillOnly, db });
  });
  return { calls, events, legacy };
}

function rule(id, actions) {
  return {
    id, is_active: true, stop_on_match: false,
    criteria: [{ field: 'status', operator: 'equals', values: ['pending'] }], actions,
  };
}

test('fillOnly rule reruns audit only the fields actually filled and retain the legacy audit', async () => {
  const result = await runRules({
    fillOnly: true,
    document: { id: 'doc-fill', status: 'pending', gl_account: null, phase_code: '09999' },
    rules: [rule('fill-gl', [{ type: 'set_gl_account', value: '5600' }, { type: 'set_phase_code', value: '00710' }])],
  });
  assert.equal(result.legacy.length, 1);
  assert.deepEqual(result.events[0].event.changes, { glAccount: [null, '5600'] });
  assert.deepEqual(result.legacy[0].slice(0, 2), ['doc-fill', 'rules-applied']);
});

test('full rules reruns audit every applied patch with its raw pre-update value', async () => {
  const result = await runRules({
    fillOnly: false,
    document: { id: 'doc-full', status: 'pending', gl_account: '5300', phase_code: null },
    rules: [rule('full-rule', [{ type: 'set_gl_account', value: '5600' }, { type: 'set_phase_code', value: '00710' }])],
  });
  assert.deepEqual(result.events[0].event.changes, { glAccount: ['5300', '5600'], phaseCode: [null, '00710'] });
  assert.equal(result.events[0].event.summary, 'Rules applied: full-rule');
});

test('rules emit no platform or legacy audit when no patches apply', async () => {
  const result = await runRules({
    fillOnly: false,
    document: { id: 'doc-none', status: 'pending' },
    rules: [rule('no-actions', [])],
  });
  assert.equal(result.events.length, 0);
  assert.equal(result.legacy.length, 0);
  assert.equal(result.calls.some(({ sql }) => /UPDATE documents/.test(sql)), false);
});
