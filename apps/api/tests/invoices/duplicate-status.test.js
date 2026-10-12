'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  evaluateDuplicateStatus,
  buildDuplicateDiscardReason,
  normalizeInvoiceNumber,
} = require('../../modules/invoices/services/duplicateStatusService');

function makeDb({ original = null, bypassAudit = null, discardAudit = null } = {}) {
  return {
    async query(sql, params) {
      if (/FROM documents WHERE id/.test(sql)) {
        return { rows: original ? [original] : [] };
      }
      if (/duplicate-bypass-set/.test(sql)) {
        return { rows: bypassAudit ? [{ changes: bypassAudit }] : [] };
      }
      if (/FROM audit_log/.test(sql)) {
        return { rows: discardAudit ? [{ created_at: discardAudit }] : [] };
      }
      throw new Error(`Unexpected query: ${sql} ${params}`);
    },
  };
}

const baseRow = {
  id: 'doc-dup-1',
  status: 'pending',
  invoice_number: '53-477',
  vendor_code: 'VANT01',
  amount: '74877',
  duplicate_of: null,
  duplicate_bypassed: false,
};

test('normalization matches pipeline findDuplicate semantics', () => {
  assert.equal(normalizeInvoiceNumber('53-477'), '53477');
  assert.equal(normalizeInvoiceNumber('26-6150 01.a'), '26615001A');
  assert.equal(normalizeInvoiceNumber(null), '');
});

test('state none: no signal anywhere', async () => {
  const result = await evaluateDuplicateStatus({ ...baseRow }, {
    db: makeDb(),
    findSpectrum: async () => null,
  });
  assert.equal(result.state, 'none');
  assert.equal(result.evidence, null);
});

test('state spectrum: live hit wins regardless of duplicate_of', async () => {
  const result = await evaluateDuplicateStatus({ ...baseRow }, {
    db: makeDb(),
    findSpectrum: async () => ({ source: 'OPEN_ITEMS', invoiceNumber: '53477', vendorCode: 'VANT01', amount: 74877 }),
  });
  assert.equal(result.state, 'spectrum');
  assert.equal(result.spectrum.source, 'OPEN_ITEMS');
  assert.equal(result.evidence.normalizedInvoiceNumber, '53477');
});

test('precedence: spectrum wins when duplicate_of is also set', async () => {
  const original = { id: 'doc-orig', status: 'pending', amount: '74877', invoice_number: '53477', vendor_code: 'VANT01', file_name: 'orig.pdf' };
  const result = await evaluateDuplicateStatus({ ...baseRow, duplicate_of: 'doc-orig' }, {
    db: makeDb({ original }),
    findSpectrum: async () => ({ source: 'APPROVAL', invoiceNumber: '53477', vendorCode: 'VANT01', amount: 74877 }),
  });
  assert.equal(result.state, 'spectrum');
  assert.equal(result.original.id, 'doc-orig');
});

test('state toolbox: original exists, not in Spectrum', async () => {
  const original = { id: 'doc-orig', status: 'pending', amount: '100', invoice_number: '53477', vendor_code: 'VANT01', file_name: 'orig.pdf' };
  const result = await evaluateDuplicateStatus({ ...baseRow, duplicate_of: 'doc-orig' }, {
    db: makeDb({ original }),
    findSpectrum: async () => null,
  });
  assert.equal(result.state, 'toolbox');
  assert.equal(result.original.amount, 100);
});

test('submitted original elevates to spectrum state', async () => {
  const original = { id: 'doc-orig', status: 'submitted', amount: '74877', invoice_number: '53477', vendor_code: 'VANT01', file_name: 'orig.pdf' };
  const result = await evaluateDuplicateStatus({ ...baseRow, duplicate_of: 'doc-orig' }, {
    db: makeDb({ original }),
    findSpectrum: async () => null,
  });
  assert.equal(result.state, 'spectrum');
  assert.equal(result.spectrum, null);
  assert.equal(result.original.status, 'submitted');
});

test('state stale: original purged, discard date from audit_log', async () => {
  const result = await evaluateDuplicateStatus({ ...baseRow, duplicate_of: 'doc-gone' }, {
    db: makeDb({ discardAudit: '2026-09-01T12:00:00Z' }),
    findSpectrum: async () => null,
  });
  assert.equal(result.state, 'stale');
  assert.equal(result.original, null);
  assert.equal(result.evidence.originalDiscardedAt, '2026-09-01T12:00:00Z');
});

