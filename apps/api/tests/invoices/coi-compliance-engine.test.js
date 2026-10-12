'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateCoiCompliance, resolveCoiValues } = require('../../modules/invoices/services/coiComplianceService');

test('server clock, provenance, and stale overrides determine the effective result', () => {
  const result = evaluateCoiCompliance({ vendor_code: null, coi_data: { holder: { name: 'Wrong' }, coverageLines: [{ expirationDate: '2026-08-10' }] } }, {
    now: new Date('2026-08-01T00:00:00Z'), configVersionId: 'v2', config: { warnWindowDays: 30, certificateHolder: { nameAliases: ['NCG'] } }, overrides: [{ checkId: 'certificate-holder', configVersionId: 'v1' }],
  });
  assert.equal(result.vendorCode.provenance, 'unknown');
  assert.equal(result.checks.find((check) => check.id === 'coverage-active').effectiveStatus, 'warn');
  assert.deepEqual(result.checks.find((check) => check.id === 'certificate-holder').code, 'OVERRIDE_STALE');
});

test('coverage and holder rules distinguish blockers from warnings', () => {
  const result = evaluateCoiCompliance({ vendor_code: 'V1', coi_data: { holder: { name: 'NCG', address: 'different' }, coverageLines: [] } }, {
    now: new Date('2026-08-01T00:00:00Z'), config: { certificateHolder: { nameAliases: ['NCG'] }, coverageRequirements: [{ type: 'general', required: true, limits: [] }] },
  });
  assert.equal(result.checks.find((check) => check.id === 'certificate-holder').effectiveStatus, 'pass');
  assert.equal(result.checks.find((check) => check.id === 'certificate-holder-address').effectiveStatus, 'warn');
  assert.equal(result.checks.find((check) => check.id === 'coverage-minimums').effectiveStatus, 'fail');
});

test('present below-minimum coverage fails and manual values outrank extracted values', () => {
  const result = evaluateCoiCompliance({ vendor_code: 'EXTRACTED', coi_manual_values: { vendorCode: { value: 'MANUAL' }, expirationDate: { value: '2026-10-01' } }, coi_data: { holder: { name: 'NCG', address: '1 Main St' }, coverageLines: [{ type: 'general', limits: { each: 10 }, expirationDate: '2026-08-02' }] } }, { now: new Date('2026-08-01T00:00:00Z'), config: { certificateHolder: { nameAliases: ['NCG'], address: '1 Main Street' }, coverageRequirements: [{ type: 'general', required: true, limits: [{ key: 'each', minimum: 100 }] }] } });
  assert.equal(result.checks.find((check) => check.id === 'coverage-minimums').rawStatus, 'fail');
  assert.equal(result.vendorCode.value, 'MANUAL');
  assert.equal(result.vendorCode.provenance, 'manual');
  assert.equal(result.expiration.value.expirationDate, '2026-10-01');
  assert.equal(result.expiration.provenance, 'manual');
  assert.equal(result.checks.find((check) => check.id === 'certificate-holder-address').rawStatus, 'pass');
});

test('active current-version override changes only effective status', () => {
  const result = evaluateCoiCompliance({ coi_data: { holder: { name: 'Wrong' } } }, { configVersionId: 'v1', config: { certificateHolder: { nameAliases: ['NCG'] } }, overrides: [{ checkId: 'certificate-holder', configVersionId: 'v1', originalStatus: 'fail' }] });
  const holder = result.checks.find((check) => check.id === 'certificate-holder');
  assert.equal(holder.rawStatus, 'fail');
  assert.equal(holder.effectiveStatus, 'pass');
  assert.equal(holder.provenance, 'override');
});

test('literal result contract contains the complete override-check census', () => {
  const result = evaluateCoiCompliance({ coi_data: { holder: { name: 'NCG', address: '1 Main St' }, endorsements: {}, coverageLines: [] } }, { now: new Date('2026-08-01T00:00:00Z'), configVersionId: 'v1', config: { certificateHolder: { nameAliases: ['NCG'], address: '1 Main Street' } } });
  assert.deepEqual(result.checks.map((check) => check.id), ['named-insured', 'additional-insured', 'waiver-subrogation', 'primary-noncontrib', 'cancellation', 'policy-numbers', 'coverage-minimums', 'certificate-holder', 'certificate-holder-address', 'coverage-active']);
  assert.equal(result.configVersion, 'v1'); assert.equal(result.evaluatedAt, '2026-08-01T00:00:00.000Z');
  assert.ok(Array.isArray(result.coverageFailures)); assert.ok('expiration' in result && 'vendorCode' in result);
  assert.ok(!('carrierRating' in result));
});

