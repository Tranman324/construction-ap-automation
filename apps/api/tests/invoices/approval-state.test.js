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

const SUB_MAP = {
  'SUB-1': { unbilled: 1000 },      // within budget for amount<=1000
  'SUB-OVER': { unbilled: 100 },    // over budget for amount>100
};

function phaseInfoFor(subcontractNumber) {
  const unbilled = SUB_MAP[subcontractNumber] ? Number(SUB_MAP[subcontractNumber].unbilled) : 0;
  return {
    subcontractNumber,
    jobNumber: '26-401',
    vendorCode: 'V1',
    totalBilled: 0,
    unbilled,
    aggregatedPhases: [{ phase_code: '01-100', cost_type: 'S' }],
    phaseRows: [{ phase_code: '01-100', cost_type: 'S' }],
    isMultiPhase: false,
    distinctPhaseCount: 1,
    phaseRowCount: 1,
  };
}

// Mocks shared by buildApprovalState AND approvalValidator's gate: same reference
// data source, so preview and gate see identical inputs.
function catalogMocks(routing = { exceedsUnbilled: false, suggestedRoutingCode: null, suggestedRoutingPm: null }) {
  return {
    './matching': { getSubcontractsMap: () => SUB_MAP },
    './matcher': { getSubcontractPhaseInfo: (sub) => (SUB_MAP[sub] ? phaseInfoFor(sub) : null) },
    './phaseOptionsService': { findSuggestedRouting: () => routing },
  };
}

