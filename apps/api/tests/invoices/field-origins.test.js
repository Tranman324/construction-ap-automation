'use strict';

// BE-G: persistent per-field origin (documents.field_origins).
// Contract under test:
//  - explicit client fields that change  → origin 'manual', stamped in the SAME
//    UPDATE as the value write (atomic; no separate statement)
//  - server-derived writes in the same edit (routing derivation, vendor-name
//    sync, phase invalidation) → origin 'derived', never 'manual'
//  - no value change → no origin write (re-sending the current value is not an edit)
//  - unedit restores the field_origins snapshot along with the values
//  - rules fillOnly stamps 'derived' for rule-written FIELD_MAP columns in the
//    same statement (a stale 'manual' on a rule-supplied value = false violet)
//  - unknown history is never fabricated: absent column serves as {}

const assert = require('node:assert/strict');
const fs = require('node:fs');
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

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeReq(body) {
  return {
    params: { id: 'doc-1' },
    body,
    log: { warn() {}, info() {}, error() {} },
  };
}

function documentRow(overrides = {}) {
  return {
    id: 'doc-1',
    status: 'pending',
    classification: 'invoice',
    invoice_number: 'INV-1',
    vendor_code: 'V-1',
    vendor_name: 'Vendor One',
    amount: 100,
    gl_account: '1111',
    routing_code: null,
    job_match_number: null,
    subcontract_number: null,
    phase_allocations: null,
    multi_phase_candidate: false,
    submit_error: null,
    was_modified: false,
    field_origins: {},
    ...overrides,
  };
}

function makePool(row, calls, { guardedUpdateRowCount = 1 } = {}) {
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (/FOR UPDATE/.test(sql)) return { rows: [row], rowCount: 1 };
    if (/^SELECT \* FROM documents WHERE id = \$1$/.test(sql)) return { rows: [row], rowCount: 1 };
    if (/^UPDATE documents SET /.test(sql)) return { rows: [], rowCount: guardedUpdateRowCount };
    throw new Error(`Unexpected query: ${sql}`);
  }
  return { query, async connect() { return { query, release() {} }; } };
}

function auditEventsMock({ undoAction = null, undoCalls = [], events = [] } = {}) {
  return {
    checkStateMatch: () => ({ match: true, staleFields: [] }),
    emitInvoiceAuditEvent: async (_req, _res, event) => {
      events.push(event);
      return { id: 'event-1' };
    },
    emitLegacyInvoiceAuditEvent: async () => {},
    findUndoableAction: async () => undoAction,
    getRequestAuditActor: () => ({ name: 'reviewer@example.com', userId: 'reviewer', role: null }),
    insertAuditEvent: async () => ({ id: 'event-1' }),
    markActionUndone: async (...args) => { undoCalls.push(args); },
  };
}

function editServiceMocks(pool, extra = {}) {
  return {
    './supabase': {
      pool,
      audit: async (...args) => { extra.legacyAudits?.push(args); },
      rowToDoc: (value) => value,
      getWaiverActionSerializationOptions: () => ({}),
    },
    '../../../lib/auditEvents': auditEventsMock(extra.audit || {}),
    './approvalStateService': { buildApprovalState: () => ({}) },
    './matcher': {
      matchSubcontract: async () => ({ method: 'none', subcontractNumber: null }),
      getSubcontractPhaseInfo: () => null,
      recordJobFeedback: () => {},
      recordSubcontractFeedback: () => {},
      recordVendorFeedback: () => {},
      recordSubjectJobFeedback: () => {},
      recordSenderJobFeedback: () => {},
    },
    './rematch': { rematchVendorPending: async () => ({ improved: 0, total: 0 }) },
    './submitRouting': { deriveRoutingCode: () => 'D' },
    ...extra.modules,
  };
}

function findOriginUpdate(calls) {
  const updates = calls.filter((c) => /^UPDATE documents SET /.test(c.sql));
  const withOrigins = updates.filter((c) => /field_origins = field_origins \|\| \$\d+::jsonb/.test(c.sql));
  return { updates, withOrigins };
}

