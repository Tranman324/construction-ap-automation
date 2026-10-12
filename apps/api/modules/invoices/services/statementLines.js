'use strict';

const STATEMENT_LINE_STATUSES = new Set([
  'matched',
  'in_toolbox_not_spectrum',
  'not_received',
  'amount_differs',
]);

const STATEMENT_LINE_SOURCES = new Set(['extracted', 'manual']);
const STATEMENT_LINE_RESOLUTION_TYPES = new Set(['accept_line', 'use_ap_amount']);

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeInvoiceNumber(value) {
  const text = cleanText(value);
  if (!text) return null;
  return text.replace(/^(?:invoice|inv|no\.?|#)\s*[:#-]?\s*/i, '').trim();
}

function normalizeAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const negative = /^\(.*\)$/.test(trimmed);
  const numeric = Number(trimmed.replace(/[,$()\s]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return Math.round((negative ? -numeric : numeric) * 100) / 100;
}

function normalizeDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(new Date(text).getTime())) {
    return text;
  }
  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) {
    const [, mm, dd, rawYear] = slashMatch;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    const iso = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    return Number.isNaN(new Date(iso).getTime()) ? null : iso;
  }
  return text;
}

function amountsEqual(a, b) {
  const left = normalizeAmount(a);
  const right = normalizeAmount(b);
  return left !== null && right !== null && Math.abs(left - right) < 0.01;
}

function normalizeStatementLineSource(value, fallback = 'extracted') {
  const source = cleanText(value);
  if (STATEMENT_LINE_SOURCES.has(source)) return source;
  return STATEMENT_LINE_SOURCES.has(fallback) ? fallback : 'extracted';
}

function sumAmounts(values) {
  let hasAmount = false;
  const total = values.reduce((sum, value) => {
    const amount = normalizeAmount(value);
    if (amount === null) return sum;
    hasAmount = true;
    return sum + amount;
  }, 0);
  return hasAmount ? Math.round(total * 100) / 100 : null;
}