test('extracted and unknown precedence tiers are explicit', () => {
  const extracted = evaluateCoiCompliance({ vendor_code: 'PERSISTED', coi_data: { coverageLines: [{ expirationDate: '2026-10-01' }] } }, { now: new Date('2026-08-01T00:00:00Z') });
  assert.equal(extracted.vendorCode.provenance, 'extracted'); assert.equal(extracted.expiration.provenance, 'extracted');
  const unknown = evaluateCoiCompliance({ coi_data: {} }, {});
  assert.equal(unknown.vendorCode.provenance, 'unknown'); assert.equal(unknown.expiration.value.state, 'unknown');
});

test('both override stale triggers preserve raw effective status', () => {
  const base = { coi_data: { holder: { name: 'Wrong' } } }; const options = { configVersionId: 'v2', config: { certificateHolder: { nameAliases: ['NCG'] } } };
  for (const override of [{ checkId: 'certificate-holder', configVersionId: 'v1', originalStatus: 'fail' }, { checkId: 'certificate-holder', configVersionId: 'v2', originalStatus: 'warn' }]) {
    const check = evaluateCoiCompliance(base, { ...options, overrides: [override] }).checks.find((item) => item.id === 'certificate-holder');
    assert.equal(check.code, 'OVERRIDE_STALE'); assert.equal(check.effectiveStatus, 'fail');
  }
});

test('cancellation notice uses extracted days against the configured threshold', () => {
  const status = (days) => evaluateCoiCompliance({ coi_data: { cancellationNoticeDays: days } }, { config: { cancellationNoticeMinimumDays: 30 } }).checks.find((check) => check.id === 'cancellation').rawStatus;
  assert.equal(status(29), 'warn');
  assert.equal(status(30), 'pass');
  assert.notEqual(status(undefined), 'pass');
});

test('carrier rating is fully removed: no check, no result field, stale data and overrides are inert', () => {
  const result = evaluateCoiCompliance(
    { coi_manual_values: { carrierRating: { value: 'A+ I' } }, coi_data: { carrierRating: 'A- VII' } },
    { configVersionId: 'v1', overrides: [{ checkId: 'carrier-rating', configVersionId: 'v1', originalStatus: 'warn' }] }
  );
  assert.ok(!('carrierRating' in result));
  assert.ok(!result.checks.some((check) => check.id === 'carrier-rating'));
  assert.ok(!result.blockers.some((blocker) => blocker.code === 'carrier-rating'));
});

test('effective config resolves holder and coverage inputs without displacing manual or extracted tiers', () => {
  const config = {
    certificateHolder: { nameAliases: ['NCG'], address: '1 Main Street' },
    coverageRequirements: [{ type: 'general', required: true, limits: [{ key: 'each', minimum: 100 }] }],
  };
  const document = {
    vendor_code: 'EXTRACTED-VENDOR',
    coi_manual_values: { vendorCode: { value: 'MANUAL-VENDOR' } },
    coi_data: { holder: { name: 'NCG', address: '1 Main St' }, coverageLines: [{ type: 'general', limits: { each: 100 }, expirationDate: '2026-10-01' }] },
  };
  const raw = resolveCoiValues(document, config, new Date('2026-08-01T00:00:00Z'));
  assert.equal(raw.values.holderExpectation.provenance, 'config');
  assert.deepEqual(raw.values.holderExpectation.value, config.certificateHolder);
  assert.equal(raw.values.coverageRequirements.provenance, 'config');
  assert.deepEqual(raw.values.coverageRequirements.value, config.coverageRequirements);
  assert.equal(raw.values.vendorCode.value, 'MANUAL-VENDOR');
  assert.equal(raw.values.vendorCode.provenance, 'manual');
  assert.equal(raw.values.expiration.provenance, 'extracted');
  const result = evaluateCoiCompliance(document, { config, now: new Date('2026-08-01T00:00:00Z') });
  assert.equal(result.checks.find((check) => check.id === 'certificate-holder').rawStatus, 'pass');
  assert.equal(result.checks.find((check) => check.id === 'coverage-minimums').rawStatus, 'pass');
});