// W7: only the current calendar month is an open period, so approval fixtures
// must carry current-month dates or the closed-period gate blocks first.
const NOW = new Date();
const OPEN_DATE = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-01`;

function completeRow(overrides = {}) {
  return {
    id: 'doc-1',
    classification: 'invoice',
    invoice_number: 'INV-1',
    vendor_code: 'V1',
    invoice_date: OPEN_DATE,
    gl_date: OPEN_DATE,
    amount: 500,
    job_match_number: '26-401',
    subcontract_number: 'SUB-1',
    phase_code: '01-100',
    cost_type: 'S',
    gl_account: '5450',
    routing_code: 'D',
    multi_phase_candidate: false,
    phase_allocations: null,
    lien_waiver_required: false,
    linked_lien_waiver_id: null,
    waiver_on_document: false,
    ...overrides,
  };
}

async function build(row, routing) {
  return withMockedModules(catalogMocks(routing), async () => {
    const { buildApprovalState } = freshRequire('modules/invoices/services/approvalStateService.js');
    return buildApprovalState(row, { invoiceId: row.id });
  });
}

// ── Contract matrix: 3 paths + null cases ──
test('path 1 (job + subcontract within budget) returns the full contract shape', async () => {
  const state = await build(completeRow());
  assert.deepEqual(Object.keys(state).sort(), [
    'asOf', 'blockerDetails', 'blockers', 'codingDefaults', 'path', 'requiredFields', 'suggestedRoutingCode', 'suggestedRoutingPm', 'unbilledBalance',
  ]);
  assert.equal(state.path, '1');
  assert.ok(Array.isArray(state.requiredFields) && state.requiredFields.includes('phase_code'));
  assert.deepEqual(state.blockers, []); // complete row → no blockers
  assert.deepEqual(state.blockerDetails, []); // no structured blockers either
  assert.equal(state.unbilledBalance, 1000);
  assert.equal(typeof state.asOf, 'string');
  assert.deepEqual(state.codingDefaults, { glAccount: '5450', costType: 'S', phaseCode: '01-100', routingCode: 'D', glDate: OPEN_DATE });
  assert.equal(state.suggestedRoutingCode, null);
  assert.equal(state.suggestedRoutingPm, null);
});

test('path 2 (job, no subcontract) → unbilledBalance null and routing required', async () => {
  const state = await build(completeRow({ subcontract_number: null, routing_code: null }));
  assert.equal(state.path, '2');
  assert.equal(state.unbilledBalance, null); // no subcontract → null
  assert.ok(state.requiredFields.includes('routing_code'));
  assert.ok(state.blockers.some((b) => /Routing Code/.test(b))); // matches the gate
});

test('path 2 (job + subcontract over budget) is path 2, unbilled from sidecar', async () => {
  const state = await build(completeRow({ subcontract_number: 'SUB-OVER', amount: 500, routing_code: 'PM1' }));
  assert.equal(state.path, '2'); // amount 500 > unbilled 100
  assert.equal(state.unbilledBalance, 100);
});

test('path 3 (no job) returns the minimal required set and null subcontract balance', async () => {
  const state = await build(completeRow({ job_match_number: null, subcontract_number: null, phase_code: null, cost_type: null, routing_code: null }));
  assert.equal(state.path, '3');
  assert.equal(state.unbilledBalance, null);
  assert.ok(!state.requiredFields.includes('phase_code')); // path 3 does not require phase/cost/job
  assert.equal(state.codingDefaults.routingCode, 'D'); // path 3 auto-routing default
});

// ── Trigger consistency vs advisory pre-fill (G-2 B2) ──
// codingDefaults is an ADVISORY pre-fill hint, not persisted state. The DB
// trigger (trg_default_cost_type) itself is UNCHANGED and still persists only
// the subcontract → 'S' case; the served costType additionally pre-fills a
// non-subcontract 'M' from config. Both defaults are sourced from approvalRules.json.
const CODING_POLICY = require(path.join(root, 'modules/invoices/services/approvalRules.json')).codingDefaults;

test('codingDefaults.costType matches trg_default_cost_type: matched subcontract + empty cost_type → S (from config)', async () => {
  const state = await build(completeRow({ cost_type: '' }));
  // Served 'S' equals the DB trigger's persisted value AND the configured subcontract default.
  assert.equal(state.codingDefaults.costType, 'S');
  assert.equal(state.codingDefaults.costType, CODING_POLICY.costType.subcontractDefault);
});

test('codingDefaults.costType for a NON-subcontract row pre-fills the configured "M" (advisory, trigger does NOT fire)', async () => {
  const state = await build(completeRow({ subcontract_number: null, cost_type: '', job_match_number: '26-401' }));
  // Advisory served default only — the trigger persists nothing here. Value from config.
  assert.equal(state.codingDefaults.costType, 'M');
  assert.equal(state.codingDefaults.costType, CODING_POLICY.costType.nonSubcontractDefault);
});

// ── G-2 coding defaults (B1 glAccount, B2 costType): null column → served config default ──
// Policy VALUES are read from approvalRules.json (no literals in the service); the
// tests assert the served output equals the configured value AND pin the config
// to the G-2 ruling so the policy cannot silently drift.
const RULES = require(path.join(root, 'modules/invoices/services/approvalRules.json'));

test('config carries the G-2 coding policy values (5450/5300 GL, S/M cost type)', () => {
  assert.equal(RULES.codingDefaults.glAccount.subcontract, '5450');
  assert.equal(RULES.codingDefaults.glAccount.nonSubcontract, '5300');
  assert.equal(RULES.codingDefaults.costType.subcontractDefault, 'S');
  assert.equal(RULES.codingDefaults.costType.nonSubcontractDefault, 'M');
});

test('B1 glAccount: subcontract row with null gl_account → served 5450 (from config)', async () => {
  const state = await build(completeRow({ gl_account: null })); // subcontract SUB-1, amount 500 ≤ 1000
  assert.equal(state.codingDefaults.glAccount, '5450');
  assert.equal(state.codingDefaults.glAccount, RULES.codingDefaults.glAccount.subcontract);
});

test('B1/B2 glAccount: non-subcontract row with null gl_account and null cost_type → served 5300 (M default via costTypeGlMap)', async () => {
  const state = await build(completeRow({ subcontract_number: null, gl_account: null, cost_type: null, routing_code: 'PM1' }));
  assert.equal(state.codingDefaults.costType, 'M');
  assert.equal(state.codingDefaults.glAccount, '5300');
  assert.equal(state.codingDefaults.glAccount, RULES.codingDefaults.glAccount.nonSubcontract);
});

test('B2 glAccount pre-fill follows an explicit row cost type via costTypeGlMap', async () => {
  // Non-subcontract row with cost_type E: the GL Spectrum accepts is 5500, not
  // the blanket non-subcontract 5300 (dprj-class mismatch prevention).
  const state = await build(completeRow({ subcontract_number: null, gl_account: null, cost_type: 'E', routing_code: 'PM1' }));
  assert.equal(state.codingDefaults.glAccount, '5500');
  assert.equal(state.codingDefaults.glAccount, RULES.codingDefaults.costTypeGlMap.map.E);
});

test('coding defaults: a set gl_account / cost_type row value still WINS over the configured default', async () => {
  const state = await build(completeRow({ gl_account: '9999', cost_type: 'L' }));
  assert.equal(state.codingDefaults.glAccount, '9999'); // row value, not 5450
  assert.equal(state.codingDefaults.costType, 'L');     // row value, not 'S'
});

test('GET /api/approval-schema additively serves codingDefaults; existing keys unchanged', () => {
  const { getApprovalSchema } = freshRequire('modules/invoices/services/approvalValidator.js');
  const schema = getApprovalSchema();
  // Additive: codingDefaults now present, byte-equal to the JSON policy.
  assert.deepEqual(schema.codingDefaults, RULES.codingDefaults);
  // Existing consumers see unchanged fields.
  assert.deepEqual(schema.paths, RULES.paths);
  assert.deepEqual(schema.multiPhaseOverrides, RULES.multiPhaseOverrides);
  assert.deepEqual(schema.fieldLabels, RULES.fieldLabels);
  assert.equal(schema.version, RULES.version);
});

// ── Multi-phase requiredFields shape (G-2 mandatory; reconciled with approvalRules.json) ──
test('multi_phase_candidate WITH phase_allocations → requiredFields drops phase_code and cost_type (each allocation carries its own)', async () => {
  const row = completeRow({ multi_phase_candidate: true, phase_allocations: [{ phase_code: '01-100', cost_type: 'S', amount: 500 }] });
  const state = await build(row);
  assert.equal(state.path, '1'); // job + subcontract within budget

  // Reconciliation against approvalRules.json: the multi-phase requiredFields is
  // EXACTLY the path's `required` list minus multiPhaseOverrides.skipFields.
  const skip = new Set(RULES.multiPhaseOverrides.skipFields); // ["phase_code","cost_type"]
  const expected = RULES.paths['1'].required.filter((f) => !skip.has(f));
  assert.deepEqual(state.requiredFields, expected);
  assert.ok(!state.requiredFields.includes('phase_code'));
  assert.ok(!state.requiredFields.includes('cost_type'));
  // The single-phase (non-allocated) sibling still requires phase_code/cost_type.
  const single = await build(completeRow());
  assert.ok(single.requiredFields.includes('phase_code') && single.requiredFields.includes('cost_type'));
});

// ── Effective-values verdict (2026-07-23): blockers computed on the row merged
// with served codingDefaults — the same merge approve validates and persists. ──

test('t23r profile: path-2 row with saved routing + null coding → blockers [] (defaults fill the rest)', async () => {
  const row = completeRow({
    subcontract_number: 'SUB-OVER', amount: 500, routing_code: 'LP',
    invoice_date: OPEN_DATE, gl_date: null, gl_account: null, phase_code: null, cost_type: null,
  });
  const state = await build(row);
  assert.equal(state.path, '2'); // over budget: 500 > 100
  assert.deepEqual(state.blockers, []);
  assert.deepEqual(state.codingDefaults, {
    glAccount: '5450', costType: 'S', phaseCode: '01-100', routingCode: 'LP', glDate: OPEN_DATE,
  });
});

test('missing gl_account alone is NOT a blocker — the served default fills it', async () => {
  const state = await build(completeRow({ gl_account: null }));
  assert.deepEqual(state.blockers, []);
  assert.equal(state.codingDefaults.glAccount, '5450');
});

test('path-2 row without routing keeps the routing blocker (no routing default on path 2)', async () => {
  const state = await build(completeRow({ subcontract_number: null, routing_code: null, gl_account: null }));
  assert.deepEqual(state.blockers, ['Routing Code is required']);
});

test('no-derivable-phase: job-only row with null phase_code keeps the phase blocker', async () => {
  const state = await build(completeRow({ subcontract_number: null, phase_code: null, routing_code: 'PM1' }));
  assert.deepEqual(state.blockers, ['Phase Code is required']);
});

// ── blockerDetails structured shape ──

test('W7: closed-period row dual-emits canonical invoice recovery details and legacy aliases', async () => {
  const staleDate = '2025-01-15'; // guaranteed closed
  const state = await build(completeRow({ invoice_date: staleDate, gl_date: OPEN_DATE }));
  assert.ok(state.blockers.length > 0);
  assert.ok(state.blockers[0].includes('closed period'));
  assert.equal(state.blockerDetails.length, 1);
  assert.equal(state.blockerDetails[0].code, 'CLOSED_PERIOD_DATE');
  assert.equal(state.blockerDetails[0].invoiceDateMonth, '2025-01');
  assert.equal(state.blockerDetails[0].suggestedInvoiceDate, `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-01`);
  assert.equal(state.blockerDetails[0].glDateMonth, '2025-01');
  assert.equal(state.blockerDetails[0].suggestedGlDate, state.blockerDetails[0].suggestedInvoiceDate);
  assert.equal(state.blockerDetails[0].currentMonth, `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`);
  assert.ok(state.blockerDetails[0].nextAction);
});

test('missing-fields blocker surfaces MISSING_FIELDS code in blockerDetails', async () => {
  const state = await build(completeRow({ subcontract_number: null, routing_code: null }));
  assert.ok(state.blockers.length > 0);
  assert.equal(state.blockerDetails.length, 1);
  assert.equal(state.blockerDetails[0].code, 'MISSING_FIELDS');
  assert.ok(state.blockerDetails[0].missing.includes('routing_code'));
});

test('clean row has empty blockerDetails', async () => {
  const state = await build(completeRow());
  assert.deepEqual(state.blockerDetails, []);
});

// ── Blocker cross-check (LOAD-BEARING): preview blockers ⟺ what the gate rejects
// when given the SAME effective merge (getEffectiveCoding) the mutations use. ──
const BLOCKER_FIXTURES = [
  { name: 'complete', row: completeRow() },
  { name: 'missing routing (path 2)', row: completeRow({ subcontract_number: null, routing_code: null }) },
  { name: 'multi-phase needs allocation', row: completeRow({ multi_phase_candidate: true, phase_allocations: null }) },
  { name: 'missing gl_account', row: completeRow({ gl_account: null }) },
];

test('blockers match validateApprovalEligibility on the effective row (the gate approve/bulk-approve use)', async () => {
  await withMockedModules(catalogMocks(), async () => {
    const { buildApprovalState, getEffectiveCoding } = freshRequire('modules/invoices/services/approvalStateService.js');
    const { validateApprovalEligibility } = freshRequire('modules/invoices/services/approvalValidator.js');
    for (const { name, row } of BLOCKER_FIXTURES) {
      const blockers = buildApprovalState(row, { invoiceId: row.id }).blockers;
      const gate = validateApprovalEligibility(getEffectiveCoding(row).effectiveRow, { invoiceId: row.id, closedPeriodDateSource: 'invoice' });
      const gateRejects = Boolean(gate.error);
      assert.equal(blockers.length > 0, gateRejects, `${name}: blockers presence must equal gate rejection`);
      if (gateRejects && !gate.missing) {
        assert.ok(blockers.includes(gate.error), `${name}: blockers must carry the gate's rejection reason`);
      }
    }
  });
});