function buildLineId(invoiceNumber, index, seen) {
  const base = invoiceNumber || `line-${index + 1}`;
  const count = seen.get(base) || 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function normalizeStatementLines(extracted, { source = 'extracted', defaultStatus = 'not_received' } = {}) {
  const defaultSource = normalizeStatementLineSource(source);
  const rawLines = Array.isArray(extracted?.statementLines)
    ? extracted.statementLines
    : Array.isArray(extracted?.lines)
      ? extracted.lines
      : [];
  const seen = new Map();

  return rawLines
    .map((line, index) => {
      const invoiceNumber = normalizeInvoiceNumber(
        line.invoiceNumber || line.invoice_number || line.invoice || line.number
      );
      if (!invoiceNumber) return null;

      const subItems = Array.isArray(line.subItems) ? line.subItems : [];
      const subItemTotal = sumAmounts(subItems.map((item) => item.amount));
      const parentAmount = normalizeAmount(
        line.amount ?? line.openAmount ?? line.balance ?? line.balanceDue
      );
      const amount = subItemTotal !== null ? subItemTotal : parentAmount;
      if (amount === null) return null;

      const status = STATEMENT_LINE_STATUSES.has(line.status) ? line.status : defaultStatus;
      const resolvedAt = cleanText(line.resolvedAt || line.resolved_at);
      const resolutionType = cleanText(line.resolutionType || line.resolution_type);
      const resolvedBy = cleanText(line.resolvedBy || line.resolved_by);
      return {
        id: cleanText(line.id) || buildLineId(invoiceNumber, index, seen),
        invoiceNumber,
        date: normalizeDate(line.date || line.invoiceDate || line.statementDate),
        amount,
        status,
        source: normalizeStatementLineSource(line.source, defaultSource),
        ...(resolvedAt && STATEMENT_LINE_RESOLUTION_TYPES.has(resolutionType)
          ? { resolvedAt, resolutionType, resolvedBy }
          : {}),
      };
    })
    .filter(Boolean);
}

function recordVendorCode(record) {
  return cleanText(record?.vendorCode || record?.vendor_code || record?.Vendor_Code);
}

function recordInvoiceNumber(record) {
  return normalizeInvoiceNumber(record?.invoiceNumber || record?.invoice_number || record?.Invoice_Number);
}

function recordAmount(record) {
  return normalizeAmount(
    record?.amount ?? record?.invoice_amount ?? record?.Invoice_Amount ?? record?.openAmount
  );
}

function stripNonAlphanumeric(value) {
  return typeof value === 'string' ? value.replace(/[^a-zA-Z0-9]/g, '') : '';
}

function recordMatchesScope(record, { invoiceNumber, vendorCode }) {
  if (!record) return false;
  const scopedVendor = recordVendorCode(record);
  const scopedInvoice = recordInvoiceNumber(record);
  return scopedVendor === vendorCode
    && stripNonAlphanumeric(scopedInvoice) === stripNonAlphanumeric(invoiceNumber);
}

async function matchStatementLineWithEvidence(line, vendorCode, lookups = {}) {
  const [normalizedLine] = normalizeStatementLines({ statementLines: [line] }, {
    source: line?.source || 'extracted',
    defaultStatus: line?.status || 'not_received',
  });
  if (!normalizedLine || !vendorCode) {
    return { line: normalizedLine ? { ...normalizedLine, status: 'not_received' } : null, hasForeignVendorEvidence: false };
  }

  const lookupInput = {
    invoiceNumber: normalizedLine.invoiceNumber,
    vendorCode,
    amount: normalizedLine.amount,
    line: normalizedLine,
  };
  const toolboxRecord = typeof lookups.findToolboxInvoice === 'function'
    ? await lookups.findToolboxInvoice(lookupInput)
    : null;
  const spectrumRecord = typeof lookups.findSpectrumInvoice === 'function'
    ? await lookups.findSpectrumInvoice(lookupInput)
    : null;

  const hasForeignVendorEvidence = [toolboxRecord, spectrumRecord].some((record) => (
    stripNonAlphanumeric(recordInvoiceNumber(record)) === stripNonAlphanumeric(lookupInput.invoiceNumber)
    && recordVendorCode(record)
    && recordVendorCode(record) !== vendorCode
  ));

  const toolboxMatch = recordMatchesScope(toolboxRecord, lookupInput) ? toolboxRecord : null;
  const spectrumMatch = recordMatchesScope(spectrumRecord, lookupInput) ? spectrumRecord : null;

  if (
    (toolboxMatch && !amountsEqual(recordAmount(toolboxMatch), normalizedLine.amount)) ||
    (spectrumMatch && !amountsEqual(recordAmount(spectrumMatch), normalizedLine.amount))
  ) {
    return { line: { ...normalizedLine, status: 'amount_differs' }, hasForeignVendorEvidence };
  }

  // Scope (per the product owner, 2026-07-07): the statement question is "did we receive
  // this invoice?" — presence in Spectrum answers yes regardless of whether a
  // Toolbox document exists (Spectrum is the system of record for posted AP).
  if (spectrumMatch) {
    return { line: { ...normalizedLine, status: 'matched' }, hasForeignVendorEvidence };
  }

  if (toolboxMatch) {
    return { line: { ...normalizedLine, status: 'in_toolbox_not_spectrum' }, hasForeignVendorEvidence };
  }

  return { line: { ...normalizedLine, status: 'not_received' }, hasForeignVendorEvidence };
}

async function matchStatementLine(line, vendorCode, lookups = {}) {
  const result = await matchStatementLineWithEvidence(line, vendorCode, lookups);
  return result.line;
}

async function matchStatementLines(lines, vendorCode, lookups = {}) {
  const normalizedLines = normalizeStatementLines({ statementLines: lines });
  const matched = [];
  for (const line of normalizedLines) {
    matched.push(await matchStatementLine(line, vendorCode, lookups));
  }
  return matched.filter(Boolean);
}

module.exports = {
  STATEMENT_LINE_RESOLUTION_TYPES,
  STATEMENT_LINE_SOURCES,
  STATEMENT_LINE_STATUSES,
  amountsEqual,
  matchStatementLine,
  matchStatementLineWithEvidence,
  matchStatementLines,
  normalizeAmount,
  normalizeStatementLineSource,
  normalizeStatementLines,
};
