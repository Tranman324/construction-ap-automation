'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { validateInvoice } = require('../../modules/invoices/services/spectrumValidation');

function referenceData() {
  return {
    vendors: new Set(['ZVEN91']),
    jobs: new Set(['25-401']),
    glAccounts: new Set(['5450']),
    phaseCodes: new Set(['0100']),
    routingCodes: new Set(['D', 'PM1']),
  };
}

function validInvoice(overrides = {}) {
  return {
    Company_Code: 'NCG',
    Vendor_Code: 'ZVEN91',
    Invoice_Number: 'INV-100',
    Invoice_Date: '06/22/2026',
    GL_Date: '06/22/2026',
    Approval_Status: 'A',
    Batch_Code: 'A.I',
    Routing_Code: 'D',
    Invoice_Amount: 100,
    APInvoiceDetails: [{
      Distribution: { GL_Account: '5450' },
      Amount: 100,
      Job: {
        Job_Number: '25-401',
        Phase_Code: '0100',
        Cost_Type: 'S',
      },
    }],
    ...overrides,
  };
}

test('validateInvoice accepts a structurally valid Spectrum invoice payload', () => {
  const errors = validateInvoice(validInvoice(), 1, referenceData());

  assert.deepEqual(errors, []);
});

test('validateInvoice rejects missing references, bad dates, detail mismatch, and wrong image fields', () => {
  const errors = validateInvoice(validInvoice({
    Vendor_Code: 'UNKNOWN',
    Invoice_Date: '2026-06-22',
    Invoice_Amount: 100,
    APInvoiceDetails: [{
      Distribution: { GL_Account: '9999' },
      Amount: 50,
      Job: {
        Job_Number: 'missing-job',
        Phase_Code: '9999',
        Cost_Type: 'X',
      },
    }],
    Images: [{ Image: 'not-the-right-field', Image_Type: '' }],
  }), 1, referenceData());

  assert.ok(errors.some((error) => /Invoice_Date must be in MM\/DD\/YYYY/.test(error)));
  assert.ok(errors.some((error) => /Vendor_Code "UNKNOWN" does not exist/.test(error)));
  assert.ok(errors.some((error) => /GL_Account "9999" does not exist/.test(error)));
  assert.ok(errors.some((error) => /Job_Number "missing-job" does not exist/.test(error)));
  assert.ok(errors.some((error) => /Phase_Code "9999" does not exist/.test(error)));
  assert.ok(errors.some((error) => /Cost_Type must be one of/.test(error)));
  assert.ok(errors.some((error) => /Sum of detail Amounts/.test(error)));
  assert.ok(errors.some((error) => /Image_File \(base64\) is required/.test(error)));
  assert.ok(errors.some((error) => /Image_Type is required/.test(error)));
});
