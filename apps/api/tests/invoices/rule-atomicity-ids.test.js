'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

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
  const resolved = require.resolve(path.join(root, relativePath));
  delete require.cache[resolved];
  return require(resolved);
}

// Clear the rule-module chain so each mocked load re-binds the current fake pool
// (rulesService captures `pool` at load; the router imports rulesService).
function clearRuleModules() {
  for (const rel of [
    'modules/invoices/routes/rules.js',
    'modules/invoices/services/rulesService.js',
    'modules/invoices/services/rulesApplyService.js',
  ]) {
    delete require.cache[require.resolve(path.join(root, rel))];
  }
}

// Fake pool that simulates a transaction (BEGIN/COMMIT/ROLLBACK) over an
// in-memory store, so rollback of created rows is observable. Audit rows are
// tracked in the SAME store as rules, on BOTH clients:
//   - the transaction client (from connect()) — enlisted work; ROLLBACK drops it
//   - the shared pool (pool.query) and the module-level `./db` fake (sharedDb) —
//     autocommit immediately, so an audit write that ESCAPES the transaction
//     survives a rollback and lands in `committed.audit`.
function makeTxPool({ failOnDocLoad = false, docs = [], failOnUpdateIndex = null } = {}) {
  const committed = { rules: [], audit: [] };
  const txSeen = [];      // SQL issued on a transaction client (connect())
  const sharedSeen = [];  // SQL issued on the shared pool / module ./db fake
  let updateCount = 0;

  function handle(sql, params = [], store) {
    if (/^\s*BEGIN/.test(sql)) return {};
    if (/^\s*COMMIT/.test(sql)) {
      committed.rules.push(...store.rules); committed.audit.push(...store.audit);
      store.rules.length = 0; store.audit.length = 0; return {};
    }
    if (/^\s*ROLLBACK/.test(sql)) { store.rules.length = 0; store.audit.length = 0; return {}; }
    if (/SELECT COALESCE\(MAX\(rule_order\)/.test(sql)) return { rows: [{ max: -1 }] };
    if (/INSERT INTO rules/.test(sql)) {
      const row = {
        id: 7, user_id: params[0], name: params[1], is_active: params[2], rule_order: params[3],
        stop_on_match: params[4], shared: params[5], criteria: JSON.parse(params[6]), actions: JSON.parse(params[7]),
        created_at: new Date(), updated_at: new Date(),
      };
      store.rules.push(row);
      return { rows: [row] };
    }
    if (/INSERT INTO audit_log/.test(sql)) {
      store.audit.push({ documentId: params[0], action: params[1], changes: params[3] });
      return {};
    }
    if (/FROM documents/.test(sql)) {
      if (failOnDocLoad) throw new Error('apply failed after the rule was created');
      return { rows: docs };
    }
    if (/UPDATE documents/.test(sql)) {
      updateCount += 1;
      if (failOnUpdateIndex != null && updateCount > failOnUpdateIndex) {
        throw new Error('apply failed mid-batch after the first document was updated');
      }
      return { rows: [], rowCount: 1 };
    }
    return { rows: [] };
  }

  // The shared/non-tx store aliases the committed arrays: a write here is an
  // autocommit (this is exactly what escaping the transaction looks like).
  const sharedStore = { rules: committed.rules, audit: committed.audit };
  return {
    committed, txSeen, sharedSeen,
    insertRan() { return this.txSeen.some((s) => /INSERT INTO rules/.test(s)); },
    auditInsertsOnTxClient() { return this.txSeen.filter((s) => /INSERT INTO audit_log/.test(s)).length; },
    auditInsertsOnSharedPool() { return this.sharedSeen.filter((s) => /INSERT INTO audit_log/.test(s)).length; },
    // Module-level `./db` fake used by emitLegacyInvoiceAuditEvent's DEFAULT
    // client (the best-effort path). Autocommits — mirrors the escape bug.
    sharedDb: { query: async (sql, params) => { sharedSeen.push(sql); return handle(sql, params, sharedStore); } },
    async connect() { const store = { rules: [], audit: [] }; return { query: async (sql, params) => { txSeen.push(sql); return handle(sql, params, store); }, release() {} }; },
    async query(sql, params) { sharedSeen.push(sql); return handle(sql, params, sharedStore); },
  };
}

const RULE_INPUT = {
  createdBy: 'u@x.example', name: 'Route ACME', isActive: true,
  criteria: [{ field: 'vendor_name', operator: 'equals', values: ['ACME'] }],
  actions: [{ type: 'set_gl_account', value: '5000' }],
};

function loadRulesService(pool) {
  return withMockedModules({
    './supabase': { pool },
    '../../../lib/auditEvents': { emitLegacyInvoiceAuditEvent: async () => {} },
  }, async () => { clearRuleModules(); return freshRequire('modules/invoices/services/rulesService.js'); });
}

test('rule auto-discard evaluates the live linked-waiver row and clears its shelf state atomically', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rowCount: 1,
        rows: [{ classification: 'lien-waiver', linked_lien_waiver_id: 'invoice-1' }],
      };
    },
  };
  const svc = await loadRulesService(pool);

  await svc.applyRulePatch({
    documentId: 'waiver-1',
    patchUpdate: {
      fields: ['status'],
      values: ['discarded'],
      patches: { status: 'discarded' },
      setClauses: 'status = $2',
    },
    matchedRules: ['rule-1'],
  });

  assert.match(calls[0].sql, /classification = 'lien-waiver' AND linked_lien_waiver_id IS NOT NULL THEN false/);
  assert.match(calls[0].sql, /filed_at = CASE[\s\S]*THEN NULL/);
  assert.match(calls[0].sql, /RETURNING classification, linked_lien_waiver_id/);
});

