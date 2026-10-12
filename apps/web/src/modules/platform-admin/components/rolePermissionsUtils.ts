import type { AdminRole } from "@/modules/platform-admin/types/admin";
import { formatAdminRoleName } from "@/modules/platform-admin/lib/adminRoles";

export const EMPTY_ROLES: AdminRole[] = [];
export const EMPTY_PERMISSIONS: string[] = [];

export function isProtectedRole(role: AdminRole | null): boolean {
  return Boolean(role && (role.is_system || /admin/i.test(role.name)));
}

export function getReadOnlyMessage(role: AdminRole | null): string | undefined {
  if (!role || !isProtectedRole(role)) {
    return undefined;
  }

  if (/admin/i.test(role.name)) {
    return "Admin bypasses permission checks";
  }

  return `${formatAdminRoleName(role.name)} is read-only in v1.`;
}
