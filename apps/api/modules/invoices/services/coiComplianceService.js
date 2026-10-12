'use strict';

function normalize(value) { return String(value || '').toLowerCase().replace(/\b(suite|ste)\b/g, 'suite').replace(/\b(street)\b/g, 'st').replace(/\b(road)\b/g, 'rd').replace(/[^a-z0-9]/g, ''); }
// Address-only: drops a trailing country and standalone street directionals so "500 Example Gateway SE ... USA" matches the configured holder address.
function normalizeAddress(value) { return normalize(String(value || '').toLowerCase().replace(/['\u2019]/g, '').replace(/[\s,.]+(?:united\s+states(?:\s+of\s+america)?|u\.?s\.?(?:a\.?)?)[\s.]*$/, '').replace(/(?<!(?:\b(?:suite|ste|unit|apt|bldg|building|floor|fl)|#)\s*)(?<!-)\b(?:north|south|east|west|northeast|northwest|southeast|southwest|ne|nw|se|sw|n|s|e|w)\b(?!-)/g, ' ')); }
function parse(value) { if (!value || typeof value === 'object') return value || {}; try { return JSON.parse(value); } catch { return {}; } }
function attributed(value) { return value && typeof value === 'object' && 'value' in value ? value.value : value; }
function resolved(manual, extracted, computed = null) { const base = manual !== null && manual !== undefined && manual !== '' ? { value: manual, provenance: 'manual' } : extracted !== null && extracted !== undefined && extracted !== '' ? { value: extracted, provenance: 'extracted' } : computed !== null && computed !== undefined && computed !== '' ? { value: computed, provenance: 'computed' } : { value: null, provenance: 'unknown' }; return { ...base, permittedActions: [], blockers: [] }; }
function configured(value) { const base = value !== null && value !== undefined ? { value, provenance: 'config' } : { value: null, provenance: 'unknown' }; return { ...base, permittedActions: [], blockers: [] }; }

function coverageType(value) { return String(value || '').trim().toLowerCase(); }
function coverageLine(lines, requirement, aliases = {}) {
  const expected = coverageType(requirement.type);
  return lines.find((line) => {
    const source = coverageType(line.type);
    const alias = Object.entries(aliases).find(([from]) => coverageType(from) === source);
    return coverageType(alias ? alias[1] : source) === expected;
  });
}

function coverageStatus(lines, config = {}) {
  const requirements = Array.isArray(config.coverageRequirements) ? config.coverageRequirements : [];
  const aliases = config.coverageTypeAliases || {};
  for (const requirement of requirements.filter((item) => item.required)) {
    const line = coverageLine(lines, requirement, aliases);
    if (!line) return 'fail';
    if ((requirement.limits || []).filter((limit) => limit.tier !== 'exception').some((limit) => !Number.isFinite(line.limits?.[limit.key]) || line.limits[limit.key] < Number(limit.minimum))) return 'fail';
  }
  return 'pass';
}

function coverageFailures(lines, config = {}) {
  const requirements = Array.isArray(config.coverageRequirements) ? config.coverageRequirements : [];
  const aliases = config.coverageTypeAliases || {};
  const failures = [];
  for (const requirement of requirements.filter((item) => item.required)) {
    const line = coverageLine(lines, requirement, aliases);
    if (!line) { for (const limit of (requirement.limits || []).filter((item) => item.tier !== 'exception')) failures.push({ coverageId: requirement.type, coverageLabel: requirement.label || requirement.type, limitLabel: limit.label || limit.key, value: null, minimum: limit.minimum }); continue; }
    for (const limit of (requirement.limits || []).filter((item) => item.tier !== 'exception')) { const value = line.limits?.[limit.key]; if (!Number.isFinite(value) || value < Number(limit.minimum)) failures.push({ coverageId: requirement.type, coverageLabel: requirement.label || requirement.type, limitLabel: limit.label || limit.key, value: Number.isFinite(value) ? value : null, minimum: limit.minimum }); }
  }
  return failures;
}

function coverageExceptions(lines, config = {}) {
  const requirements = Array.isArray(config.coverageRequirements) ? config.coverageRequirements : [];
  const aliases = config.coverageTypeAliases || {}; const exceptions = [];
  for (const requirement of requirements.filter((item) => item.required)) {
    const line = coverageLine(lines, requirement, aliases);
    for (const limit of (requirement.limits || []).filter((item) => item.tier === 'exception')) {
      const value = line?.limits?.[limit.key];
      if (!Number.isFinite(value) || value < Number(limit.minimum)) exceptions.push({ coverageId: requirement.type, coverageLabel: requirement.label || requirement.type, limitLabel: limit.label || limit.key, value: Number.isFinite(value) ? value : null, minimum: limit.minimum });
    }
  }
  return exceptions;
}

function cancellationStatus(days, minimum) {
  if (!Number.isFinite(days)) return 'warn';
  return days >= minimum ? 'pass' : 'warn';
}

function text(value) { return String(value ?? '').trim(); }
function days(count) { return `${count} ${count === 1 ? 'day' : 'days'}`; }
function money(value) { return `$${Number(value).toLocaleString('en-US')}`; }
function formatDate(date) { return date && !Number.isNaN(date.getTime()) ? `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}` : 'an unknown date'; }

function coverageFailureDetail(failures) {
  if (!failures.length) return 'A required coverage type is missing from the COI.';
  const parts = failures.slice(0, 2).map((failure) => `${failure.coverageLabel} ${failure.limitLabel} ${failure.value === null ? 'not found' : `is ${money(failure.value)}`}; required ${money(failure.minimum)}`);
  if (failures.length > 2) parts.push(`Plus ${failures.length - 2} more`);
  return `${parts.join('. ')}.`;
}

// Plain-English explanation of a check result. Pass keeps the legacy `<label>: pass` text.
function checkDetail(check, context) {
  if (check.rawStatus === 'pass') return `${check.label}: pass`;
  const { data, config, failures, expiry, daysRemaining } = context;
  switch (check.id) {
    case 'named-insured': return 'No vendor selected. Pick the vendor this COI belongs to.';
    case 'additional-insured': return 'COI does not show an additional insured endorsement.';
    case 'waiver-subrogation': return 'COI does not show a waiver of subrogation.';
    case 'primary-noncontrib': return 'COI does not show primary and noncontributory wording.';
    case 'cancellation': {
      const required = `Required: ${days(config.cancellationNoticeMinimumDays ?? 0)}.`;
      return Number.isFinite(data.cancellationNoticeDays) ? `COI gives ${days(data.cancellationNoticeDays)} cancellation notice. ${required}` : `No cancellation notice period found on the COI. ${required}`;
    }
    case 'policy-numbers': return 'No policy numbers found on the COI.';
    case 'coverage-minimums': return coverageFailureDetail(failures);
    case 'certificate-holder': {
      const expected = text(config.certificateHolder?.name); const found = text(data.holder?.name);
      if (!expected) return 'No NCG certificate holder configured in COI settings.';
      return found ? `COI lists "${found}". Expected "${expected}".` : `No certificate holder found on the COI. Expected "${expected}".`;
    }
    case 'certificate-holder-address': {
      const expected = text(config.certificateHolder?.address); const found = text(data.holder?.address).replace(/\s*(?:\r?\n)+\s*/g, ', ');
      if (!expected) return 'No NCG holder address configured in COI settings.';
      return found ? `COI lists "${found}". Expected "${expected}".` : `No holder address found on the COI. Expected "${expected}".`;
    }
    case 'coverage-active':
      if (daysRemaining === null) return 'No expiration date found on the COI.';
      if (daysRemaining < 0) return `Coverage expired ${formatDate(expiry)}.`;
      return `Coverage expires ${formatDate(expiry)} (in ${days(daysRemaining)}).`;
    default: return `${check.label}: ${check.rawStatus}`;
  }
}

function resolveCoiValues(document = {}, config = {}, now = new Date()) {
  const data = parse(document.coi_data); const manual = parse(document.coi_manual_values); const lines = Array.isArray(data.coverageLines) ? data.coverageLines : [];
  const expirationValue = resolved(attributed(manual.expirationDate), lines.map((line) => line.expirationDate).find(Boolean));
  const vendor = resolved(attributed(manual.vendorCode), document.vendor_code);
  const holderExpectation = configured(config.certificateHolder);
  const coverageRequirements = configured(config.coverageRequirements);
  const coverageConfig = { coverageRequirements: coverageRequirements.value || [], coverageTypeAliases: config.coverageTypeAliases || {} };
  const expiry = expirationValue.value ? new Date(`${String(expirationValue.value).slice(0, 10)}T12:00:00.000Z`) : null;
  const daysRemaining = expiry && !Number.isNaN(expiry.getTime()) ? Math.ceil((expiry.getTime() - now.getTime()) / 86400000) : null;
  const aliases = holderExpectation.value?.nameAliases || []; const holderName = normalize(data.holder?.name);
  const nameStatus = aliases.some((alias) => holderName.includes(normalize(alias))) ? 'pass' : 'fail';
  const expectedAddress = normalizeAddress(holderExpectation.value?.address); const addressStatus = expectedAddress && normalizeAddress(data.holder?.address) === expectedAddress ? 'pass' : 'warn';
  const expirationStatus = daysRemaining === null || daysRemaining < 0 ? 'fail' : daysRemaining <= (config.warnWindowDays ?? 30) ? 'warn' : 'pass';
  const expiration = { ...expirationValue, value: { state: daysRemaining === null ? 'unknown' : daysRemaining < 0 ? 'expired' : expirationStatus === 'warn' ? 'expiring-soon' : 'active', expirationDate: expirationValue.value, daysRemaining } };
  if (!vendor.value) vendor.blockers.push({ code: 'MISSING_VENDOR_CODE', message: 'No vendor selected. Pick the vendor this COI belongs to.' });
  const failures = coverageFailures(lines, coverageConfig); const detailContext = { data, config, failures, expiry, daysRemaining };
  const checks = [{ id: 'named-insured', label: 'Named insured matches vendor', rawStatus: vendor.value ? 'pass' : 'warn', required: true }, { id: 'additional-insured', label: 'Additional insured endorsement present', rawStatus: data.endorsements?.additionalInsured ? 'pass' : 'fail', required: true }, { id: 'waiver-subrogation', label: 'Waiver of subrogation present', rawStatus: data.endorsements?.waiverOfSubrogation ? 'pass' : 'warn', required: true }, { id: 'primary-noncontrib', label: 'Primary and noncontributory wording', rawStatus: data.endorsements?.primaryNoncontributory ? 'pass' : 'warn', required: false }, { id: 'cancellation', label: 'Cancellation notice', rawStatus: cancellationStatus(data.cancellationNoticeDays, config.cancellationNoticeMinimumDays ?? 0), required: true }, { id: 'policy-numbers', label: 'Policy numbers captured', rawStatus: lines.some((line) => line.policyNumber) ? 'pass' : 'warn', required: true }, { id: 'coverage-minimums', label: 'Required coverage minimums met', rawStatus: coverageStatus(lines, coverageConfig), required: true }, { id: 'certificate-holder', label: 'Certificate holder matches NCG requirements', rawStatus: nameStatus, required: true }, { id: 'certificate-holder-address', label: 'Certificate holder address matches', rawStatus: addressStatus, required: false }, { id: 'coverage-active', label: 'Coverage dates are active', rawStatus: expirationStatus, required: true }].map((check) => ({ ...check, detail: checkDetail(check, detailContext) }));
  return { values: { vendorCode: vendor, expiration, holderExpectation, coverageRequirements }, coverageFailures: failures, coverageExceptions: coverageExceptions(lines, coverageConfig), checks, daysRemaining };
}

function evaluateCoiCompliance(document, { config = {}, configVersionId = 'legacy-singleton:unversioned', now = new Date(), overrides = [] } = {}) {
  const raw = resolveCoiValues(document, config, now); const active = new Map(overrides.filter((item) => !item.revokedAt && !item.revoked_at).map((item) => [item.checkId || item.check_id, item]));
  // A passing check needs no approval, so any override on it is moot. A submitted (filed) COI keeps the approvals it was filed with.
  const submitted = document?.status === 'submitted';
  const checks = raw.checks.map((check) => { const override = check.rawStatus === 'pass' ? undefined : active.get(check.id); const stale = override && !submitted && ((override.configVersionId || override.config_version_id) !== configVersionId || (override.originalStatus || override.original_status) !== check.rawStatus); return { ...check, effectiveStatus: override && !stale ? 'pass' : check.rawStatus, provenance: override && !stale ? 'override' : 'computed', detail: stale ? `${check.detail} An earlier approval no longer applies because the check result changed.` : check.detail, ...(stale ? { code: 'OVERRIDE_STALE' } : {}) }; });
  const blockers = [...checks.filter((check) => check.effectiveStatus === 'fail').map((check) => ({ code: check.id === 'coverage-active' && raw.values.expiration.value.state === 'expired' ? 'EXPIRED' : check.id, message: check.detail })), ...raw.values.vendorCode.blockers]; const verdict = blockers.length ? 'non-compliant' : checks.some((check) => check.effectiveStatus === 'warn') ? 'review-required' : 'compliant';
  return { verdict, evaluatedAt: now.toISOString(), configVersion: configVersionId, configVersionId, checks, coverageFailures: raw.coverageFailures, coverageExceptions: raw.coverageExceptions, expiration: raw.values.expiration, vendorCode: raw.values.vendorCode, uploadReady: !blockers.length, blockers };
}
module.exports = { evaluateCoiCompliance, resolveCoiValues };