test('persisted coverage aliases and numeric limits produce precise failures', () => {
  const requirement = { type: 'general-liability', label: 'Commercial General Liability', required: true, limits: [{ key: 'eachOccurrence', label: 'Each Occurrence', minimum: 1000000 }] };
  const config = { coverageRequirements: [requirement], coverageTypeAliases: { CGL: 'general-liability' } };
  const coverage = (coverageLines, options = { config }) => evaluateCoiCompliance({ coi_data: { coverageLines } }, options);
  const failure = (result) => result.coverageFailures[0];

  const aliasMatch = coverage([{ type: 'cgl', limits: { eachOccurrence: 1000000 } }]);
  assert.equal(aliasMatch.checks.find((check) => check.id === 'coverage-minimums').rawStatus, 'pass');
  assert.deepEqual(aliasMatch.coverageFailures, []);

  const absent = coverage([]);
  assert.equal(absent.checks.find((check) => check.id === 'coverage-minimums').rawStatus, 'fail');
  assert.deepEqual(failure(absent), { coverageId: 'general-liability', coverageLabel: 'Commercial General Liability', limitLabel: 'Each Occurrence', value: null, minimum: 1000000 });

  const missingLimit = coverage([{ type: 'CGL', limits: {} }]);
  assert.equal(missingLimit.checks.find((check) => check.id === 'coverage-minimums').rawStatus, 'fail');
  assert.deepEqual(failure(missingLimit), { coverageId: 'general-liability', coverageLabel: 'Commercial General Liability', limitLabel: 'Each Occurrence', value: null, minimum: 1000000 });

  const belowMinimum = coverage([{ type: 'CGL', limits: { eachOccurrence: 999999 } }]);
  assert.equal(belowMinimum.checks.find((check) => check.id === 'coverage-minimums').rawStatus, 'fail');
  assert.deepEqual(failure(belowMinimum), { coverageId: 'general-liability', coverageLabel: 'Commercial General Liability', limitLabel: 'Each Occurrence', value: 999999, minimum: 1000000 });

  const unconfigured = coverage([], { config: {} });
  assert.equal(unconfigured.checks.find((check) => check.id === 'coverage-minimums').rawStatus, 'pass');
  assert.deepEqual(unconfigured.coverageFailures, []);
});

test('a normalized-different holder address warns without blocking while name mismatch fails', () => {
  const result = evaluateCoiCompliance({
    vendor_code: 'V1',
    coi_data: { holder: { name: 'Different Company', address: '100 Northside Road, Suite 7' }, coverageLines: [] },
  }, {
    config: { certificateHolder: { nameAliases: ['NCG'], address: '500 Example Gateway, Suite 180, Springfield, GA 30000' } },
  });
  const name = result.checks.find((check) => check.id === 'certificate-holder');
  const address = result.checks.find((check) => check.id === 'certificate-holder-address');
  assert.equal(name.rawStatus, 'fail');
  assert.equal(name.effectiveStatus, 'fail');
  assert.equal(address.rawStatus, 'warn');
  assert.equal(address.effectiveStatus, 'warn');
  assert.ok(!result.blockers.some((blocker) => blocker.code === 'certificate-holder-address'));
});

test('omitted warnWindowDays uses injected server time and defaults to thirty days', () => {
  const now = new Date('2026-08-01T12:00:00.000Z');
  const evaluate = (expirationDate) => evaluateCoiCompliance({ coi_data: { cancellationNoticeDays: 60, coverageLines: [{ expirationDate }] } }, {
    now,
    config: { cancellationNoticeMinimumDays: 60 },
  });
  const atThirty = evaluate('2026-08-31');
  assert.equal(atThirty.expiration.value.daysRemaining, 30);
  assert.equal(atThirty.expiration.value.state, 'expiring-soon');
  assert.equal(atThirty.checks.find((check) => check.id === 'coverage-active').rawStatus, 'warn');
  assert.equal(atThirty.checks.find((check) => check.id === 'cancellation').rawStatus, 'pass');
  const atThirtyOne = evaluate('2026-09-01');
  assert.equal(atThirtyOne.expiration.value.daysRemaining, 31);
  assert.equal(atThirtyOne.expiration.value.state, 'active');
  assert.equal(atThirtyOne.checks.find((check) => check.id === 'coverage-active').rawStatus, 'pass');
});

