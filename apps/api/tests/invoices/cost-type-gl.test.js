'use strict';

// B2 (2026-07-24): cost-type-aware GL coding. Spectrum's JC_COST_TYPE_MASTER
// (NCG) pins each job cost type to one distribution GL account and hard-rejects
// mismatches ("Cost type does not match distribution G/L account" — real case:
// dprj, cost type M with GL 5500). The map lives in approvalRules.json
// codingDefaults.costTypeGlMap; approval blocks mismatches, pre-fill and the
// submit payload derive GL from the cost type.

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key';

const {
  calendarMonthKey,
  glAccountForCostType,
  validateApprovalEligibility,
} = require('../../modules/invoices/services/approvalValidator');

// W7: only the current calendar month is an open period — fixture dates must
// track it or the closed-period gate fires before the checks under test.
const OPEN_DATE = `${calendarMonthKey(new Date())}-01`;
const rules = require('../../modules/invoices/services/approvalRules.json');
const contract = require('../../../../test-fixtures/invoices/cost-type-gl-contract.json');

function renderMismatchMessage(template, values) {
  return template
    .replace('{costType}', values.costType)
    .replace('{expectedGl}', values.expectedGl)
    .replace('{actualGl}', values.actualGl);
}

// --- the map itself ---

test('costTypeGlMap carries the NCG JC_COST_TYPE_MASTER pairs', () => {
  assert.deepEqual(rules.codingDefaults.costTypeGlMap.map, contract.pairs);
});

test('glAccountForCostType resolves known types, trims and upcases', () => {
  assert.equal(glAccountForCostType('S'), contract.pairs.S);
  assert.equal(glAccountForCostType('M'), contract.pairs.M);
  assert.equal(glAccountForCostType('E'), contract.pairs.E);
  assert.equal(glAccountForCostType(' m '), contract.pairs.M);
});

test('glAccountForCostType returns null for L, unknown, and blank input', () => {
  assert.equal(glAccountForCostType('L'), null); // no GL in the master
  assert.equal(glAccountForCostType('Z'), null);
  assert.equal(glAccountForCostType(''), null);
  assert.equal(glAccountForCostType(null), null);
});

// --- approval-time mismatch blocker (dprj regression) ---

function row(overrides = {}) {
  return {
    invoice_number: 'INV-1',
    vendor_code: 'ZVEN91',
    invoice_date: OPEN_DATE,
    gl_date: OPEN_DATE,
    amount: 100,
    job_match_number: '26-434',
    subcontract_number: null,
    phase_code: '01503',
    cost_type: 'M',
    gl_account: contract.pairs.M,
    routing_code: 'D',
    multi_phase_candidate: false,
    phase_allocations: null,
    ...overrides,
  };
}

test('validator mismatch code and message exactly match the shared contract', () => {
  const example = contract.mismatch.example;
  assert.equal(
    renderMismatchMessage(contract.mismatch.messageTemplate, example),
    example.message,
  );

  const result = validateApprovalEligibility(row({
    cost_type: example.costType,
    gl_account: example.actualGl,
  }), { invoiceId: 'doc-1' });
  assert.equal(result.code, contract.mismatch.code);
  assert.equal(result.error, example.message);
  assert.equal(result.expectedGlAccount, example.expectedGl);
  assert.match(result.nextAction, /doc-1/);
});

test('a matched cost-type/GL pair passes the mismatch gate', () => {
  const result = validateApprovalEligibility(row(), {});
  assert.notEqual(result.code, 'COST_TYPE_GL_MISMATCH');
  assert.equal(result.error, undefined);
});

test('no-job (SG&A) invoices are exempt — any GL is allowed', () => {
  const result = validateApprovalEligibility(row({
    job_match_number: null, phase_code: null, cost_type: 'M', gl_account: '6100',
  }), {});
  assert.notEqual(result.code, 'COST_TYPE_GL_MISMATCH');
});

test('unmapped cost type L is exempt from the mismatch gate', () => {
  const result = validateApprovalEligibility(row({ cost_type: 'L', gl_account: '5500' }), {});
  assert.notEqual(result.code, 'COST_TYPE_GL_MISMATCH');
});

test('multi-phase allocated rows skip the doc-level mismatch gate', () => {
  const result = validateApprovalEligibility(row({
    gl_account: '5500',
    multi_phase_candidate: true,
    phase_allocations: JSON.stringify([{ phase_code: '01503', cost_type: 'M', amount: 100 }]),
  }), {});
  assert.notEqual(result.code, 'COST_TYPE_GL_MISMATCH');
});
