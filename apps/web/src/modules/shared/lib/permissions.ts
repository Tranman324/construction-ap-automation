import type { PermissionKey } from '@/modules/shared/types/permissions';

interface ResolvePermissionsInput {
  isAdmin: boolean;
  rolePermissions: PermissionKey[];
  userOverrides: Record<string, boolean>;
}

export function resolvePermissions(
  input: ResolvePermissionsInput,
  key: PermissionKey,
): boolean {
  if (input.isAdmin) {
    return true;
  }

  if (Object.prototype.hasOwnProperty.call(input.userOverrides, key)) {
    return input.userOverrides[key] ?? false;
  }

  if (input.rolePermissions.includes(key)) {
    return true;
  }

  return false;
}

export function hasPermission(permissions: PermissionKey[], key: PermissionKey): boolean {
  return permissions.includes('*') || permissions.includes(key);
}