test('Exhibit E enforces raised umbrella and reduced workers compensation limits', () => {
  const config = { coverageRequirements: [
    { type: 'umbrella', label: 'Umbrella', required: true, limits: [{ key: 'eachOccurrence', label: 'Each Occurrence', minimum: 2000000 }, { key: 'aggregate', label: 'Aggregate', minimum: 2000000 }] },
    { type: 'workers-comp', label: 'Workers Compensation', required: true, limits: [{ key: 'eachAccident', label: 'Each Accident', minimum: 500000 }, { key: 'diseaseEachEmployee', label: 'Disease - Each Employee', minimum: 500000 }, { key: 'diseasePolicyLimit', label: 'Disease - Policy Limit', minimum: 500000 }] },
  ] };
  const failed = evaluateCoiCompliance({ coi_data: { coverageLines: [{ type: 'umbrella', limits: { eachOccurrence: 1000000, aggregate: 2000000 } }, { type: 'workers-comp', limits: { eachAccident: 500000, diseaseEachEmployee: 500000, diseasePolicyLimit: 500000 } }] } }, { config });
  assert.equal(failed.checks.find((check) => check.id === 'coverage-minimums').rawStatus, 'fail');
  assert.deepEqual(failed.coverageFailures[0], { coverageId: 'umbrella', coverageLabel: 'Umbrella', limitLabel: 'Each Occurrence', value: 1000000, minimum: 2000000 });
  const passed = evaluateCoiCompliance({ coi_data: { coverageLines: [{ type: 'umbrella', limits: { eachOccurrence: 2000000, aggregate: 2000000 } }, { type: 'workers-comp', limits: { eachAccident: 500000, diseaseEachEmployee: 500000, diseasePolicyLimit: 500000 } }] } }, { config });
  assert.equal(passed.checks.find((check) => check.id === 'coverage-minimums').rawStatus, 'pass');
});

test('Exhibit E exception limits are informational even when missing or below minimum', () => {
  const config = { coverageRequirements: [{ type: 'general-liability', label: 'General Liability', required: true, limits: [{ key: 'eachOccurrence', label: 'Each Occurrence', minimum: 1000000 }, { key: 'damageToRented', label: 'Damage to Rented', minimum: 50000, tier: 'exception' }, { key: 'medicalExpense', label: 'Medical Expense', minimum: 5000, tier: 'exception' }] }] };
  const missingLine = evaluateCoiCompliance({ coi_data: { coverageLines: [] } }, { config });
  assert.equal(missingLine.checks.find((check) => check.id === 'coverage-minimums').rawStatus, 'fail');
  assert.deepEqual(missingLine.coverageExceptions, [{ coverageId: 'general-liability', coverageLabel: 'General Liability', limitLabel: 'Damage to Rented', value: null, minimum: 50000 }, { coverageId: 'general-liability', coverageLabel: 'General Liability', limitLabel: 'Medical Expense', value: null, minimum: 5000 }]);
  const exceptionOnly = evaluateCoiCompliance({ coi_data: { coverageLines: [{ type: 'general-liability', limits: { eachOccurrence: 1000000, damageToRented: 1 } }] } }, { config });
  assert.equal(exceptionOnly.checks.find((check) => check.id === 'coverage-minimums').rawStatus, 'pass');
  assert.ok(!exceptionOnly.blockers.some((blocker) => blocker.code === 'coverage-minimums'));
  assert.deepEqual(exceptionOnly.coverageFailures, []);
  assert.deepEqual(exceptionOnly.coverageExceptions, [{ coverageId: 'general-liability', coverageLabel: 'General Liability', limitLabel: 'Damage to Rented', value: 1, minimum: 50000 }, { coverageId: 'general-liability', coverageLabel: 'General Liability', limitLabel: 'Medical Expense', value: null, minimum: 5000 }]);
});