test('rule classification write refuses a document linked after evaluation', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 0, rows: [] };
    },
  };
  const svc = await loadRulesService(pool);

  await assert.rejects(
    () => svc.applyRulePatch({
      documentId: 'waiver-1',
      patchUpdate: {
        fields: ['classification'],
        values: ['invoice'],
        patches: { classification: 'invoice' },
        setClauses: 'classification = $2',
      },
      matchedRules: ['rule-1'],
    }),
    (error) => error.code === 'WAIVER_LINKED_CLASSIFICATION_PROTECTED'
  );
  assert.match(calls[0].sql, /linked_lien_waiver_id IS NULL OR classification = \$2/);
});

// Loads rulesService with the REAL emitLegacyInvoiceAuditEvent, whose module
// `./db` pool is the fake `sharedDb`. This exercises the real audit emitter's
// client param: on the atomic path rulesService passes the transaction client,
// so the audit INSERT enlists; if it did NOT, the emitter would fall back to
// `sharedDb` and autocommit. Restores the auditEvents cache afterward so no
// later test inherits the fake `./db` binding.
function loadRulesServiceRealAudit(pool) {
  const auditPath = require.resolve(path.join(root, 'lib', 'auditEvents.js'));
  return withMockedModules({
    './supabase': { pool },
    './db': pool.sharedDb,
  }, async () => {
    clearRuleModules();
    delete require.cache[auditPath];
    try {
      return freshRequire('modules/invoices/services/rulesService.js');
    } finally {
      delete require.cache[auditPath];
    }
  });
}

// ── Atomicity (LOAD-BEARING): failure injected BETWEEN create and apply. ──
test('a failure after the rule INSERT (mid create+apply transaction) rolls the rule back — no orphan', async () => {
  const pool = makeTxPool({ failOnDocLoad: true });
  const svc = await loadRulesService(pool);
  await assert.rejects(
    () => svc.createAndApplyRule(RULE_INPUT, { scope: 'pending' }),
    /apply failed after the rule was created/,
  );
  // The INSERT DID execute (proves the failure is mid-transaction, not an early throw).
  assert.equal(pool.insertRan(), true);
  // ...and the transaction rolled it back — the rules table has no orphan row.
  assert.equal(pool.committed.rules.length, 0);
});

// ── Audit-trail atomicity: a mid-apply failure leaves ZERO audit rows. ──
test('a mid-apply failure rolls back the applied doc AND its audit row — no phantom audit entry', async () => {
  // Two matching docs; the first applies (UPDATE + audit INSERT), the second's
  // UPDATE throws — so the whole transaction, including the first audit row,
  // must roll back.
  const docs = [{ id: 'doc-1', vendor_name: 'ACME' }, { id: 'doc-2', vendor_name: 'ACME' }];
  const pool = makeTxPool({ docs, failOnUpdateIndex: 1 });
  const svc = await loadRulesServiceRealAudit(pool);

  await assert.rejects(
    () => svc.createAndApplyRule(RULE_INPUT, { scope: 'pending' }),
    /apply failed mid-batch/,
  );

  // The first document's audit INSERT executed ON THE TRANSACTION CLIENT
  // (proves the emission happened and enlisted, not a no-op).
  assert.equal(pool.auditInsertsOnTxClient(), 1);
  // It NEVER went through the shared pool / module ./db (no escape).
  assert.equal(pool.auditInsertsOnSharedPool(), 0);
  // After rollback: no orphaned rule AND no phantom audit row survive.
  assert.equal(pool.committed.rules.length, 0);
  assert.equal(pool.committed.audit.length, 0);
});

test('create-without-apply persists the rule (unchanged behavior)', async () => {
  const pool = makeTxPool();
  const svc = await loadRulesService(pool);
  const rule = await svc.createRule(RULE_INPUT);
  assert.equal(rule.name, 'Route ACME');
  assert.equal(pool.committed.rules.length, 1); // committed via the non-tx path
});

// ── String rule IDs at every emitter (list, create, atomic apply). ──
function loadRulesRouter(pool) {
  return withMockedModules({
    './supabase': { pool },
    '../../../lib/auditEvents': { emitLegacyInvoiceAuditEvent: async () => {} },
  }, async () => { clearRuleModules(); return freshRequire('modules/invoices/routes/rules.js'); });
}