test('spectrum-down fail-open degrades to toolbox, never throws', async () => {
  const original = { id: 'doc-orig', status: 'pending', amount: '100', invoice_number: '53477', vendor_code: 'VANT01', file_name: 'orig.pdf' };
  // findSpectrumInvoice itself fails open to null on MSSQL errors; simulate that contract.
  const result = await evaluateDuplicateStatus({ ...baseRow, duplicate_of: 'doc-orig' }, {
    db: makeDb({ original }),
    findSpectrum: async () => null,
  });
  assert.equal(result.state, 'toolbox');
});

test('discarded and duplicate-status rows always evaluate none', async () => {
  for (const status of ['discarded', 'duplicate']) {
    const result = await evaluateDuplicateStatus({ ...baseRow, status, duplicate_of: 'doc-orig' }, {
      db: makeDb(),
      findSpectrum: async () => { throw new Error('must not be called'); },
    });
    assert.equal(result.state, 'none');
  }
});

test('bypass with matching evidence snapshot resolves to none', async () => {
  const original = { id: 'doc-orig', status: 'pending', amount: '100', invoice_number: '53477', vendor_code: 'VANT01', file_name: 'orig.pdf' };
  const result = await evaluateDuplicateStatus({
    ...baseRow,
    duplicate_of: 'doc-orig',
    duplicate_bypassed: true,
    duplicate_bypassed_at: '2026-09-09T00:00:00Z',
    duplicate_bypassed_by: 'alex@northwindcg.example',
  }, {
    db: makeDb({ original, bypassAudit: { evidence: { duplicateOf: 'doc-orig', vendorCode: 'VANT01', normalizedInvoiceNumber: '53477' } } }),
    findSpectrum: async () => null,
  });
  assert.equal(result.state, 'none');
  assert.equal(result.bypassed.by, 'alex@northwindcg.example');
});

test('bypass does NOT cover a NEW distinct match', async () => {
  const original = { id: 'doc-new-orig', status: 'pending', amount: '100', invoice_number: '99999', vendor_code: 'VANT01', file_name: 'new.pdf' };
  const result = await evaluateDuplicateStatus({
    ...baseRow,
    duplicate_of: 'doc-new-orig',
    duplicate_bypassed: true,
  }, {
    db: makeDb({ original, bypassAudit: { evidence: { duplicateOf: 'doc-old-orig', vendorCode: 'VANT01', normalizedInvoiceNumber: '53477' } } }),
    findSpectrum: async () => null,
  });
  assert.equal(result.state, 'toolbox');
  assert.equal(result.original.id, 'doc-new-orig');
});

test('bypass with missing snapshot fails closed to same-match (stays bypassed)', async () => {
  const original = { id: 'doc-orig', status: 'pending', amount: '100', invoice_number: '53477', vendor_code: 'VANT01', file_name: 'orig.pdf' };
  const result = await evaluateDuplicateStatus({
    ...baseRow,
    duplicate_of: 'doc-orig',
    duplicate_bypassed: true,
  }, {
    db: makeDb({ original }),
    findSpectrum: async () => null,
  });
  assert.equal(result.state, 'none');
});

test('discard reasons are canonical and never empty for real states', async () => {
  const spectrumReason = buildDuplicateDiscardReason({
    state: 'spectrum',
    spectrum: { source: 'OPEN_ITEMS', invoiceNumber: '53477', amount: 74877 },
    original: null,
    evidence: {},
  });
  assert.equal(spectrumReason, 'Duplicate — posted in Spectrum (OPEN_ITEMS, #53477, $74877.00)');

  const submittedReason = buildDuplicateDiscardReason({
    state: 'spectrum',
    spectrum: null,
    original: { id: 'doc-orig' },
    evidence: {},
  });
  assert.equal(submittedReason, 'Duplicate of doc-orig (submitted to Spectrum)');

  const toolboxReason = buildDuplicateDiscardReason({
    state: 'toolbox',
    spectrum: null,
    original: { id: 'doc-orig' },
    evidence: {},
  });
  assert.equal(toolboxReason, 'Duplicate of doc-orig');

  const staleReason = buildDuplicateDiscardReason({
    state: 'stale',
    spectrum: null,
    original: null,
    evidence: { originalDiscardedAt: '2026-09-01T12:00:00Z' },
  });
  assert.equal(staleReason, 'Duplicate — flagged against a copy discarded on 2026-09-01');

  assert.equal(buildDuplicateDiscardReason({ state: 'none' }), '');
  assert.equal(buildDuplicateDiscardReason(null), '');
});
