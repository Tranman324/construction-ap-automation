'use strict';

// Match-time routing persistence (owner ruling 2026-07-23): routing_code =
// pm_to_routing[job PM] || 'D', written when unset, never overwritten.
// Covers deriveRoutingCode, the un-gated findSuggestedRouting, rematch's
// never-overwrite hook, and the pending-only backfill scope.

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

// Sidecar fixtures: PM 'Luke P' is mapped to 'LP'; PM 'ZZ' is unmapped; 26-430 has no PM.
const JOBS_PATH = '/fixtures/jobs.json';
const ROUTING_CODES_PATH = '/fixtures/routing-codes.json';
const SIDECARS = {
  [ROUTING_CODES_PATH]: {
    routing_codes: [{ code: 'D' }, { code: 'LP' }, { code: 'JF' }],
    pm_to_routing: { 'Luke P': 'LP', 'Stale PM': 'CB', 'Active PM': 'JF' },
  },
  [JOBS_PATH]: {
    Jobs: [
      { Job_Number: '26-413', Project_Manager: 'Luke P' },
      { Job_Number: '26-420', Project_Manager: 'ZZ' },
      { Job_Number: '26-430' },
    ],
  },
};

const sidecarMocks = {
  '../../../config': { JOBS_PATH, ROUTING_CODES_PATH },
  './utils': { readJSON: (p) => SIDECARS[p] || null },
};

// ── deriveRoutingCode: cataloged PM → JF → D ───────────────────────────────
test('deriveRoutingCode: mapped PM → cataloged routing code; job fallback → JF → D; no job → D', async () => {
  await withMockedModules(sidecarMocks, async () => {
    const { deriveRoutingCode } = freshRequire('modules/invoices/services/submitRouting.js');
    assert.equal(deriveRoutingCode('26-413'), 'LP');       // PM mapped
    assert.equal(deriveRoutingCode(' 26-413 '), 'LP');     // trimmed lookup
    assert.equal(deriveRoutingCode('26-420'), 'JF');       // PM unmapped → JF
    assert.equal(deriveRoutingCode('26-430'), 'JF');       // job has no PM → JF
    assert.equal(deriveRoutingCode('99-799'), 'JF');       // unknown job → JF
    assert.equal(deriveRoutingCode(null), 'D');            // no job → D
    assert.equal(deriveRoutingCode('  '), 'D');
  });
});

test('deriveRoutingCode falls back and warns when a PM mapping is stale in the refreshed catalog', async () => {
  SIDECARS[JOBS_PATH].Jobs.push(
    { Job_Number: '26-440', Project_Manager: 'Stale PM' },
    { Job_Number: '26-441', Project_Manager: 'Active PM' },
  );
  const warnings = [];
  try {
    await withMockedModules({
      ...sidecarMocks,
      '../../../lib/logger': { warn: (...args) => warnings.push(args) },
    }, async () => {
      const { deriveRoutingCode } = freshRequire('modules/invoices/services/submitRouting.js');
      assert.equal(deriveRoutingCode('26-440'), 'JF');
      assert.equal(deriveRoutingCode('26-441'), 'JF');
    });
  } finally {
    SIDECARS[JOBS_PATH].Jobs.splice(-2, 2);
  }
  assert.deepEqual(warnings, [[
    { jobNumber: '26-440', projectManager: 'Stale PM', staleRoutingCode: 'CB', fallbackCode: 'JF' },
    'Routing code mapping is absent from the current routing catalog; using routing fallback',
  ]]);
});

// ── findSuggestedRouting: derivation is UNCONDITIONAL on budget state ──
test('findSuggestedRouting suggests the PM code for an IN-BUDGET invoice (red-run vs old exceedsUnbilled gate)', async () => {
  await withMockedModules({ ...sidecarMocks, './supabase': {} }, async () => {
    const { findSuggestedRouting } = freshRequire('modules/invoices/services/phaseOptionsService.js');

    const inBudget = findSuggestedRouting({ amount: 50, job_match_number: '26-413' }, { unbilled: 1000 });
    assert.equal(inBudget.exceedsUnbilled, false);
    assert.equal(inBudget.suggestedRoutingCode, 'LP'); // old code returned null here
    assert.equal(inBudget.suggestedRoutingPm, 'Luke P');

    const overBudget = findSuggestedRouting({ amount: 500, job_match_number: '26-413' }, { unbilled: 100 });
    assert.equal(overBudget.exceedsUnbilled, true); // still an independent warning flag
    assert.equal(overBudget.suggestedRoutingCode, 'LP');

    const noJob = findSuggestedRouting({ amount: 50, job_match_number: null }, { unbilled: 1000 });
    assert.equal(noJob.suggestedRoutingCode, null);
  });
});

// ── rematch: routing derived on a NEW job match, never overwrites ──
function rematchRow(overrides = {}) {
  return {
    id: 'doc-1',
    vendor_code: 'V1',
    job_match_number: null,
    job_match_confidence: null,
    subcontract_number: 'SUB-1',
    routing_code: null,
    overall_confidence: 0.5,
    ...overrides,
  };
}