test('Exhibit E warning demotions remain review-required while unknown and expired coverage stay blocking', () => {
  const warning = evaluateCoiCompliance({ vendor_code: 'V1', coi_data: { holder: { name: 'NCG' }, cancellationNoticeDays: 29, endorsements: { additionalInsured: true }, coverageLines: [{ policyNumber: 'P1', expirationDate: '2026-10-01' }] } }, { now: new Date('2026-08-01T00:00:00Z'), config: { cancellationNoticeMinimumDays: 30, certificateHolder: { nameAliases: ['NCG'] } } });
  assert.equal(warning.checks.find((check) => check.id === 'waiver-subrogation').rawStatus, 'warn');
  assert.equal(warning.checks.find((check) => check.id === 'cancellation').rawStatus, 'warn');
  assert.equal(warning.uploadReady, true);
  for (const expirationDate of [undefined, '2026-07-30']) {
    const result = evaluateCoiCompliance({ vendor_code: 'V1', coi_data: { coverageLines: expirationDate ? [{ expirationDate }] : [] } }, { now: new Date('2026-08-01T00:00:00Z') });
    assert.equal(result.checks.find((check) => check.id === 'coverage-active').rawStatus, 'fail');
    assert.equal(result.uploadReady, false);
  }
});

test('optional Exhibit E pollution and professional coverage never fail when absent or below minimum', () => {
  const config = { coverageRequirements: [
    { type: 'pollution', label: 'Pollution', required: false, limits: [{ key: 'eachLoss', label: 'Each Loss', minimum: 1000000 }] },
    { type: 'professional', label: 'Professional', required: false, limits: [{ key: 'aggregate', label: 'Aggregate', minimum: 2000000 }] },
  ] };
  for (const coverageLines of [[], [{ type: 'pollution', limits: { eachLoss: 1 } }, { type: 'professional', limits: { aggregate: 1 } }]]) {
    const result = evaluateCoiCompliance({ coi_data: { coverageLines } }, { config });
    assert.equal(result.checks.find((check) => check.id === 'coverage-minimums').rawStatus, 'pass');
    assert.deepEqual(result.coverageFailures, []);
  }
});
const detailOf = (result, id) => result.checks.find((check) => check.id === id).detail;
const NA54_HOLDER_CONFIG = { name: 'Northwind Contracting Group Inc.', address: '500 Example Gateway, Suite 180, Springfield, GA 30000', nameAliases: ['Northwind Contracting Group', 'NCG'] };

test('certificate holder details explain found versus expected values', () => {
  const na54 = evaluateCoiCompliance({ vendor_code: 'V1', coi_data: { holder: { name: 'Northwind', address: 'Ste 100 200 Oak Pkwy N Bldg 100, Springfield GA 30062' } } }, { config: { certificateHolder: NA54_HOLDER_CONFIG } });
  assert.equal(na54.checks.find((check) => check.id === 'certificate-holder').rawStatus, 'fail');
  assert.equal(detailOf(na54, 'certificate-holder'), 'COI lists "Northwind". Expected "Northwind Contracting Group Inc.".');
  assert.equal(na54.checks.find((check) => check.id === 'certificate-holder-address').rawStatus, 'warn');
  assert.equal(detailOf(na54, 'certificate-holder-address'), 'COI lists "Ste 100 200 Oak Pkwy N Bldg 100, Springfield GA 30062". Expected "500 Example Gateway, Suite 180, Springfield, GA 30000".');
  const missing = evaluateCoiCompliance({ coi_data: { holder: {} } }, { config: { certificateHolder: NA54_HOLDER_CONFIG } });
  assert.equal(detailOf(missing, 'certificate-holder'), 'No certificate holder found on the COI. Expected "Northwind Contracting Group Inc.".');
  assert.equal(detailOf(missing, 'certificate-holder-address'), 'No holder address found on the COI. Expected "500 Example Gateway, Suite 180, Springfield, GA 30000".');
  const multiline = evaluateCoiCompliance({ coi_data: { holder: { name: 'Other', address: '1 Main St\nSuite 2\r\nAtlanta, GA' } } }, { config: { certificateHolder: NA54_HOLDER_CONFIG } });
  assert.equal(detailOf(multiline, 'certificate-holder-address'), 'COI lists "1 Main St, Suite 2, Atlanta, GA". Expected "500 Example Gateway, Suite 180, Springfield, GA 30000".');
  const unconfigured = evaluateCoiCompliance({ coi_data: { holder: { name: 'Other', address: '1 Main St' } } }, { config: {} });
  assert.equal(detailOf(unconfigured, 'certificate-holder'), 'No NCG certificate holder configured in COI settings.');
  assert.equal(detailOf(unconfigured, 'certificate-holder-address'), 'No NCG holder address configured in COI settings.');
});

