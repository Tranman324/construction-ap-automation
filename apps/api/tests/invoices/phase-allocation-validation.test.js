'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const { assertCanonicalErrorBody } = require('../helpers/assertCanonicalErrorResponse');

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
    json(body) {
      if (this.statusCode >= 400) assertCanonicalErrorBody(body);
      this.body = body;
      return this;
    },
  };
}

const PHASE_INFO = {
  phases: [
    { phase_code: '01-100', cost_type: 'S', description: 'Framing' },
    { phase_code: '02-200', cost_type: 'M', description: 'Materials' },
  ],
};

// Fake pool with no connect() → withTransaction runs work(pool) directly.
function makePool(row) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push({ sql });
      if (/FOR UPDATE/.test(sql)) return { rows: [row] };
      return { rows: [], rowCount: 1 };
    },
    allocationWrites() {
      return this.calls.filter((c) => /UPDATE documents\s+SET phase_allocations/.test(c.sql));
    },
  };
}

async function runUpdate(row, allocations) {
  const pool = makePool(row);
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool, audit: async () => {}, rowToDoc: (v) => v },
    './matcher': { getSubcontractPhaseInfo: () => PHASE_INFO },
    '../../../middleware/errorResponse': require('../../middleware/errorResponse'),
  }, async () => {
    const svc = freshRequire('modules/invoices/services/phaseAllocationService.js');
    await svc.updatePhaseAllocations({ params: { id: row.id }, body: { allocations } }, res);
  });
  return { pool, res };
}

const baseRow = () => ({ id: 'doc-1', subcontract_number: 'SUB-1', amount: 1000, multi_phase_candidate: true });

test('over-allocation beyond tolerance → 422 with total detail, no write', async () => {
  const { pool, res } = await runUpdate(baseRow(), [
    { phase_code: '01-100', amount: 600 },
    { phase_code: '02-200', amount: 600 }, // sum 1200 vs 1000
  ]);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'INVALID_PHASE_ALLOCATION');
  assert.match(res.body.details.total, /must equal invoice total/);
  assert.equal(pool.allocationWrites().length, 0); // row unchanged
});

test('under-allocation beyond tolerance → 422, no write', async () => {
  const { pool, res } = await runUpdate(baseRow(), [
    { phase_code: '01-100', amount: 400 },
    { phase_code: '02-200', amount: 400 }, // sum 800 vs 1000
  ]);
  assert.equal(res.statusCode, 422);
  assert.ok(res.body.details.total);
  assert.equal(pool.allocationWrites().length, 0);
});

test('negative/zero line → 422 with per-line detail, no write', async () => {
  const { pool, res } = await runUpdate(baseRow(), [
    { phase_code: '01-100', amount: -100 },
    { phase_code: '02-200', amount: 1100 },
  ]);
  assert.equal(res.statusCode, 422);
  assert.ok(Array.isArray(res.body.details.lines));
  assert.ok(res.body.details.lines.some((l) => l.line === 1 && /positive/.test(l.error)));
  assert.equal(pool.allocationWrites().length, 0);
});

test('unknown phase → 422 per-line, no write', async () => {
  const { pool, res } = await runUpdate(baseRow(), [{ phase_code: '99-799', amount: 1000 }]);
  assert.equal(res.statusCode, 422);
  assert.ok(res.body.details.lines.some((l) => /not on subcontract/.test(l.error)));
  assert.equal(pool.allocationWrites().length, 0);
});

test('duplicate phase → 422 per-line, no write', async () => {
  const { pool, res } = await runUpdate(baseRow(), [
    { phase_code: '01-100', amount: 500 },
    { phase_code: '01-100', amount: 500 },
  ]);
  assert.equal(res.statusCode, 422);
  assert.ok(res.body.details.lines.some((l) => /more than once/.test(l.error)));
  assert.equal(pool.allocationWrites().length, 0);
});

test('a valid, balanced allocation persists atomically (200, one write)', async () => {
  const { pool, res } = await runUpdate(baseRow(), [
    { phase_code: '01-100', amount: 600 },
    { phase_code: '02-200', amount: 400 }, // sum 1000 == 1000
  ]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.allocationTotal, 1000);
  assert.equal(res.body.phaseAllocations.length, 2);
  assert.equal(pool.allocationWrites().length, 1);
  // The write is predicated on a FOR UPDATE locked read.
  assert.ok(pool.calls.some((c) => /FOR UPDATE/.test(c.sql)));
});

// ── clear path recomputes multi_phase_candidate from the sub's real phase
// count (save forces the flag true; clearing on a single-phase sub must not
// strand the row as flag=true + no allocations = permanent approval blocker) ──
async function runClear(row, { isMultiPhase }) {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FOR UPDATE/.test(sql)) return { rows: [row] };
      return { rows: [], rowCount: 1 };
    },
  };
  const res = makeRes();
  await withMockedModules({
    './supabase': { pool, audit: async () => {}, rowToDoc: (v) => v },
    './matcher': { getSubcontractPhaseInfo: () => ({ ...PHASE_INFO, isMultiPhase }) },
    '../../../middleware/errorResponse': require('../../middleware/errorResponse'),
  }, async () => {
    const svc = freshRequire('modules/invoices/services/phaseAllocationService.js');
    await svc.updatePhaseAllocations({ params: { id: row.id }, body: { allocations: null } }, res);
  });
  return { calls, res };
}

test('clearing allocations on a single-phase sub resets multi_phase_candidate to false', async () => {
  const { calls, res } = await runClear(baseRow(), { isMultiPhase: false });
  assert.equal(res.statusCode, 200);
  const update = calls.find((c) => /UPDATE documents SET phase_allocations = NULL/.test(c.sql));
  assert.match(update.sql, /multi_phase_candidate = \$2/);
  assert.deepEqual(update.params, ['doc-1', false]);
});

test('clearing allocations on a multi-phase sub keeps the flag true (allocation still required)', async () => {
  const { calls } = await runClear(baseRow(), { isMultiPhase: true });
  const update = calls.find((c) => /UPDATE documents SET phase_allocations = NULL/.test(c.sql));
  assert.deepEqual(update.params, ['doc-1', true]);
});

test('the locked read happens before the write (chokepoint ordering)', async () => {
  const { pool } = await runUpdate(baseRow(), [
    { phase_code: '01-100', amount: 600 },
    { phase_code: '02-200', amount: 400 },
  ]);
  const forUpdateIdx = pool.calls.findIndex((c) => /FOR UPDATE/.test(c.sql));
  const writeIdx = pool.calls.findIndex((c) => /UPDATE documents\s+SET phase_allocations/.test(c.sql));
  assert.ok(forUpdateIdx >= 0 && writeIdx > forUpdateIdx);
});