function originParam(call) {
  const match = call.sql.match(/field_origins = field_origins \|\| \$(\d+)::jsonb/);
  assert.ok(match, `no origin merge clause in: ${call.sql}`);
  return JSON.parse(call.params[Number(match[1]) - 1]);
}

test('manual edit stamps manual origin in the SAME update statement', async () => {
  const row = documentRow();
  const calls = [];
  await withMockedModules(editServiceMocks(makePool(row, calls)), async () => {
    const { updateInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    const res = makeRes();
    await updateInvoice(makeReq({ glAccount: '5450' }), res);
    assert.equal(res.statusCode, 200);
  });

  const { updates, withOrigins } = findOriginUpdate(calls);
  assert.equal(updates.length, 1, 'origin must ride the one value UPDATE, never a second statement');
  assert.equal(withOrigins.length, 1);
  const origins = originParam(withOrigins[0]);
  assert.deepEqual(Object.keys(origins), ['glAccount']);
  assert.equal(origins.glAccount.origin, 'manual');
  assert.equal(origins.glAccount.by, 'reviewer@example.com');
  assert.ok(origins.glAccount.at);
});

test('derived routing in a jobNumber edit is stamped derived, never manual', async () => {
  const row = documentRow();
  const calls = [];
  await withMockedModules(editServiceMocks(makePool(row, calls)), async () => {
    const { updateInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    const res = makeRes();
    await updateInvoice(makeReq({ jobNumber: '23-100' }), res);
    assert.equal(res.statusCode, 200);
  });

  const { withOrigins } = findOriginUpdate(calls);
  assert.equal(withOrigins.length, 1);
  const origins = originParam(withOrigins[0]);
  assert.equal(origins.jobNumber.origin, 'manual');
  assert.equal(origins.routingCode.origin, 'derived', 'server-derived routing must never read as manual');
});

test('re-sending the current value writes no origin (negative control)', async () => {
  const row = documentRow();
  const calls = [];
  await withMockedModules(editServiceMocks(makePool(row, calls)), async () => {
    const { updateInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    const res = makeRes();
    await updateInvoice(makeReq({ glAccount: '1111' }), res);
    assert.equal(res.statusCode, 200);
  });

  const { updates, withOrigins } = findOriginUpdate(calls);
  assert.equal(updates.length, 1);
  assert.equal(withOrigins.length, 0, 'unchanged value must not rewrite provenance');
});

test('failed status guard persists nothing — origins are atomic with values', async () => {
  const row = documentRow();
  const calls = [];
  await withMockedModules(editServiceMocks(makePool(row, calls, { guardedUpdateRowCount: 0 })), async () => {
    const { updateInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    const res = makeRes();
    await updateInvoice(makeReq({ glAccount: '5450' }), res);
    assert.equal(res.statusCode, 409);
  });

  const { updates } = findOriginUpdate(calls);
  assert.equal(updates.length, 1, 'exactly one guarded UPDATE — no standalone origin write to leak');
});

test('unedit restores the field_origins snapshot with the values', async () => {
  const priorOrigins = { glAccount: { origin: 'manual', at: '2026-09-07T00:00:00.000Z', by: 'reviewer@example.com' } };
  const row = documentRow({ gl_account: '5450', field_origins: priorOrigins });
  const calls = [];
  const undoCalls = [];
  const action = {
    id: 'edit-action',
    afterState: { gl_account: '5450' },
    beforeState: { gl_account: '1111', was_modified: false, field_origins: {} },
  };
  await withMockedModules(editServiceMocks(makePool(row, calls), { audit: { undoAction: action, undoCalls } }), async () => {
    const { uneditInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    const res = makeRes();
    await uneditInvoice(makeReq({}), res);
    assert.equal(res.statusCode, 200);
  });

  const restore = calls.find((c) => /^UPDATE documents SET /.test(c.sql));
  assert.ok(restore, 'restore UPDATE missing');
  const originSet = restore.sql.match(/field_origins = \$(\d+)/);
  assert.ok(originSet, 'unedit must restore field_origins alongside the values');
  assert.deepEqual(restore.params[Number(originSet[1]) - 1], {});
  assert.equal(undoCalls.length, 1);
});

async function runCodingEdit({ row, body, codingDefaults }) {
  const calls = [];
  const events = [];
  const legacyAudits = [];
  const approvalCalls = [];
  await withMockedModules(editServiceMocks(makePool(row, calls), {
    audit: { events },
    legacyAudits,
    modules: {
      './approvalStateService': {
        buildApprovalState: () => {
          const afterUpdate = calls.some((call) => /^UPDATE documents SET /.test(call.sql));
          approvalCalls.push({ afterUpdate });
          return {
            codingDefaults: afterUpdate
              ? { routingCode: 'late-routing', phaseCode: 'late-phase', glAccount: 'late-gl', costType: 'late-cost' }
              : codingDefaults,
          };
        },
      },
    },
  }), async () => {
    const { updateInvoice } = freshRequire('modules/invoices/services/invoiceEditService.js');
    const res = makeRes();
    await updateInvoice(makeReq(body), res);
    assert.equal(res.statusCode, 200);
  });
  return { events, legacyAudits, approvalCalls };
}

test('activity snapshots every served coding default before updating while raw audit and undo state stay persisted', async () => {
  const cases = [
    ['routingCode', 'routing_code', 'D', 'R'],
    ['phaseCode', 'phase_code', '07750', '00710'],
    ['glAccount', 'gl_account', '5300', '5600'],
    ['costType', 'cost_type', 'M', 'O'],
  ];
  for (const [field, column, defaultValue, newValue] of cases) {
    const { events, legacyAudits, approvalCalls } = await runCodingEdit({
      row: documentRow({ [column]: null }),
      body: { [field]: newValue },
      codingDefaults: { [field]: defaultValue },
    });

    assert.deepEqual(events[0].changes[field], [defaultValue, newValue]);
    assert.deepEqual(legacyAudits[0][2][field], [null, newValue]);
    assert.equal(events[0].beforeState[column], null);
    assert.equal(approvalCalls[0].afterUpdate, false, 'default snapshot must be captured while the row lock is held');
  }
});

test('stored coding values win over served defaults in activity', async () => {
  const { events } = await runCodingEdit({
    row: documentRow({ cost_type: 'S' }),
    body: { costType: 'O' },
    codingDefaults: { costType: 'M' },
  });

  assert.deepEqual(events[0].changes.costType, ['S', 'O']);
});

test('activity retains a raw blank before value when no coding default exists', async () => {
  const { events } = await runCodingEdit({
    row: documentRow({ routing_code: null }),
    body: { routingCode: 'R' },
    codingDefaults: { routingCode: null },
  });

  assert.deepEqual(events[0].changes.routingCode, [null, 'R']);
});

test('rules fillOnly stamps derived origins in the same statement', async () => {
  const calls = [];
  const doc = documentRow({ gl_account: null });
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM documents WHERE id/.test(sql)) return { rows: [doc], rowCount: 1 };
      if (/FROM rules/.test(sql)) return { rows: [{ id: 1, is_active: true }], rowCount: 1 };
      if (/^UPDATE documents SET /.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const rulesEngineMock = {
    evaluateBatch: () => [{ patches: { gl_account: '5450' }, matchedRules: ['1'] }],
    buildPatchUpdate(patches, startParamIndex = 2) {
      const entries = Object.entries(patches);
      return {
        fields: entries.map(([field]) => field),
        values: entries.map(([, value]) => value),
        patches,
        setClauses: entries.map(([field], index) => `${field} = $${startParamIndex + index}`).join(', '),
      };
    },
  };
  await withMockedModules({
    './supabase': { pool },
    '../scripts/rules-engine': rulesEngineMock,
    '../../../lib/auditEvents': auditEventsMock(),
  }, async () => {
    const { applyRulesToDocumentById } = freshRequire('modules/invoices/services/rulesApplyService.js');
    const result = await applyRulesToDocumentById('doc-1', { fillOnly: true });
    assert.deepEqual(result.applied, ['gl_account']);
  });

  const { updates, withOrigins } = findOriginUpdate(calls);
  assert.equal(updates.length, 1);
  assert.equal(withOrigins.length, 1, 'rule write must stamp origins in the same UPDATE');
  const origins = originParam(withOrigins[0]);
  assert.deepEqual(Object.keys(origins), ['glAccount']);
  assert.equal(origins.glAccount.origin, 'derived');
  assert.equal(origins.glAccount.by, 'rules-engine');
});

test('rules writes to non-FIELD_MAP columns carry no origin clause', async () => {
  const calls = [];
  const doc = documentRow();
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM documents WHERE id/.test(sql)) return { rows: [doc], rowCount: 1 };
      if (/FROM rules/.test(sql)) return { rows: [{ id: 1, is_active: true }], rowCount: 1 };
      if (/^UPDATE documents SET /.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const rulesEngineMock = {
    evaluateBatch: () => [{ patches: { status: 'discarded' }, matchedRules: ['1'] }],
    buildPatchUpdate(patches, startParamIndex = 2) {
      const entries = Object.entries(patches);
      return {
        fields: entries.map(([field]) => field),
        values: entries.map(([, value]) => value),
        patches,
        setClauses: entries.map(([field], index) => `${field} = $${startParamIndex + index}`).join(', '),
      };
    },
  };
  await withMockedModules({
    './supabase': { pool },
    '../scripts/rules-engine': rulesEngineMock,
    '../../../lib/auditEvents': auditEventsMock(),
  }, async () => {
    const { applyRulesToDocumentById } = freshRequire('modules/invoices/services/rulesApplyService.js');
    await applyRulesToDocumentById('doc-1', { fillOnly: false });
  });

  const { updates, withOrigins } = findOriginUpdate(calls);
  assert.equal(updates.length, 1);
  assert.equal(withOrigins.length, 0);
});

test('unknown history serves as empty origins — never fabricated (static)', () => {
  const source = fs.readFileSync(path.join(root, 'modules/invoices/services/supabase.js'), 'utf8');
  assert.match(source, /fieldOrigins: r\.field_origins \|\| \{\}/);
});

test('rematch cannot touch manually-edited rows (guard protects origins, static)', () => {
  const source = fs.readFileSync(path.join(root, 'modules/invoices/services/rematch.js'), 'utf8');
  assert.match(source, /was_modified = false/);
});

test('census writers carry origin handling (static)', () => {
  // Undo restores the origin snapshot with the values.
  const unified = fs.readFileSync(path.join(root, 'modules/invoices/services/unifiedActionService.js'), 'utf8');
  assert.match(unified, /'field_origins',/, 'field_origins must be in UNDOABLE_COLUMNS');
  // Approval overrides = manual; coding-default fills = derived; unapprove restores snapshot.
  const approval = fs.readFileSync(path.join(root, 'modules/invoices/services/invoiceApprovalService.js'), 'utf8');
  assert.match(approval, /origin: 'manual', at: originAt, by: actor/);
  assert.match(approval, /origin: 'derived', at: originAt, by: 'approval-defaults'/);
  assert.match(approval, /beforeState, 'field_origins'/);
  // Bulk approve fills = derived, snapshot kept out of afterState.
  const bulk = fs.readFileSync(path.join(root, 'modules/invoices/services/bulkActionService.js'), 'utf8');
  assert.match(bulk, /origin: 'derived', at: now, by: 'approval-defaults'/);
  // Attach-file extraction writes = derived in the same statement.
  const attach = fs.readFileSync(path.join(root, 'modules/invoices/services/attachFileService.js'), 'utf8');
  assert.match(attach, /origin: 'derived', at: originAt, by: 'attach-file'/);
  assert.match(attach, /field_origins = field_origins \|\| \$\$\{values\.length\}::jsonb/);
});

test('migration is additive-only with empty-object default (static)', () => {
  const sql = fs.readFileSync(path.join(root, 'migrations/2026-09-07_add_field_origins.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS field_origins JSONB NOT NULL DEFAULT '\{\}'/);
  assert.doesNotMatch(sql, /UPDATE|DELETE|DROP/i);
});