async function runRematch(row, matchOverrides = {}) {
  return withMockedModules({
    '../../../lib/db': { query: async () => ({ rows: [] }) },
    '../../../lib/logger': { info() {}, warn() {}, error() {}, debug() {} },
    './matcher': {
      matchInvoice: async () => ({
        vendor: { vendorCode: 'V1', confidence: 0.9, method: 'exact' },
        job: { jobNumber: '26-413', confidence: 0.95, method: 'address' },
        subcontract: { subcontractNumber: 'SUB-1', confidence: 0.9, method: 'exact' },
        overallConfidence: 0.9,
        ...matchOverrides,
      }),
    },
    './submitRouting': { deriveRoutingCode: (job) => (job ? 'LP' : null) },
  }, async () => {
    const { rematchDocument } = freshRequire('modules/invoices/services/rematch.js');
    return rematchDocument(row);
  });
}

test('rematch derives routing when a job match lands on a routing-less row', async () => {
  const { changes } = await runRematch(rematchRow());
  assert.deepEqual(changes.job_match_number, [null, '26-413']);
  assert.deepEqual(changes.routing_code, [null, 'LP']);
});

test('rematch NEVER overwrites an existing routing_code', async () => {
  const { changes } = await runRematch(rematchRow({ routing_code: 'X' }));
  assert.deepEqual(changes.job_match_number, [null, '26-413']);
  assert.equal('routing_code' in changes, false);
});

// a6bo incident red-run: matcher resolves a DIFFERENT job than the protected
// stored one — the stored job is kept AND the other job's subcontract must NOT
// be adopted (owner ruling 2026-07-23: a subcontract belongs to its job).
test('rematch never adopts the subcontract half of a match pair whose job half was rejected', async () => {
  const row = rematchRow({ job_match_number: '26-402', job_match_confidence: '0.98', subcontract_number: null });
  const { changes } = await runRematch(row, {
    job: { jobNumber: '26-447', confidence: 0.95, method: 'address' },
    subcontract: { subcontractNumber: '26-447.11', confidence: 0.99, method: 'cache' },
  });
  assert.equal('job_match_number' in changes, false);   // stored job protected
  assert.equal('subcontract_number' in changes, false); // cross-job sub blocked
});

test('rematch applies job AND its subcontract together when the pair agrees', async () => {
  const row = rematchRow({ subcontract_number: null });
  const { changes } = await runRematch(row, {
    subcontract: { subcontractNumber: '26-413.05', confidence: 0.99, method: 'cache' },
  });
  assert.deepEqual(changes.job_match_number, [null, '26-413']);
  assert.deepEqual(changes.subcontract_number, [null, '26-413.05']);
});

test('rematch fills a subcontract on an unchanged job only when the match ran on that same job', async () => {
  const row = rematchRow({ job_match_number: '26-413', job_match_confidence: '0.99', subcontract_number: null });
  const { changes } = await runRematch(row, {
    subcontract: { subcontractNumber: '26-413.05', confidence: 0.99, method: 'cache' },
  });
  assert.equal('job_match_number' in changes, false);
  assert.deepEqual(changes.subcontract_number, [null, '26-413.05']);
});

// ── rematch: multi-phase candidacy travels with an adopted subcontract ──
async function runRematchWithPhases(row, matchOverrides, phaseInfoBySub) {
  return withMockedModules({
    '../../../lib/db': { query: async () => ({ rows: [] }) },
    '../../../lib/logger': { info() {}, warn() {}, error() {}, debug() {} },
    './matcher': {
      matchInvoice: async () => ({
        vendor: { vendorCode: 'V1', confidence: 0.9, method: 'exact' },
        job: { jobNumber: '26-413', confidence: 0.95, method: 'address' },
        subcontract: { subcontractNumber: 'SUB-1', confidence: 0.9, method: 'exact' },
        overallConfidence: 0.9,
        ...matchOverrides,
      }),
      getSubcontractPhaseInfo: (sub) => phaseInfoBySub[sub] || null,
    },
    './submitRouting': { deriveRoutingCode: (job) => (job ? 'LP' : null) },
  }, async () => {
    const { rematchDocument } = freshRequire('modules/invoices/services/rematch.js');
    return rematchDocument(row);
  });
}

test('rematch flags multi_phase_candidate when adopting a multi-phase subcontract (red-run: pipeline only flags at intake)', async () => {
  const row = rematchRow({ subcontract_number: null, multi_phase_candidate: false });
  const { changes } = await runRematchWithPhases(row, {
    subcontract: { subcontractNumber: '26-413.05', confidence: 0.99, method: 'cache' },
  }, { '26-413.05': { isMultiPhase: true } });
  assert.deepEqual(changes.subcontract_number, [null, '26-413.05']);
  assert.deepEqual(changes.multi_phase_candidate, [false, true]);
});

