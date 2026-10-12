import { describe, expect, it } from 'vitest';
import type {
  PermissionManifest,
  RoutePermission,
  UserPermissions,
} from '@/modules/shared/types/permissions';

describe('permissions types', () => {
  it('accept the documented permission shapes', () => {
    const manifest: PermissionManifest = {
      'accounting.invoices.approve': 'Approve invoice submissions',
      'projects.view': 'View project records',
    };
    const routePermission: RoutePermission = {
      path: '/accounting/invoices',
      permission: 'accounting.invoices.view',
    };
    const userPermissions: UserPermissions = {
      role: 'admin',
      roleId: 'role_admin',
      isAdmin: true,
      permissions: ['accounting.invoices.view', 'projects.view'],
    };

    expect(manifest['accounting.invoices.approve']).toBe('Approve invoice submissions');
    expect(routePermission.permission).toBe('accounting.invoices.view');
    expect(userPermissions.permissions).toContain('projects.view');
  });
});