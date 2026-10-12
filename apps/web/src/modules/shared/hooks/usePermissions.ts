import type { PermissionKey } from '@/modules/shared/types/permissions';
import { useAuth } from '@/modules/shared/lib/auth';
import { hasPermission as hasPermissionKey } from '@/modules/shared/lib/permissions';

export function usePermissions() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const isAdmin = user?.isAdmin ?? false;
  const permissions = user?.permissions ?? [];

  function hasResolvedPermission(key: PermissionKey): boolean {
    return isAdmin || hasPermissionKey(permissions, key);
  }

  function hasAnyPermission(keys: PermissionKey[]): boolean {
    return isAdmin || keys.some((key) => hasPermissionKey(permissions, key));
  }

  function hasAllPermissions(keys: PermissionKey[]): boolean {
    return isAdmin || keys.every((key) => hasPermissionKey(permissions, key));
  }

  return {
    hasPermission: hasResolvedPermission,
    hasAnyPermission,
    hasAllPermissions,
    role,
    isAdmin,
    permissions,
  };
}