test('rematch adopting a single-phase subcontract leaves an already-false flag untouched', async () => {
  const row = rematchRow({ subcontract_number: null, multi_phase_candidate: false });
  const { changes } = await runRematchWithPhases(row, {
    subcontract: { subcontractNumber: '26-413.05', confidence: 0.99, method: 'cache' },
  }, { '26-413.05': { isMultiPhase: false } });
  assert.deepEqual(changes.subcontract_number, [null, '26-413.05']);
  assert.equal('multi_phase_candidate' in changes, false);
});

test('rematch does not touch routing when the job match itself did not change', async () => {
  const { changes } = await runRematch(rematchRow({ job_match_number: '26-413', job_match_confidence: '0.99' }));
  assert.equal('job_match_number' in changes, false);
  assert.equal('routing_code' in changes, false);
});

// ── backfill: pending-only scope, re-guarded UPDATE, system audit actor ──
function makeBackfillDb(selectRows, { updateRowCount = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^\s*SELECT/i.test(sql)) return { rows: selectRows };
      if (/UPDATE documents/.test(sql)) return { rows: [], rowCount: updateRowCount };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

async function runBackfill(db, opts = {}) {
  return withMockedModules({
    '../../../lib/logger': { info() {}, warn() {}, error() {}, debug() {} },
    './submitRouting': { deriveRoutingCode: (job) => (job ? 'LP' : null) },
  }, async () => {
    const { backfillRoutingCodes } = freshRequire('modules/invoices/scripts/backfill-routing-codes.js');
    return backfillRoutingCodes({ db, ...opts });
  });
}

test('backfill SELECT scope is pending-only, job-matched, routing-null, not deleted', async () => {
  const db = makeBackfillDb([]);
  const summary = await runBackfill(db);
  const select = db.calls[0].sql;
  assert.match(select, /status = 'pending'/);
  assert.match(select, /deleted_at IS NULL/);
  assert.match(select, /job_match_number IS NOT NULL/);
  assert.match(select, /routing_code IS NULL OR btrim\(routing_code\) = ''/);
  assert.equal(summary.total, 0);
});

test('backfill apply: re-guarded UPDATE (pending + routing still null) and a system-actor audit entry', async () => {
  const db = makeBackfillDb([{ id: 'doc-1', job_match_number: '26-413', routing_code: null }]);
  const summary = await runBackfill(db);

  assert.equal(summary.updated, 1);
  const update = db.calls.find((c) => /UPDATE documents/.test(c.sql));
  assert.match(update.sql, /status = 'pending'/); // red-run: non-pending can never be written
  assert.match(update.sql, /routing_code IS NULL OR btrim\(routing_code\) = ''/);
  // Job-race guard: the UPDATE re-checks the job the routing was derived FROM,
  // so a row unmatched/rematched between SELECT and UPDATE falls to rowCount 0.
  assert.match(update.sql, /job_match_number = \$3/);
  assert.deepEqual(update.params, ['LP', 'doc-1', '26-413']);

  const audit = db.calls.find((c) => /INSERT INTO audit_log/.test(c.sql));
  assert.equal(audit.params[0], 'doc-1');
  assert.equal(audit.params[1], 'routing_backfilled');
  assert.equal(audit.params[2], 'system');
  assert.deepEqual(JSON.parse(audit.params[3]).routing_code, [null, 'LP']);
});

test('backfill dry-run issues no writes', async () => {
  const db = makeBackfillDb([{ id: 'doc-1', job_match_number: '26-413', routing_code: null }]);
  const summary = await runBackfill(db, { dryRun: true });
  assert.equal(summary.updated, 1); // reported as would-update
  assert.equal(db.calls.filter((c) => /UPDATE|INSERT/.test(c.sql)).length, 0);
});

test('backfill skips (no audit) when the guarded UPDATE matches nothing — row changed concurrently', async () => {
  const db = makeBackfillDb([{ id: 'doc-1', job_match_number: '26-413', routing_code: null }], { updateRowCount: 0 });
  const summary = await runBackfill(db);
  assert.equal(summary.updated, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(db.calls.filter((c) => /INSERT INTO audit_log/.test(c.sql)).length, 0);
  assert.deepEqual(summary.details, []);
});

test('backfill job-race red-run: a row rematched to a different job after SELECT never receives the stale routing', async () => {
  // Simulate the race: DB row now carries a DIFFERENT job than the SELECT saw.
  // The UPDATE's `job_match_number = $3` guard (bound to the derived-from job)
  // must miss, producing a skip with no audit entry.
  const calls = [];
  const db = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^\s*SELECT/i.test(sql)) return { rows: [{ id: 'doc-1', job_match_number: '26-413', routing_code: null }] };
      if (/UPDATE documents/.test(sql)) {
        const currentJob = '26-499'; // rematched between SELECT and UPDATE
        const guardHolds = params[2] === currentJob;
        return { rows: [], rowCount: guardHolds ? 1 : 0 };
      }
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const summary = await runBackfill(db);
  assert.equal(summary.updated, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(calls.filter((c) => /INSERT INTO audit_log/.test(c.sql)).length, 0);
});
