'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { validateApprovalEligibility } = require('../../modules/invoices/services/approvalValidator');

const approvableRow = {
  status: 'pending',
  vendor_code: 'VANT01',
  invoice_number: '53477',
  amount: '100',
  invoice_date: new Date().toISOString().slice(0, 8) + '01',
  multi_phase_candidate: false,
};

test('unresolved spectrum duplicate blocks approval with structured code', () => {
  const result = validateApprovalEligibility(approvableRow, {
    invoiceId: 'doc-1',
    closedPeriodDateSource: 'invoice',
    duplicateStatus: {
      state: 'spectrum',
      spectrum: { source: 'OPEN_ITEMS', invoiceNumber: '53477', amount: 74877 },
      original: null,
      evidence: { normalizedInvoiceNumber: '53477' },
    },
  });
  assert.equal(result.code, 'DUPLICATE_UNRESOLVED');
  assert.equal(result.duplicateState, 'spectrum');
  assert.match(result.error, /posted in Spectrum/);
  assert.match(result.nextAction, /duplicate-bypass/);
});

test('toolbox and stale duplicates block with state-specific copy', () => {
  const toolbox = validateApprovalEligibility(approvableRow, {
    duplicateStatus: { state: 'toolbox', original: { id: 'doc-orig' }, evidence: {} },
  });
  assert.equal(toolbox.code, 'DUPLICATE_UNRESOLVED');
  assert.match(toolbox.error, /doc-orig/);

  const stale = validateApprovalEligibility(approvableRow, {
    duplicateStatus: { state: 'stale', original: null, evidence: {} },
  });
  assert.equal(stale.code, 'DUPLICATE_UNRESOLVED');
  assert.match(stale.error, /discarded copy/);
});

test('state none and absent duplicateStatus do not block', () => {
  const withNone = validateApprovalEligibility(approvableRow, {
    duplicateStatus: { state: 'none', spectrum: null, original: null, evidence: null },
  });
  assert.notEqual(withNone.code, 'DUPLICATE_UNRESOLVED');

  const without = validateApprovalEligibility(approvableRow, {});
  assert.notEqual(without.code, 'DUPLICATE_UNRESOLVED');
});

test('duplicate blocker takes precedence over later eligibility checks', () => {
  const multiPhaseRow = { ...approvableRow, multi_phase_candidate: true, phase_allocations: null };
  const result = validateApprovalEligibility(multiPhaseRow, {
    duplicateStatus: { state: 'toolbox', original: { id: 'doc-orig' }, evidence: {} },
  });
  assert.equal(result.code, 'DUPLICATE_UNRESOLVED');
});
