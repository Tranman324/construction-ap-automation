'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calendarMonthKey,
  formatMissing,
  getApprovalPath,
  getClosedPeriodInfo,
  hasValue,
  validateApproval,
  validateApprovalEligibility,
} = require('../../modules/invoices/services/approvalValidator');

// W7: approval is closed-period gated (only the current calendar month is
// open), so fixture dates must live in the current month.
const CURRENT_MONTH = calendarMonthKey(new Date());
const OPEN_DATE = `${CURRENT_MONTH}-01`;

function approvalRow(overrides = {}) {
  return {
    invoice_number: 'INV-100',
    vendor_code: 'ZVEN91',
    invoice_date: OPEN_DATE,
    gl_date: OPEN_DATE,
    amount: 100,
    job_match_number: '25-401',
    subcontract_number: 'SC-001',
    phase_code: '0100',
    cost_type: 'S',
    gl_account: '5450',
    routing_code: null,
    multi_phase_candidate: false,
    phase_allocations: null,
    ...overrides,
  };
}

test('within-budget subcontract path is valid and auto-routes to AP default', () => {
  const result = validateApproval(approvalRow(), { unbilledBalance: 150 });

  assert.equal(result.path, '1');
  assert.equal(result.isValid, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.autoRouting, true);
  assert.equal(result.autoRoutingCode, 'D');
  assert.equal(result.approvalStatus, 'A');
});

test('over-budget subcontract path requires explicit routing behavior', () => {
  const result = validateApproval(approvalRow({ amount: 250 }), { unbilledBalance: 100 });

  assert.equal(result.path, '2');
  assert.equal(result.isValid, false);
  assert.deepEqual(result.missing, ['routing_code']);
  assert.equal(result.autoRouting, false);
  assert.equal(result.approvalStatus, 'U');
});

test('job without subcontract follows PM routing path', () => {
  const result = validateApproval(approvalRow({
    subcontract_number: null,
    routing_code: '',
  }), { unbilledBalance: null });

  assert.equal(result.path, '2');
  assert.deepEqual(result.missing, ['routing_code']);
});

test('no-job path validates SG&A fields without job or routing', () => {
  const result = validateApproval(approvalRow({
    job_match_number: null,
    subcontract_number: null,
    phase_code: null,
    cost_type: null,
    routing_code: null,
  }), { unbilledBalance: null });

  assert.equal(result.path, '3');
  assert.equal(result.isValid, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.autoRouting, true);
  assert.equal(result.approvalStatus, 'U');
});

test('multi-phase allocations skip document-level phase and cost fields', () => {
  const result = validateApproval(approvalRow({
    phase_code: null,
    cost_type: null,
    multi_phase_candidate: true,
    phase_allocations: JSON.stringify([
      { phase_code: '0100', cost_type: 'S', amount: 60 },
      { phase_code: '0200', cost_type: 'S', amount: 40 },
    ]),
  }), { unbilledBalance: 150 });

  assert.equal(result.path, '1');
  assert.equal(result.isMultiPhaseAllocated, true);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.missing, []);
});

test('blank strings and missing required fields are reported with labels', () => {
  const result = validateApproval(approvalRow({
    invoice_number: '   ',
    vendor_code: null,
    gl_account: undefined,
  }), { unbilledBalance: 150 });

  assert.equal(result.isValid, false);
  assert.deepEqual(result.missing, ['invoice_number', 'vendor_code', 'gl_account']);
  assert.equal(formatMissing(result.missing), 'Invoice Number, Vendor, GL Account');
});

test('zero values are present for required-field validation', () => {
  assert.equal(hasValue(0), true);
  assert.equal(hasValue('0'), true);

  const result = validateApproval(approvalRow({
    amount: 0,
    job_match_number: null,
    subcontract_number: null,
    phase_code: null,
    cost_type: null,
  }), { unbilledBalance: null });

  assert.equal(result.path, '3');
  assert.equal(result.isValid, true);
  assert.deepEqual(result.missing, []);
});

test('lien waiver gate respects the persistent bypass flag', () => {
  // Job-coded row with no subcontract (avoids the subcontract-map lookup),
  // routing set so only the waiver gate is in play. cost_type L avoids the
  // cost-type/GL pairing check.
  const waiverRow = (overrides = {}) => approvalRow({
    subcontract_number: null,
    routing_code: 'PM1',
    cost_type: 'L',
    lien_waiver_required: true,
    linked_lien_waiver_id: null,
    lien_waiver_status: 'missing',
    waiver_on_document: false,
    ...overrides,
  });

  // Required + not bypassed → blocked on linked_lien_waiver_id
  const blocked = validateApprovalEligibility(waiverRow());
  assert.ok(Array.isArray(blocked.missing));
  assert.ok(blocked.missing.includes('linked_lien_waiver_id'));

  // Required + bypassed → waiver gate cleared
  const bypassed = validateApprovalEligibility(waiverRow({ waiver_bypassed: true }));
  assert.equal(bypassed.error, undefined);
  assert.equal(bypassed.approvalPath, '2');

  // Bypass revert (explicit false) → gate re-armed
  const reverted = validateApprovalEligibility(waiverRow({ waiver_bypassed: false }));
  assert.ok(reverted.missing.includes('linked_lien_waiver_id'));
});

