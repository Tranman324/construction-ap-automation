'use strict';

const path = require('path');
const { resolveFilingValues } = require('./filingValueResolver');

const MAX_BASE_LENGTH = 40;
const MAX_VENDOR_LENGTH = 15;
const MAX_REF_LENGTH = 10;
const ILLEGAL_CHARS_RE = /[~"#%&*:<>?/\\{|}]/g;
const ILLEGAL_REF_CHARS_RE = /[~"%&*:<>?/\\{|}]/g;

const TYPE_ABBREVIATIONS = Object.freeze({
  invoice: 'INV',
  receipt: 'RCT',
  'pay-application': 'PMT',
  'building-permit': 'PMT',
  permit: 'PMT',
  warranty: 'WTY',
  statement: 'STMT',
  coi: 'COI',
  w9: 'W9',
  'w-9': 'W9',
  'lien-waiver': 'LW',
});

// This map intentionally mirrors the browser candidate generator. Broader
// aliases above remain available to the legacy upload helper until filing
// authority moves to the canonical candidate in a later task.
const CANONICAL_TYPE_ABBREVIATIONS = Object.freeze({
  invoice: 'INV',
  receipt: 'RCT',
  statement: 'STMT',
  coi: 'COI',
  w9: 'W9',
  'lien-waiver': 'LW',
  'building-permit': 'PMT',
  warranty: 'WTY',
});

// Filing candidates are user-facing names.  Keep invoice shorthand stable for
// historical familiarity, but spell every other classification out so a
// filename remains intelligible outside the invoice panel.
const CANONICAL_TYPE_LABELS = Object.freeze({
  receipt: 'Receipt',
  'pay-application': 'Pay Application',
  'credit-memo': 'Credit Memo',
  subcontract: 'Subcontract',
  warranty: 'Warranty',
  image: 'Image',
  other: 'Document',
  statement: 'Statement',
  coi: 'Certificate of Insurance',
  'building-permit': 'Building Permit',
  w9: 'W-9',
  contract: 'Contract',
  'lien-waiver': 'Lien Waiver',
  'change-order': 'Change Order',
  'purchase-order': 'Purchase Order',
  'no-attachment': 'Document',
  error: 'Document',
  'all-skipped': 'Document',
  skipped: 'Document',
  unsupported: 'Document',
});

const CANONICAL_ILLEGAL_CHARS_RE = /[~"%&*:<>?/\\{|}]/g;

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeCanonicalPart(value) {
  return String(value ?? '')
    .replace(CANONICAL_ILLEGAL_CHARS_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeFilenameOverride(value) {
  return sanitizeCanonicalPart(value).replace(/[. ]+$/g, '');
}

function truncateCanonicalAtWord(value, maxLength = 15) {
  if (value.length <= maxLength) return value;
  const trimmed = value.slice(0, maxLength + 1);
  const wordBoundary = trimmed.lastIndexOf(' ');
  if (wordBoundary > 4) return trimmed.slice(0, wordBoundary).trim();
  return value.slice(0, maxLength).trim();
}

function formatCanonicalShortDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}-${day}-${year}`;
}

function normalizeCanonicalExtension(extension) {
  const raw = String(extension ?? '').trim();
  const dotted = raw.match(/\.([A-Za-z0-9]{1,8})$/);
  const bare = raw.match(/^[A-Za-z0-9]{1,8}$/);
  const value = dotted?.[1] || bare?.[0];
  return value ? `.${value.toLowerCase()}` : '.pdf';
}

function sanitizePart(value, { allowHash = false } = {}) {
  const pattern = allowHash ? ILLEGAL_REF_CHARS_RE : ILLEGAL_CHARS_RE;
  return normalizeSpaces(String(value || '').replace(pattern, ''));
}

function truncateAtWordBoundary(value, maxLength) {
  const text = normalizeSpaces(value);
  if (text.length <= maxLength) return text;

  const sliced = text.slice(0, maxLength + 1).trimEnd();
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace > 0) {
    return sliced.slice(0, lastSpace).trim();
  }
  return sliced.slice(0, maxLength).trim();
}

function getTypeAbbreviation(type) {
  const key = normalizeSpaces(type).toLowerCase();
  return TYPE_ABBREVIATIONS[key] || 'DOC';
}

function formatSharePointDate(value) {
  if (!value) return 'NO-DATE';

  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[2]}-${match[3]}-${match[1].slice(2)}`;
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'NO-DATE';

  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${mm}-${dd}-${yy}`;
}

function normalizeExtension(extension) {
  const raw = String(extension || '').trim();
  const ext = raw.startsWith('.') ? raw.slice(1) : raw;
  const sanitized = ext.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return sanitized || 'pdf';
}

function trimBase(base, maxLength = MAX_BASE_LENGTH) {
  const text = normalizeSpaces(base);
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd().replace(/[ .-]+$/g, '');
}

function normalizeExistingNames(existingNames) {
  return new Set(
    (Array.isArray(existingNames) ? existingNames : [])
      .filter((name) => typeof name === 'string')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
  );
}

function withCollisionSuffix(base, extension, existingNames) {
  const normalizedExisting = normalizeExistingNames(existingNames);
  const ext = normalizeExtension(extension);
  let suffixNumber = 1;

  while (suffixNumber < 10_000) {
    const suffix = suffixNumber === 1 ? '' : ` (${suffixNumber})`;
    const candidateBase = trimBase(base, MAX_BASE_LENGTH - suffix.length);
    const candidate = `${candidateBase}${suffix}.${ext}`;
    if (!normalizedExisting.has(candidate.toLowerCase())) {
      return candidate;
    }
    suffixNumber += 1;
  }

  throw new Error('Unable to build a unique SharePoint filename');
}

/**
 * Resolve a collision for an already-canonical candidate without re-running
 * legacy sanitization/truncation rules. The candidate generator is pure and
 * byte-identical to the frozen browser vectors; only this filing-boundary
 * helper may append an upload-time suffix.
 */
function resolveCanonicalFilenameCollision(candidate, existingNames) {
  const value = String(candidate || '').trim();
  if (!value) return value;
  const normalizedExisting = normalizeExistingNames(existingNames);
  if (!normalizedExisting.has(value.toLowerCase())) return value;

  const parsed = path.parse(value);
  let suffixNumber = 2;
  while (suffixNumber < 10_000) {
    const suffix = ` (${suffixNumber})`;
    const maxBaseLength = Math.max(1, 128 - parsed.ext.length - suffix.length);
    const base = trimBase(parsed.name, maxBaseLength);
    const next = `${base}${suffix}${parsed.ext}`;
    if (!normalizedExisting.has(next.toLowerCase())) return next;
    suffixNumber += 1;
  }

  throw new Error('Unable to build a unique SharePoint filename');
}

function isSharePointUploadConflict(err) {
  const status = Number(err?.status || err?.statusCode || err?.response?.status);
  const code = String(err?.code || err?.response?.data?.error?.code || '');
  const message = String(err?.message || err || '');
  return status === 409
    || /nameAlreadyExists|resourceModified|conflict/i.test(code)
    || /\b409\b|already\s+exists|conflict/i.test(message);
}

/**
 * Build the pure, pre-collision candidate captured from the browser filing
 * model. It deliberately ignores existingNames: upload-time collision
 * resolution belongs to the filing boundary, not candidate generation.
 */
function buildCanonicalSharePointFileName({
  type,
  vendor,
  date,
  ref,
  extension,
} = {}) {
  const classification = String(type ?? '');
  const typeAbbreviation = classification === 'invoice'
    ? (CANONICAL_TYPE_ABBREVIATIONS[classification] || 'DOC')
    : (CANONICAL_TYPE_LABELS[classification] || 'Document');
  const rawVendor = String(vendor ?? '');
  const vendorSource = rawVendor.includes('@') ? rawVendor.split('@')[0] : rawVendor;
  const vendorText = truncateCanonicalAtWord(sanitizeCanonicalPart(vendorSource));
  const dateText = formatCanonicalShortDate(date);
  const refText = sanitizeCanonicalPart(ref);
  const shortRef = refText.length > 0 && refText.length <= 10 ? refText : '';
  const pieces = [typeAbbreviation, vendorText, dateText, shortRef]
    .filter((piece) => piece.length > 0);

  const ext = normalizeCanonicalExtension(extension);
  const base = pieces.join(' ');
  return `${base.slice(0, Math.max(1, 128 - ext.length)).replace(/[. ]+$/g, '')}${ext}`;
}

/**
 * Build the canonical filing preview from a persisted document row. This is
 * intentionally pure: destination listings and collision suffixes belong to
 * the upload boundary, while preview/confirmation uses this exact candidate.
 */
function buildCanonicalFilingFileName(document = {}, localFilePath) {
  const source = localFilePath || document.file_name || document.display_name || '';
  const filingValues = resolveFilingValues(document);
  const vendor = filingValues.vendor.value || '';
  let date = filingValues.date.value || null;
  // PostgreSQL date columns arrive as Date objects at UTC midnight. Convert
  // them to a date-only string before the browser-compatible local parser so
  // an EDT/EST server cannot shift the candidate back by one day.
  if (date instanceof Date && !Number.isNaN(date.getTime())) date = date.toISOString().slice(0, 10);
  return buildCanonicalSharePointFileName({
    type: document.classification,
    vendor,
    date,
    ref: document.invoice_number || document.reference_number || '',
    extension: path.extname(source) || '.pdf',
  });
}

function buildFilingPreview(document = {}, localFilePath) {
  const date = resolveFilingValues(document).date;
  return {
    fileName: {
      value: buildCanonicalFilingFileName(document, localFilePath),
      provenance: 'computed',
      permittedActions: ['edit'],
      blockers: [],
    },
    date,
  };
}

function buildSharePointFileName({
  type,
  vendor,
  merchant,
  date,
  ref,
  extension,
  existingNames,
} = {}) {
  const typeAbbreviation = getTypeAbbreviation(type);
  const vendorText = truncateAtWordBoundary(
    sanitizePart(vendor || merchant || 'Document'),
    MAX_VENDOR_LENGTH
  ) || 'Document';
  const dateText = formatSharePointDate(date);
  const refText = sanitizePart(ref, { allowHash: true });
  const shortRef = refText && refText.length <= MAX_REF_LENGTH ? refText : '';
  const base = trimBase([typeAbbreviation, vendorText, dateText, shortRef].filter(Boolean).join(' '));

  return withCollisionSuffix(base, extension, existingNames);
}

function sanitizeSharePointFilename(filename, { fallbackExtension = 'pdf', existingNames } = {}) {
  const parsed = path.parse(String(filename || ''));
  const base = trimBase(sanitizePart(parsed.name) || 'Document');
  const extension = parsed.ext ? parsed.ext : fallbackExtension;
  return withCollisionSuffix(base, extension, existingNames);
}

module.exports = {
  MAX_BASE_LENGTH,
  buildCanonicalFilingFileName,
  buildCanonicalSharePointFileName,
  buildFilingPreview,
  buildSharePointFileName,
  formatSharePointDate,
  getTypeAbbreviation,
  isSharePointUploadConflict,
  resolveCanonicalFilenameCollision,
  sanitizeSharePointFilename,
  sanitizePart,
  sanitizeFilenameOverride,
};
