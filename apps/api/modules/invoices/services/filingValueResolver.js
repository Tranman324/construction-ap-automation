'use strict';

/**
 * Resolve values used by filing and document-panel consumers in one place.
 *
 * The order is intentional and is part of the API contract: an attributed
 * manual value wins over extraction, then a persisted match, then the source
 * email. Filename is only a source for fields that explicitly opt into it.
 * This module is pure; callers may use it while serializing rows or before a
 * SharePoint write without introducing a database or external-service read.
 */

const SOURCE_ORDER = Object.freeze(['manual', 'extracted', 'matching', 'email']);

function parseObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function attributedValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
    return value.value;
  }
  return value;
}

function usable(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function resolved(value, provenance) {
  return {
    value: value ?? null,
    provenance: provenance || null,
    permittedActions: [],
    blockers: [],
  };
}

/** Resolve one field from a source map, preserving the winning provenance. */
function resolveFilingValue({ manual, extracted, matching, email, filename, allowFilename = false } = {}) {
  const sources = { manual, extracted, matching, email };
  for (const provenance of SOURCE_ORDER) {
    const value = attributedValue(sources[provenance]);
    if (usable(value)) return resolved(value, provenance);
  }
  if (allowFilename && usable(filename)) return resolved(attributedValue(filename), 'filename');
  return resolved(null, null);
}

function nested(row, snake, camel) {
  return row?.[snake] ?? row?.[camel];
}

function isSuggestionMatch(method) {
  return typeof method === 'string' && /suggestion/i.test(method);
}

function filingManualValues(row) {
  const source = row?.filing_manual_values ?? row?.filingManualValues
    ?? row?.manual_values ?? row?.manualValues ?? row?.manual;
  return parseObject(source);
}

function warrantyManualValues(row) {
  return parseObject(row?.warranty_manual_values ?? row?.warrantyManualValues);
}

function manualWarrantyField(manualValues, field) {
  const entry = manualValues?.[field];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (!usable(entry.value)) return null;
  if (typeof entry.value !== 'string') return null;
  if (typeof entry.setBy !== 'string' || !entry.setBy.trim()) return null;
  const setAt = entry.setAt instanceof Date ? entry.setAt : new Date(entry.setAt);
  if (Number.isNaN(setAt.getTime()) || setAt.getTime() > Date.now()) return null;
  return entry.value;
}

function resolveFilingValues(row = {}) {
  const manual = filingManualValues(row);
  const coiManual = parseObject(row.coi_manual_values ?? row.coiManualValues);
  const coiData = parseObject(row.coi_data ?? row.coiData);
  const extracted = parseObject(row.extracted);
  const matching = parseObject(row.matching);
  const email = parseObject(row.email);
  const isWarranty = String(row.classification || '').replace(/ /g, '-') === 'warranty';
  const warrantyManual = isWarranty ? warrantyManualValues(row) : {};

  const extractedVendor = row.classification === 'coi'
    ? (row.vendor_code ?? extracted.vendorCode ?? extracted.vendorName)
    : (nested(row, 'vendor_name', 'vendorName') ?? extracted.vendorName ?? extracted.vendor);
  const matchingVendor = matching.vendor?.vendorName ?? matching.vendor?.name
    ?? ((row.vendor_code || isSuggestionMatch(row.vendor_match_method)) ? row.matched_vendor_name : null);
  const emailVendor = row.classification === 'coi' ? null : (row.email_from ?? email.from);
  const manualVendor = manual.vendor ?? manual.vendorName ?? manual.vendorCode
    ?? coiManual.vendorCode;

  const extractedJob = nested(row, 'job_number', 'jobNumber') ?? extracted.jobNumber;
  const matchingJob = row.job_match_number ?? matching.job?.jobNumber ?? matching.job?.number;
  const emailJob = email.jobNumber ?? email.jobRef;
  const manualJob = manual.job ?? manual.jobNumber;

  const extractedScope = nested(row, 'description', 'description') ?? extracted.description
    ?? extracted.scope ?? extracted.lineItems?.[0]?.description;
  const matchingScope = matching.scope ?? matching.job?.scope ?? matching.job?.jobDescription;
  const emailScope = row.email_subject ?? email.subject;
  const manualScope = manual.scope ?? manual.description;

  const extractedDate = row.classification === 'coi'
    ? null
    : (nested(row, 'invoice_date', 'invoiceDate') ?? extracted.invoiceDate);
  const matchingDate = matching.date ?? matching.invoiceDate;
  const emailDate = row.classification === 'coi' ? null : (row.email_received_at ?? email.receivedAt);
  const manualDate = manual.date ?? manual.invoiceDate ?? coiManual.expirationDate;
  const extractedEffectiveDate = extractedDate ?? coiData.expirationDate
    ?? coiData.expiration?.date ?? coiData.certificateExpiration
    ?? coiData.coverageLines?.map((line) => line?.expirationDate).find(Boolean);

  const values = {
    vendor: resolveFilingValue({ manual: manualVendor, extracted: extractedVendor, matching: matchingVendor, email: emailVendor }),
    job: resolveFilingValue({ manual: manualJob, extracted: extractedJob, matching: matchingJob, email: emailJob }),
    scope: resolveFilingValue({ manual: manualScope, extracted: extractedScope, matching: matchingScope, email: emailScope }),
    date: resolveFilingValue({ manual: manualDate, extracted: extractedEffectiveDate, matching: matchingDate, email: emailDate }),
  };

  const computedProviderKind = row.subcontract_number || matching.subcontract?.subcontractNumber
    ? 'Subcontractor'
    : 'Vendor';
  const manualProviderKind = manualWarrantyField(warrantyManual, 'providerKind');
  const providerKind = usable(manualProviderKind)
    ? resolved(manualProviderKind, 'manual')
    : resolved(computedProviderKind, 'computed');
  const scopeText = values.scope.value == null ? '' : String(values.scope.value);
  const computedWarrantyType = /workmanship/i.test(scopeText) ? 'Workmanship' : 'Warranty certificate';
  const manualWarrantyType = manualWarrantyField(warrantyManual, 'warrantyType');
  const warrantyType = usable(manualWarrantyType)
    ? resolved(manualWarrantyType, 'manual')
    : resolved(computedWarrantyType, 'computed');

  return { vendor: values.vendor, job: values.job, scope: values.scope, date: values.date, providerKind, warrantyType };
}

module.exports = {
  SOURCE_ORDER,
  parseObject,
  resolveFilingValue,
  resolveFilingValues,
  warrantyManualValues,
  manualWarrantyField,
};
