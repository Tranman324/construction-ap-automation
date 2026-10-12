import { beforeEach, describe, expect, it, vi } from 'vitest';

const EXPECTED_INVOICE_KEYS = [
  'accounting.invoices.view',
  'accounting.invoices.view_details',
  'accounting.invoices.approve',
  'accounting.invoices.reject',
  'accounting.invoices.delete',
  'accounting.invoices.manage_retention',
  'accounting.invoices.manage_splits',
  'accounting.invoices.export',
  'accounting.invoices.submit_spectrum',
  'accounting.invoices.request_waiver',
  'accounting.invoices.coi_override',
  'accounting.invoices.manage_settings',
] as const;

function sortPermissions(permissions: readonly string[]): string[] {
  return [...permissions].sort();
}

beforeEach(() => {
  vi.resetModules();
});

describe('INVOICE_PERMISSIONS', () => {
  it('contains exactly the expected invoice permission keys', async () => {
    const { INVOICE_PERMISSIONS } = await import('@/modules/accounting/modules/invoices/permissions');

    expect(sortPermissions(Object.keys(INVOICE_PERMISSIONS))).toEqual(
      sortPermissions(EXPECTED_INVOICE_KEYS),
    );
  });

  it('registers the invoice manifest keys when the side-effect module loads', async () => {
    await import('@/modules/accounting/modules/invoices/register');
    const { getModulePermissions } = await import('@/modules/shared/lib/permissionRegistry');

    expect(sortPermissions(getModulePermissions('accounting') ?? [])).toEqual(
      sortPermissions(EXPECTED_INVOICE_KEYS),
    );
  });
});