test('upload blocker messages reuse the plain-English check detail, not internal check ids', () => {
  const na54 = evaluateCoiCompliance({ vendor_code: null, coi_data: { holder: { name: 'Northwind' } } }, { config: { certificateHolder: NA54_HOLDER_CONFIG } });
  const holder = na54.blockers.find((blocker) => blocker.code === 'certificate-holder');
  assert.equal(holder.message, 'COI lists "Northwind". Expected "Northwind Contracting Group Inc.".');
  assert.equal(na54.blockers.find((blocker) => blocker.code === 'MISSING_VENDOR_CODE').message, 'No vendor selected. Pick the vendor this COI belongs to.');
  for (const blocker of na54.blockers) assert.doesNotMatch(blocker.message, / failed$/);
});

test('cancellation detail distinguishes a missing notice period from a short one', () => {
  const detail = (days) => detailOf(evaluateCoiCompliance({ coi_data: { cancellationNoticeDays: days } }, { config: { cancellationNoticeMinimumDays: 30 } }), 'cancellation');
  assert.equal(detail(undefined), 'No cancellation notice period found on the COI. Required: 30 days.');
  assert.equal(detail(10), 'COI gives 10 days cancellation notice. Required: 30 days.');
  assert.equal(detail(30), 'Cancellation notice: pass');
});

test('coverage minimums detail lists the first two failures with money and a remainder count', () => {
  const config = { coverageRequirements: [
    { type: 'general-liability', label: 'General Liability', required: true, limits: [{ key: 'eachOccurrence', label: 'Each Occurrence', minimum: 1000000 }, { key: 'aggregate', label: 'Aggregate', minimum: 2000000 }] },
    { type: 'auto', label: 'Auto Liability', required: true, limits: [{ key: 'combinedSingle', label: 'Combined Single Limit', minimum: 1000000 }, { key: 'bodily', label: 'Bodily Injury', minimum: 500000 }] },
  ] };
  const many = evaluateCoiCompliance({ coi_data: { coverageLines: [{ type: 'general-liability', limits: { eachOccurrence: 500000 } }] } }, { config });
  assert.equal(detailOf(many, 'coverage-minimums'), 'General Liability Each Occurrence is $500,000; required $1,000,000. General Liability Aggregate not found; required $2,000,000. Plus 2 more.');
  const one = evaluateCoiCompliance({ coi_data: { coverageLines: [{ type: 'general-liability', limits: { eachOccurrence: 1000000, aggregate: 2000000 } }, { type: 'auto', limits: { combinedSingle: 1000000, bodily: 250000 } }] } }, { config });
  assert.equal(detailOf(one, 'coverage-minimums'), 'Auto Liability Bodily Injury is $250,000; required $500,000.');
});

test('coverage-active detail reports expired, expiring-soon, and missing dates', () => {
  const now = new Date('2026-08-01T12:00:00.000Z');
  const detail = (coverageLines) => detailOf(evaluateCoiCompliance({ coi_data: { coverageLines } }, { now }), 'coverage-active');
  assert.equal(detail([{ expirationDate: '2026-07-15' }]), 'Coverage expired 07/15/2026.');
  assert.equal(detail([{ expirationDate: '2026-08-20' }]), 'Coverage expires 08/20/2026 (in 19 days).');
  assert.equal(detail([]), 'No expiration date found on the COI.');
  assert.equal(detail([{ expirationDate: '2026-12-31' }]), 'Coverage dates are active: pass');
});