test('W7: closed-period gate blocks canonical invoice dates and dual-emits recovery fields', () => {
  // Any prior month is closed (server time). Use a definitively past date.
  const closed = validateApprovalEligibility(approvalRow({
    subcontract_number: null,
    routing_code: 'PM1',
    cost_type: 'L',
    invoice_date: '2024-01-15',
    gl_date: OPEN_DATE,
  }), { invoiceId: 'doc-7', closedPeriodDateSource: 'invoice' });
  assert.equal(closed.code, 'CLOSED_PERIOD_DATE');
  assert.equal(closed.invoiceDateMonth, '2024-01');
  assert.equal(closed.glDateMonth, '2024-01');
  assert.equal(closed.currentMonth, CURRENT_MONTH);
  assert.equal(closed.suggestedInvoiceDate, `${CURRENT_MONTH}-01`);
  assert.equal(closed.suggestedGlDate, `${CURRENT_MONTH}-01`);
  assert.match(closed.nextAction, /doc-7/);
  assert.match(closed.error, /closed period/i);

  // Future months are equally closed — only the current month is open.
  const future = validateApprovalEligibility(approvalRow({
    subcontract_number: null,
    routing_code: 'PM1',
    cost_type: 'L',
    invoice_date: '2099-12-01',
    gl_date: OPEN_DATE,
  }), { closedPeriodDateSource: 'invoice' });
  assert.equal(future.code, 'CLOSED_PERIOD_DATE');
});

test('W7: current-month invoice dates pass; independent GL metadata does not replace them', () => {
  const open = validateApprovalEligibility(approvalRow({
    subcontract_number: null,
    routing_code: 'PM1',
    cost_type: 'L',
  }), { closedPeriodDateSource: 'invoice' });
  assert.equal(open.error, undefined);

  // No gl_date still leaves the canonical invoice-date gate authoritative.
  const fallbackBlocked = validateApprovalEligibility(approvalRow({
    subcontract_number: null,
    routing_code: 'PM1',
    cost_type: 'L',
    gl_date: null,
    invoice_date: '2024-01-15',
  }), { closedPeriodDateSource: 'invoice' });
  assert.equal(fallbackBlocked.code, 'CLOSED_PERIOD_DATE');

  const fallbackOpen = validateApprovalEligibility(approvalRow({
    subcontract_number: null,
    routing_code: 'PM1',
    cost_type: 'L',
    gl_date: null,
  }), { closedPeriodDateSource: 'invoice' });
  // gl_date may still be reported missing by field rules — a current-month
  // invoice_date never trips the closed-period gate.
  assert.notEqual(fallbackOpen.code, 'CLOSED_PERIOD_DATE');
});

test('W7: month-boundary edges — first/last day of current month open, adjacent months closed', () => {
  const now = new Date(2026, 7, 26); // 2026-08-26 local
  assert.equal(getClosedPeriodInfo('2026-08-01', now), null);
  assert.equal(getClosedPeriodInfo('2026-08-31', now), null);
  assert.equal(getClosedPeriodInfo('2026-07-31', now).monthKey, '2026-07');
  assert.equal(getClosedPeriodInfo('2026-09-01', now).monthKey, '2026-09');
  assert.equal(getClosedPeriodInfo('2026-07-31', now).suggestedInvoiceDate, '2026-08-01');
  // No date at all → the gate stays out of the way (missing-field rules own it).
  assert.equal(getClosedPeriodInfo(null, now), null);
  assert.equal(getClosedPeriodInfo('', now), null);
});

test('W7: calendarMonthKey handles pg string and Date shapes without timezone drift', () => {
  assert.equal(calendarMonthKey('2026-08-26'), '2026-08');
  assert.equal(calendarMonthKey('2026-08-26T00:00:00.000Z'), '2026-08');
  // node-postgres parses DATE columns to LOCAL midnight — local getters keep
  // the stored calendar date regardless of server offset.
  assert.equal(calendarMonthKey(new Date(2026, 7, 1)), '2026-08');
  assert.equal(calendarMonthKey(new Date(2026, 11, 31)), '2026-12');
  assert.equal(calendarMonthKey('not-a-date'), null);
  assert.equal(calendarMonthKey(null), null);
});

test('approval path helper distinguishes normal, PM, and no-job paths', () => {
  assert.equal(getApprovalPath({
    jobNumber: '25-401',
    subcontractNumber: 'SC-001',
    amount: 100,
    unbilledBalance: 100,
  }), '1');
  assert.equal(getApprovalPath({
    jobNumber: '25-401',
    subcontractNumber: 'SC-001',
    amount: 101,
    unbilledBalance: 100,
  }), '2');
  assert.equal(getApprovalPath({
    jobNumber: null,
    subcontractNumber: null,
    amount: 100,
    unbilledBalance: null,
  }), '3');
});
