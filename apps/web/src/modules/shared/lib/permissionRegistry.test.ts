import { beforeEach, describe, expect, it, vi } from 'vitest';

function sortPermissions(permissions: string[]): string[] {
  return [...permissions].sort();
}

beforeEach(() => {
  vi.resetModules();
});

describe('permissionRegistry', () => {
  it('returns registered keys from a single manifest', async () => {
    const { getAllPermissions, registerModulePermissions } = await import('@/modules/shared/lib/permissionRegistry');

    registerModulePermissions('accounting', {
      'accounting.invoices.view': 'View invoices',
      'accounting.invoices.approve': 'Approve invoices',
    });

    expect(sortPermissions(getAllPermissions())).toEqual(
      sortPermissions(['accounting.invoices.approve', 'accounting.invoices.view']),
    );
  });

  it('returns the union of permissions across modules', async () => {
    const { getAllPermissions, registerModulePermissions } = await import('@/modules/shared/lib/permissionRegistry');

    registerModulePermissions('accounting', {
      'accounting.invoices.view': 'View invoices',
    });
    registerModulePermissions('projects', {
      'projects.view': 'View projects',
    });

    expect(sortPermissions(getAllPermissions())).toEqual(
      sortPermissions(['accounting.invoices.view', 'projects.view']),
    );
  });

  it('re-registering a module replaces the manifest instead of appending', async () => {
    const { getModulePermissions, registerModulePermissions } = await import('@/modules/shared/lib/permissionRegistry');

    registerModulePermissions('accounting', {
      'accounting.invoices.view': 'View invoices',
      'accounting.invoices.approve': 'Approve invoices',
    });
    registerModulePermissions('accounting', {
      'accounting.invoices.export': 'Export invoices',
    });

    expect(sortPermissions(getModulePermissions('accounting') ?? [])).toEqual(['accounting.invoices.export']);
  });

  it('returns undefined for an unknown module', async () => {
    const { getModulePermissions } = await import('@/modules/shared/lib/permissionRegistry');

    expect(getModulePermissions('unknown')).toBeUndefined();
  });

  it('returns the registered platform permission union after registration imports load', async () => {
    await import('@/modules/feature-requests/register');
    await import('@/modules/accounting/register');
    await import('@/modules/platform-admin/register');
    await import('@/modules/projects/register');
    const { INVOICE_PERMISSIONS } = await import('@/modules/accounting/modules/invoices/permissions');
    const { getAllPermissions } = await import('@/modules/shared/lib/permissionRegistry');

    expect(sortPermissions(getAllPermissions())).toEqual(
      sortPermissions([
        ...Object.keys(INVOICE_PERMISSIONS),
        'feature_requests.view',
        'feature_requests.manage',
        'platform.admin',
        'projects.view',
      ]),
    );
  });
});