test('warn and fail details for endorsements, vendor, and policy numbers are plain English', () => {
  const result = evaluateCoiCompliance({ coi_data: { endorsements: {}, coverageLines: [] } }, {});
  assert.equal(detailOf(result, 'named-insured'), 'No vendor selected. Pick the vendor this COI belongs to.');
  assert.equal(detailOf(result, 'additional-insured'), 'COI does not show an additional insured endorsement.');
  assert.equal(detailOf(result, 'waiver-subrogation'), 'COI does not show a waiver of subrogation.');
  assert.equal(detailOf(result, 'primary-noncontrib'), 'COI does not show primary and noncontributory wording.');
  assert.equal(detailOf(result, 'policy-numbers'), 'No policy numbers found on the COI.');
  for (const check of result.checks) assert.ok(!check.detail.includes('\u2014'), `${check.id} detail must not contain an em dash`);
});

test('passing checks keep the legacy label-colon-pass detail text', () => {
  const result = evaluateCoiCompliance({ vendor_code: 'V1', coi_data: { holder: { name: 'NCG', address: '1 Main St' }, cancellationNoticeDays: 30, endorsements: { additionalInsured: true, waiverOfSubrogation: true, primaryNoncontributory: true }, coverageLines: [{ policyNumber: 'P1', expirationDate: '2026-12-31' }] } }, { now: new Date('2026-08-01T00:00:00Z'), config: { cancellationNoticeMinimumDays: 30, certificateHolder: { nameAliases: ['NCG'], address: '1 Main Street' } } });
  assert.equal(result.verdict, 'compliant');
  for (const check of result.checks) assert.equal(check.detail, `${check.label}: pass`);
  const raw = resolveCoiValues({ vendor_code: 'V1' }, {}, new Date('2026-08-01T00:00:00Z'));
  assert.equal(raw.checks.find((check) => check.id === 'named-insured').detail, 'Named insured matches vendor: pass');
});

test('stale override appends the no-longer-applies suffix while fresh overrides keep the plain detail', () => {
  const document = { coi_data: { holder: { name: 'Northwind' } } }; const config = { certificateHolder: NA54_HOLDER_CONFIG };
  const stale = evaluateCoiCompliance(document, { configVersionId: 'v2', config, overrides: [{ checkId: 'certificate-holder', configVersionId: 'v1', originalStatus: 'fail' }] }).checks.find((check) => check.id === 'certificate-holder');
  assert.equal(stale.code, 'OVERRIDE_STALE');
  assert.equal(stale.detail, 'COI lists "Northwind". Expected "Northwind Contracting Group Inc.". An earlier approval no longer applies because the check result changed.');
  const fresh = evaluateCoiCompliance(document, { configVersionId: 'v1', config, overrides: [{ checkId: 'certificate-holder', configVersionId: 'v1', originalStatus: 'fail' }] }).checks.find((check) => check.id === 'certificate-holder');
  assert.equal(fresh.provenance, 'override');
  assert.equal(fresh.detail, 'COI lists "Northwind". Expected "Northwind Contracting Group Inc.".');
});

test('holder address normalization ignores street directionals and a trailing country but still warns on real mismatches', () => {
  const evaluate = (address) => evaluateCoiCompliance({ vendor_code: 'V1', coi_data: { holder: { name: 'Northwind', address } } }, { config: { certificateHolder: NA54_HOLDER_CONFIG } });
  const addressStatus = (address) => evaluate(address).checks.find((check) => check.id === 'certificate-holder-address').rawStatus;
  for (const address of ['500 Example Gateway SE, Suite 180\nSpringfield GA 30000', '500 Example Gateway SE\nSuite #180\nSpringfield, GA 30000', '500 Example Gateway Ste 180, Springfield GA 30000 USA', '500 Example Gateway Ste 180, Springfield GA 30000']) {
    assert.equal(addressStatus(address), 'pass', address);
    assert.equal(detailOf(evaluate(address), 'certificate-holder-address'), 'Certificate holder address matches: pass');
  }
  for (const address of ['520 Example Gateway Ste 180, Springfield GA 30000 USA', 'Ste 100 200 Oak Pkwy N Bldg 100, Springfield GA 30062', '500 Example Gateway, Suite 100, Springfield, GA 30000']) assert.equal(addressStatus(address), 'warn', address);
  const name = evaluate('500 Example Gateway SE, Suite 180\nSpringfield GA 30000').checks.find((check) => check.id === 'certificate-holder');
  assert.equal(name.rawStatus, 'fail');
  assert.equal(name.detail, 'COI lists "Northwind". Expected "Northwind Contracting Group Inc.".');
});

