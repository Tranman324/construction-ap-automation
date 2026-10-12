'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { normalizeExtractedDates } = require('../../modules/invoices/services/pipeline');

test('normalizeExtractedDates preserves an explicit extracted due date', () => {
  const extracted = {
    invoiceDate: '2026-05-10',
    dueDate: '2026-05-25',
  };

  const result = normalizeExtractedDates(extracted, '2026-05-11T14:30:00Z');

  assert.equal(result.dueDate, '2026-05-25');
});

test('normalizeExtractedDates defaults a missing due date to invoice date plus 30 days', () => {
  const extracted = {
    invoiceDate: '2026-05-10',
    dueDate: null,
  };

  const result = normalizeExtractedDates(extracted);

  assert.equal(result.dueDate, '2026-06-09');
});

test('normalizeExtractedDates computes Net N payment terms from invoice date', () => {
  const extracted = {
    invoiceDate: '2026-01-15',
    dueDate: 'Net 45',
  };

  const result = normalizeExtractedDates(extracted);

  assert.equal(result.dueDate, '2026-03-01');
});

test('normalizeExtractedDates defaults invoiceDate to email date, then computes dueDate +30', () => {
  const extracted = {
    invoiceDate: null,
    dueDate: null,
  };

  const result = normalizeExtractedDates(extracted, '2026-05-10T12:00:00Z');

  assert.equal(result.invoiceDate, '2026-05-10');
  assert.equal(result.dueDate, '2026-06-09');
});

test('normalizeExtractedDates rejects invoiceDate with year < 2000', () => {
  const extracted = {
    invoiceDate: '0026-05-10',
    dueDate: null,
  };

  const result = normalizeExtractedDates(extracted, '2026-06-01T00:00:00Z');

  // Year 0026 is insane → falls back to email date
  assert.equal(result.invoiceDate, '2026-06-01');
});

test('normalizeExtractedDates rejects dueDate with year > currentYear + 5', () => {
  const currentYear = new Date().getFullYear();
  const futureYear = currentYear + 10;
  const extracted = {
    invoiceDate: '2026-05-10',
    dueDate: `${futureYear}-01-01`,
  };

  const result = normalizeExtractedDates(extracted);

  // Insane dueDate → default to invoiceDate + 30
  assert.equal(result.dueDate, '2026-06-09');
});

test('normalizeExtractedDates accepts valid dueDate within sane range', () => {
  const extracted = {
    invoiceDate: '2026-05-10',
    dueDate: '2026-06-15',
  };

  const result = normalizeExtractedDates(extracted);

  assert.equal(result.dueDate, '2026-06-15');
});

test('normalizeExtractedDates defaults dueDate when invoiceDate comes from email', () => {
  const extracted = {
    invoiceDate: null,
    dueDate: null,
  };

  const result = normalizeExtractedDates(extracted, '2026-07-01T10:00:00Z');

  assert.equal(result.invoiceDate, '2026-07-01');
  assert.equal(result.dueDate, '2026-07-31');
});