function findHandler(router, method, routePath) {
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route.methods[method]);
  assert.ok(layer, `expected ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test('rule IDs serialize as strings on the list and create responses (never numbers)', async () => {
  const numericRow = { id: 7, user_id: 'u', name: 'R', is_active: true, rule_order: 0, criteria: [], actions: [] };
  const pool = {
    async query(sql) {
      if (/SELECT \* FROM rules ORDER BY/.test(sql)) return { rows: [numericRow] };       // listRules
      if (/SELECT COALESCE\(MAX/.test(sql)) return { rows: [{ max: -1 }] };
      if (/INSERT INTO rules/.test(sql)) return { rows: [numericRow] };                    // createRule
      return { rows: [] };
    },
  };
  const router = await loadRulesRouter(pool);

  const listRes = makeRes();
  await findHandler(router, 'get', '/')({ query: {} }, listRes);
  assert.equal(listRes.body.rules[0].id, '7');
  assert.equal(typeof listRes.body.rules[0].id, 'string');

  const createRes = makeRes();
  await findHandler(router, 'post', '/')({ body: { ...RULE_INPUT, name: 'R' }, user: { email: 'u@x.example' } }, createRes);
  assert.equal(createRes.body.id, '7');
  assert.equal(typeof createRes.body.id, 'string');
});

// The rule ID also leaves via the audit payload: rules-engine records matched
// rule IDs in `matchedRules`, which flows into audit_log.changes. Assert the
// engine serializes them as strings at the source.
test('matchedRules carries string rule IDs (audit-payload emitter)', () => {
  const { evaluateBatch } = freshRequire('modules/invoices/scripts/rules-engine.js');
  const numericIdRule = {
    id: 7, is_active: true, stop_on_match: false,
    criteria: [{ field: 'vendor_name', operator: 'equals', values: ['ACME'] }],
    actions: [{ type: 'set_gl_account', value: '5000' }],
  };
  const results = evaluateBatch([{ id: 'doc-1', vendor_name: 'ACME' }], [numericIdRule]);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].matchedRules, ['7']);
  assert.equal(typeof results[0].matchedRules[0], 'string');
});

// ── sourceOutcome envelope: source matched vs. not matched ──
test('sourceOutcome reports matched:true with terminal status when the source document is affected', async () => {
  const docs = [{ id: 'source-1', vendor_name: 'ACME', status: 'pending' }];
  const pool = makeTxPool({ docs });
  const svc = await loadRulesService(pool);
  const terminalInput = {
    ...RULE_INPUT,
    actions: [{ type: 'auto_discard', value: 'spam' }],
  };
  const result = await svc.createAndApplyRule(terminalInput, {
    scope: 'pending',
    documentIds: ['source-1'],
    sourceDocumentId: 'source-1',
  });
  assert.ok(result.sourceOutcome);
  assert.equal(result.sourceOutcome.id, 'source-1');
  assert.equal(result.sourceOutcome.matched, true);
  // The fake pool returns the document as-is (no real UPDATE), so status stays
  // 'pending' in the mock. What matters is `matched: true` — the frontend
  // checks this plus the rule's action type.
});

test('sourceOutcome reports matched:false when the source document does not match but others do', async () => {
  const docs = [
    { id: 'source-1', vendor_name: 'OTHER', status: 'pending' },
    { id: 'doc-2', vendor_name: 'ACME', status: 'pending' },
  ];
  const pool = makeTxPool({ docs });
  const svc = await loadRulesService(pool);
  const result = await svc.createAndApplyRule(RULE_INPUT, {
    scope: 'pending',
    documentIds: ['source-1'],
    includeScope: true,
    sourceDocumentId: 'source-1',
  });
  assert.ok(result.sourceOutcome);
  assert.equal(result.sourceOutcome.id, 'source-1');
  assert.equal(result.sourceOutcome.matched, false);
  assert.ok(result.actionsApplied > 0, 'other docs were still affected');
});

test('sourceOutcome is omitted when sourceDocumentId is not provided (backwards compatible)', async () => {
  const docs = [{ id: 'doc-1', vendor_name: 'ACME', status: 'pending' }];
  const pool = makeTxPool({ docs });
  const svc = await loadRulesService(pool);
  const result = await svc.createAndApplyRule(RULE_INPUT, { scope: 'pending' });
  assert.equal(result.sourceOutcome, undefined);
});

test('requests still accept a numeric rule ID inbound (existing coercion preserved)', () => {
  const { ruleApplySchema, ruleCreateSchema } = require(path.join(root, 'lib', 'schemas.js'));
  // Numeric ruleId is coerced to a string, not rejected.
  const parsed = ruleApplySchema.safeParse({ ruleIds: [7, '8'], scope: 'pending' });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.ruleIds, ['7', '8']);
  // The atomic create option is accepted on the create schema (createdBy is
  // server-derived, not a request field).
  assert.equal(ruleCreateSchema.safeParse({
    name: 'R', criteria: RULE_INPUT.criteria, actions: RULE_INPUT.actions, apply: true, scope: 'pending',
  }).success, true);
});
