'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  adminUserPatchSchema,
  coiComplianceConfigSchema,
  ignoreRuleSchema,
  invoiceUpdateSchema,
} = require('../lib/schemas');

test('adminUserPatchSchema strictly validates role and active updates', () => {
  assert.equal(adminUserPatchSchema.safeParse({ role_id: 'role-123' }).success, true);
  assert.equal(adminUserPatchSchema.safeParse({ is_active: false }).success, true);
  assert.equal(adminUserPatchSchema.safeParse({ role_id: 'role-123', is_active: true }).success, true);

  assert.equal(adminUserPatchSchema.safeParse({}).success, false);
  assert.equal(adminUserPatchSchema.safeParse({ role_id: 'role-123', name: 'Not allowed' }).success, false);
  assert.equal(adminUserPatchSchema.safeParse({ is_active: 'false' }).success, false);
});

test('coiComplianceConfigSchema round-trips Exhibit E fields and remains strict', () => {
  const config = {
    certificateHolder: { name: 'NCG', nameAliases: ['ncg'], address: '1 Main Street' },
    cancellationNoticeMinimumDays: 30,
    warnWindowDays: 30,
    coverageRequirements: [{ type: 'general-liability', label: 'General Liability', required: true, limits: [{ key: 'damageToRented', label: 'Damage to Rented', minimum: 50000, tier: 'exception' }] }],
    coverageTypeAliases: { cgl: 'general-liability' },
  };
  const parsed = coiComplianceConfigSchema.parse(config);
  assert.deepEqual(parsed, config);
  assert.equal(coiComplianceConfigSchema.safeParse({ ...config, unexpected: true }).success, false);
  // carrierRating was removed from the engine and the config contract entirely.
  assert.equal(coiComplianceConfigSchema.safeParse({ ...config, carrierRating: { minRating: 'A-', minFsc: 'VII' } }).success, false);
  assert.equal(coiComplianceConfigSchema.safeParse({ ...config, coverageRequirements: [{ ...config.coverageRequirements[0], limits: [{ ...config.coverageRequirements[0].limits[0], tier: 'warning' }] }] }).success, false);
});

test('ignoreRuleSchema rejects html-like values instead of storing executable markup', () => {
  assert.equal(ignoreRuleSchema.safeParse({
    type: 'sender',
    value: 'vendor@example.com',
    reason: 'recurring statement',
  }).success, true);

  assert.equal(ignoreRuleSchema.safeParse({
    type: 'sender',
    value: '<img src=x onerror=alert(1)>',
    reason: '',
  }).success, false);
});

test('invoiceUpdateSchema rejects lien-waiver links outside the dedicated link endpoint', () => {
  assert.equal(invoiceUpdateSchema.safeParse({ vendorCode: 'ZVEN91' }).success, true);
  assert.equal(invoiceUpdateSchema.safeParse({ linkedLienWaiverId: 'waiver-1' }).success, false);
  assert.equal(invoiceUpdateSchema.safeParse({ linkedLienWaiverId: null }).success, false);
});