test('blockers cross-check drives the REAL approveInvoice mutation: a blocked row is rejected, a clean row is allowed', async () => {
  const runApprove = async (row, body = {}, { failLegacyAudit = false } = {}) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const calls = [];
    const legacyAudits = [];
    let transactionSnapshot = null;
    const answer = (sql, params = []) => {
      calls.push({ sql, params });
      if (sql === 'BEGIN') {
        transactionSnapshot = { ...row };
        return { rows: [], rowCount: 0 };
      }
      if (sql === 'COMMIT') {
        transactionSnapshot = null;
        return { rows: [], rowCount: 0 };
      }
      if (sql === 'ROLLBACK') {
        Object.assign(row, transactionSnapshot);
        transactionSnapshot = null;
        return { rows: [], rowCount: 0 };
      }
      if (/SELECT \* FROM documents WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [row] };
      if (/SELECT \* FROM documents WHERE id = \$1/.test(sql)) return { rows: [row] };
      if (/UPDATE documents/.test(sql) && /status IN/.test(sql)) {
        const invoiceDateMatch = sql.match(/invoice_date = \$(\d+)/);
        if (invoiceDateMatch) row.invoice_date = params[Number(invoiceDateMatch[1]) - 1];
        row.status = 'approved';
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    };
    const transactionClient = { query: async (sql, params) => answer(sql, params), release() {} };
    res.calls = calls;
    await withMockedModules({
      './supabase': {
        pool: { async query(sql, params) { return answer(sql, params); }, async connect() { return transactionClient; } },
        audit: async (...args) => {
          legacyAudits.push(args);
          if (failLegacyAudit) throw new Error('legacy audit unavailable');
        },
        rowToDoc: (v) => v,
      },
      './matching': { getSubcontractsMap: () => SUB_MAP, getSubcontractPhaseInfo: (s) => (SUB_MAP[s] ? phaseInfoFor(s) : null) },
      './matcher': { getSubcontractPhaseInfo: (s) => (SUB_MAP[s] ? phaseInfoFor(s) : null), recordApprovalConfirmation: async () => ({}) },
      './pdfMergeService': { queueApprovedInvoiceWaiverMerge: () => {} },
      '../../../lib/auditEvents': {
        getRequestAuditActor: () => ({ name: 'r@x.example' }),
        emitInvoiceAuditEvent: async () => ({ id: 'e' }),
      },
      '../../../middleware/errorResponse': require('../../middleware/errorResponse'),
    }, async () => {
      const { approveInvoice } = freshRequire('modules/invoices/services/invoiceApprovalService.js');
      await approveInvoice({ params: { id: row.id }, body, user: { email: 'r@x.example' }, log: { info() {}, warn() {} } }, res);
    });
    return { res, calls, legacyAudits };
  };

  // Blocked row (multi-phase needs allocation) → approve rejects; blockers non-empty.
  const blockedRow = completeRow({ multi_phase_candidate: true, phase_allocations: null, status: 'pending' });
  const blockedState = await build(blockedRow);
  assert.ok(blockedState.blockers.length > 0);
  const blockedRes = await runApprove({ ...blockedRow });
  assert.equal(blockedRes.res.statusCode >= 400, true, 'a blocked row must be rejected by the real approve mutation');

  const closedPeriodRes = await runApprove(completeRow({ invoice_date: '2025-01-15', gl_date: OPEN_DATE, status: 'pending' }));
  assert.equal(closedPeriodRes.res.statusCode, 400);
  assert.equal(closedPeriodRes.res.body.code, 'CLOSED_PERIOD_DATE');
  assert.deepEqual(closedPeriodRes.res.body.details, {
    invoiceDateMonth: '2025-01',
    currentMonth: `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`,
    suggestedInvoiceDate: `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-01`,
    glDateMonth: '2025-01',
    suggestedGlDate: `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-01`,
    nextAction: `PATCH /api/invoices/doc-1 with invoiceDate ${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-01, then retry approve.`,
  });

  // Clean row → approve allowed; blockers empty.
  const cleanRow = completeRow({ status: 'pending' });
  const cleanState = await build(cleanRow);
  assert.deepEqual(cleanState.blockers, []);
  const cleanRes = await runApprove({ ...cleanRow });
  assert.equal(cleanRes.res.statusCode, 200, 'a clean row must be approved by the real approve mutation');

  // Effective-values persistence: approve writes EXACTLY the applied defaults
  // the verdict previewed — no more, no less.
  const partialRow = completeRow({ gl_account: null, gl_date: null, routing_code: null, status: 'pending' });
  const partialState = await build({ ...partialRow });
  assert.deepEqual(partialState.blockers, []); // defaults fill everything
  const partialRes = await runApprove(partialRow);
  assert.equal(partialRes.res.statusCode, 200);
  const codingUpdate = partialRes.calls.find((c) => /UPDATE documents/.test(c.sql) && !/status IN/.test(c.sql));
  assert.ok(codingUpdate, 'approve must persist the applied effective values in a coding UPDATE');
  assert.match(codingUpdate.sql, /gl_account =/);
  assert.match(codingUpdate.sql, /gl_date =/);
  assert.match(codingUpdate.sql, /routing_code =/);
  assert.doesNotMatch(codingUpdate.sql, /phase_code/); // row value present → untouched
  assert.doesNotMatch(codingUpdate.sql, /cost_type/);
  // BE-G: the same statement stamps derived origins for the filled defaults.
  assert.equal(codingUpdate.params.length, 5);
  assert.deepEqual(codingUpdate.params.slice(0, 3), ['5450', 'D', OPEN_DATE]);
  assert.equal(codingUpdate.params[4], 'doc-1');
  assert.match(codingUpdate.sql, /field_origins = field_origins \|\| \$4::jsonb/);
  const appliedOrigins = JSON.parse(codingUpdate.params[3]);
  assert.deepEqual(Object.keys(appliedOrigins).sort(), ['glAccount', 'glDate', 'routingCode']);
  for (const value of Object.values(appliedOrigins)) {
    assert.equal(value.origin, 'derived');
    assert.equal(value.by, 'approval-defaults');
  }
  assert.equal(partialRow.status, 'approved');

  const originalInvoiceDate = OPEN_DATE;
  const independentGlDate = '2024-12-31';
  const recoveryRow = completeRow({ invoice_date: originalInvoiceDate, gl_date: independentGlDate, status: 'pending' });
  const suggestedInvoiceDate = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-01`;
  const recoveryRes = await runApprove(recoveryRow, { invoiceDate: suggestedInvoiceDate });
  assert.equal(recoveryRes.res.statusCode, 400);
  assert.equal(recoveryRes.res.body.code, 'INVOICE_DATE_APPROVAL_OVERRIDE_UNSUPPORTED');
  assert.equal(recoveryRow.status, 'pending');
  assert.equal(recoveryRow.invoice_date, originalInvoiceDate);
  assert.equal(recoveryRow.gl_date, independentGlDate, 'independent GL metadata must remain untouched');
  assert.equal(recoveryRes.calls.filter((c) => /UPDATE documents/.test(c.sql)).length, 0);
  assert.equal(recoveryRes.legacyAudits.length, 0);
});
