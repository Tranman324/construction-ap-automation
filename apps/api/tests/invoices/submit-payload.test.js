'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function loadWithSubmitPayloadStubs(request, parent, isMain) {
  const parentFile = parent?.filename ?? '';
  const isSubmitPayloadImport = parentFile.endsWith(path.join('modules', 'invoices', 'services', 'submitPayload.js'));

  if (isSubmitPayloadImport && request === './pdf') {
    return { ensurePdf: async () => null };
  }
  if (isSubmitPayloadImport && request === './spectrum') {
    return { lookupPhaseCode: async () => null };
  }
  if (isSubmitPayloadImport && request === './matching') {
    return { getSubcontractsMap: () => ({}) };
  }
  if (isSubmitPayloadImport && request === './submitRouting') {
    return { loadJobPmMap: () => ({ pmToRouting: {}, jobPmMap: {} }) };
  }
  if (isSubmitPayloadImport && request === './spectrumValidation') {
    return { validatePayload: () => ({ ok: true, errors: [], warnings: [] }) };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const { buildSpectrumSubmission } = require('../../modules/invoices/services/submitPayload');
const approvalRules = require('../../modules/invoices/services/approvalRules.json');

test.after(() => {
  Module._load = originalLoad;
});

const requestLog = {
  info() {},
  error() {},
};

function createPdfFixture() {
  const filePath = path.join(os.tmpdir(), `toolbox-submit-payload-${Date.now()}-${Math.random()}.pdf`);
  fs.writeFileSync(filePath, Buffer.from('%PDF-1.4\n% synthetic test fixture\n'));
  return filePath;
}

function createRow(filePath, overrides = {}) {
  return {
    id: 'invoice-1',
    vendor_code: 'V001',
    invoice_number: 'INV-001',
    invoice_date: '2026-06-01T12:00:00.000Z',
    gl_date: '2026-06-15T12:00:00.000Z',
    amount: '100.00',
    file_path: filePath,
    merged_file_path: null,
    job_match_number: null,
    job_number: null,
    subcontract_number: null,
    routing_code: 'D',
    gl_account: '5450',
    phase_code: null,
    cost_type: null,
    phase_allocations: null,
    ...overrides,
  };
}

test('buildSpectrumSubmission uses the saved GL date independently from invoice date', async () => {
  const filePath = createPdfFixture();
  try {
    const { APInvoices } = await buildSpectrumSubmission({
      rows: [createRow(filePath)],
      overrides: {},
      requestLog,
    });

    assert.equal(APInvoices[0].Invoice_Date, '06/01/2026');
    assert.equal(APInvoices[0].GL_Date, '06/15/2026');
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('buildSpectrumSubmission lets submit overrides replace the saved GL date', async () => {
  const filePath = createPdfFixture();
  try {
    const { APInvoices } = await buildSpectrumSubmission({
      rows: [createRow(filePath)],
      overrides: {
        'invoice-1': { gl_date: '2026-07-01T12:00:00.000Z' },
      },
      requestLog,
    });

    assert.equal(APInvoices[0].Invoice_Date, '06/01/2026');
    assert.equal(APInvoices[0].GL_Date, '07/01/2026');
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('buildSpectrumSubmission refuses an invoice whose GL account cannot be resolved', async () => {
  const { APInvoices, submissionEntries, validation } = await buildSpectrumSubmission({
    rows: [createRow(null, { gl_account: null, cost_type: 'L' })],
    overrides: {},
    requestLog,
  });

  assert.deepEqual(APInvoices, []);
  assert.deepEqual(submissionEntries, []);
  assert.equal(validation.ok, false);
  assert.equal(validation.code, 'SPECTRUM_GL_ACCOUNT_UNRESOLVED');
  assert.deepEqual(validation.unresolvedGlAccounts, [{
    id: 'invoice-1',
    invoiceNumber: 'INV-001',
    costType: 'L',
  }]);
});

test('buildSpectrumSubmission refuses an unmapped multi-phase allocation without a fallback GL', async () => {
  const { APInvoices, submissionEntries, validation } = await buildSpectrumSubmission({
    rows: [createRow(null, {
      gl_account: null,
      job_match_number: 'JOB-1',
      phase_allocations: [{
        amount: 100,
        phase_code: '01-100',
        cost_type: 'L',
        description: 'Labor',
      }],
    })],
    overrides: {},
    requestLog,
  });

  assert.deepEqual(APInvoices, []);
  assert.deepEqual(submissionEntries, []);
  assert.equal(validation.ok, false);
  assert.equal(validation.code, 'SPECTRUM_GL_ACCOUNT_UNRESOLVED');
  assert.deepEqual(validation.unresolvedGlAccounts, [{
    id: 'invoice-1',
    invoiceNumber: 'INV-001',
    costType: 'L',
    allocationIndex: 0,
  }]);
});

test('buildSpectrumSubmission refuses a whitespace-only served GL mapping', async () => {
  const originalMapping = approvalRules.codingDefaults.costTypeGlMap.map.M;
  approvalRules.codingDefaults.costTypeGlMap.map.M = '   ';
  try {
    const { APInvoices, submissionEntries, validation } = await buildSpectrumSubmission({
      rows: [createRow(null, { gl_account: null, cost_type: 'M' })],
      overrides: {},
      requestLog,
    });

    assert.deepEqual(APInvoices, []);
    assert.deepEqual(submissionEntries, []);
    assert.equal(validation.ok, false);
    assert.equal(validation.code, 'SPECTRUM_GL_ACCOUNT_UNRESOLVED');
    assert.deepEqual(validation.unresolvedGlAccounts, [{
      id: 'invoice-1',
      invoiceNumber: 'INV-001',
      costType: 'M',
    }]);
  } finally {
    approvalRules.codingDefaults.costTypeGlMap.map.M = originalMapping;
  }
});

test('buildSpectrumSubmission refuses a phase allocation with a whitespace-only served GL mapping', async () => {
  const originalMapping = approvalRules.codingDefaults.costTypeGlMap.map.M;
  approvalRules.codingDefaults.costTypeGlMap.map.M = '   ';
  try {
    const { APInvoices, submissionEntries, validation } = await buildSpectrumSubmission({
      rows: [createRow(null, {
        gl_account: '7100',
        job_match_number: 'JOB-1',
        phase_allocations: [{
          amount: 100,
          phase_code: '01-100',
          cost_type: 'M',
          description: 'Material',
        }],
      })],
      overrides: {},
      requestLog,
    });

    assert.deepEqual(APInvoices, []);
    assert.deepEqual(submissionEntries, []);
    assert.equal(validation.ok, false);
    assert.equal(validation.code, 'SPECTRUM_GL_ACCOUNT_UNRESOLVED');
    assert.deepEqual(validation.unresolvedGlAccounts, [{
      id: 'invoice-1',
      invoiceNumber: 'INV-001',
      costType: 'M',
      allocationIndex: 0,
    }]);
  } finally {
    approvalRules.codingDefaults.costTypeGlMap.map.M = originalMapping;
  }
});

test('GL resolution precedence is submit override then persisted row then served cost-type map', async () => {
  const rows = [
    createRow(null, {
      id: 'override',
      invoice_number: 'INV-OVERRIDE',
      gl_account: '7000',
      cost_type: 'M',
    }),
    createRow(null, {
      id: 'row',
      invoice_number: 'INV-ROW',
      gl_account: '7100',
      cost_type: 'M',
    }),
    createRow(null, {
      id: 'map',
      invoice_number: 'INV-MAP',
      gl_account: null,
      cost_type: 'M',
    }),
  ];

  const { APInvoices, validation } = await buildSpectrumSubmission({
    rows,
    overrides: {
      override: { gl_account: '7200' },
    },
    requestLog,
  });

  assert.equal(validation.ok, true);
  assert.deepEqual(
    APInvoices.map((invoice) => invoice.APInvoiceDetails[0].Distribution.GL_Account),
    ['7200', '7100', '5300']
  );
});

test('an unmatched extracted job number never reaches the payload as a Job block', async () => {
  // Regression: extraction captured a vendor-internal reference (a law firm's
  // "Matter Number") as job_number; the matcher found no job (job_match_number
  // empty), the UI showed no job, yet the payload attached a Job block and
  // pre-flight rejected the whole submission. Raw job_number is untrusted.
  const { APInvoices, validation } = await buildSpectrumSubmission({
    rows: [createRow(null, {
      job_number: '11973.003',
      job_match_number: '',
      cost_type: 'M',
      gl_account: '7457',
    })],
    overrides: {},
    requestLog,
  });

  assert.equal(validation.ok, true);
  assert.equal(APInvoices.length, 1);
  assert.equal(APInvoices[0].APInvoiceDetails[0].Job, undefined);
  assert.equal(APInvoices[0].APInvoiceDetails[0].Distribution.GL_Account, '7457');
});

test('a matched job still produces a Job block in the payload', async () => {
  const { APInvoices, validation } = await buildSpectrumSubmission({
    rows: [createRow(null, {
      job_match_number: 'JOB-1',
      phase_code: '01-100',
      cost_type: 'S',
      gl_account: '5450',
    })],
    overrides: {},
    requestLog,
  });

  assert.equal(validation.ok, true);
  assert.deepEqual(APInvoices[0].APInvoiceDetails[0].Job, {
    Job_Number: 'JOB-1',
    Phase_Code: '01-100',
    Cost_Type: 'S',
  });
});

test('a resolvable served-map payload keeps the established byte-level JSON shape', async () => {
  const { APInvoices, validation } = await buildSpectrumSubmission({
    rows: [createRow(null, { gl_account: null, cost_type: 'M' })],
    overrides: {},
    requestLog,
  });

  assert.equal(validation.ok, true);
  assert.equal(JSON.stringify(APInvoices), JSON.stringify([{
    Company_Code: 'NCG',
    Vendor_Code: 'V001',
    Invoice_Number: 'INV-001',
    Invoice_Date: '06/01/2026',
    GL_Date: '06/15/2026',
    Approval_Status: 'U',
    Batch_Code: 'A.I',
    Remarks: 'Imported via Toolbox pipeline',
    Routing_Code: 'D',
    Invoice_Amount: 100,
    APInvoiceDetails: [{
      Distribution: { GL_Account: '5300' },
      Amount: 100,
    }],
  }]));
});