test('an override on a check that now passes is moot: no stale code and the plain pass detail', () => {
  const result = evaluateCoiCompliance({ vendor_code: 'V1', status: 'pending', coi_data: { holder: { name: 'Northwind Contracting Group', address: '500 Example Gateway SE, Suite 180\nSpringfield GA 30000' } } }, { configVersionId: 'v2-exhibit-e', config: { certificateHolder: NA54_HOLDER_CONFIG }, overrides: [{ checkId: 'certificate-holder-address', configVersionId: 'v1', originalStatus: 'warn' }] });
  const address = result.checks.find((check) => check.id === 'certificate-holder-address');
  assert.equal(address.rawStatus, 'pass');
  assert.equal(address.effectiveStatus, 'pass');
  assert.equal(address.provenance, 'computed');
  assert.ok(!('code' in address));
  assert.equal(address.detail, 'Certificate holder address matches: pass');
  assert.ok(!result.checks.some((check) => check.code === 'OVERRIDE_STALE'));
});

const FILED_COI = { vendor_code: 'V1', coi_data: { holder: { name: 'Northwind', address: '500 Example Gateway, Suite 180, Springfield, GA 30000' }, cancellationNoticeDays: 30, endorsements: { additionalInsured: true, waiverOfSubrogation: true, primaryNoncontributory: true }, coverageLines: [{ policyNumber: 'P1', expirationDate: '2026-12-31' }] } };
const FILED_OPTIONS = { now: new Date('2026-08-01T00:00:00Z'), configVersionId: 'v2-exhibit-e', config: { cancellationNoticeMinimumDays: 30, certificateHolder: NA54_HOLDER_CONFIG }, overrides: [{ checkId: 'certificate-holder', configVersionId: 'v1', originalStatus: 'fail' }] };

test('a submitted COI keeps the approvals it was filed with even under a newer config version', () => {
  const result = evaluateCoiCompliance({ ...FILED_COI, status: 'submitted' }, FILED_OPTIONS);
  const holder = result.checks.find((check) => check.id === 'certificate-holder');
  assert.equal(holder.rawStatus, 'fail');
  assert.equal(holder.effectiveStatus, 'pass');
  assert.equal(holder.provenance, 'override');
  assert.ok(!('code' in holder));
  assert.equal(holder.detail, 'COI lists "Northwind". Expected "Northwind Contracting Group Inc.".');
  assert.equal(result.verdict, 'compliant');
  assert.deepEqual(result.blockers, []);
  const changedStatus = evaluateCoiCompliance({ ...FILED_COI, status: 'submitted' }, { ...FILED_OPTIONS, overrides: [{ check_id: 'certificate-holder', config_version_id: 'v1', original_status: 'warn' }] }).checks.find((check) => check.id === 'certificate-holder');
  assert.equal(changedStatus.effectiveStatus, 'pass');
  assert.ok(!('code' in changedStatus));
});

test('a pending COI with the same older-version approvals is still stale and non-compliant', () => {
  const result = evaluateCoiCompliance({ ...FILED_COI, status: 'pending' }, FILED_OPTIONS);
  const holder = result.checks.find((check) => check.id === 'certificate-holder');
  assert.equal(holder.code, 'OVERRIDE_STALE');
  assert.equal(holder.effectiveStatus, 'fail');
  assert.equal(holder.provenance, 'computed');
  assert.equal(result.verdict, 'non-compliant');
});

test('a submitted COI never honors a revoked override', () => {
  for (const revoked of [{ revokedAt: '2026-07-01T00:00:00Z' }, { revoked_at: '2026-07-01T00:00:00Z' }]) {
    const result = evaluateCoiCompliance({ ...FILED_COI, status: 'submitted' }, { ...FILED_OPTIONS, overrides: [{ ...FILED_OPTIONS.overrides[0], ...revoked }] });
    const holder = result.checks.find((check) => check.id === 'certificate-holder');
    assert.equal(holder.effectiveStatus, 'fail');
    assert.equal(holder.provenance, 'computed');
    assert.equal(result.verdict, 'non-compliant');
  }
});
