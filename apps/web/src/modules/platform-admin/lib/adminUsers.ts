import {
  ADMIN_SECTION_QUERY_PARAM,
  ADMIN_USER_ID_QUERY_PARAM,
} from "@/modules/platform-admin/lib/constants";
import {
  formatAdminRoleLabel,
  normalizeAdminUserRole,
  normalizeRoleOptionsFromUsers,
} from "@/modules/platform-admin/lib/adminRoles";
import type { AdminRole, AdminUser, AdminUserRole } from "@/modules/platform-admin/types/admin";
import {
  formatPlatformLastLogin,
  normalizePlatformUser,
  PLATFORM_PROFILE_PHOTO_SIZE,
  resolvePlatformUserPhotoUrl,
} from "@/modules/shared/lib/userProfile";

export const ALL_ROLES_FILTER = "all";

export type AdminUserStatusFilter = "all" | "active" | "inactive";

/**
 * Format last login for admin displays.
 * Delegates to the shared platform formatter.
 */
export function formatAdminLastLogin(iso: string | null): string {
  return formatPlatformLastLogin(iso);
}

export function getAdminUserRoleLabel(user: AdminUser): string {
  return formatAdminRoleLabel(user.role?.name);
}

export function getAdminUserAvatarUrl(user: AdminUser): string | null {
  return resolvePlatformUserPhotoUrl(user, { preferredSize: PLATFORM_PROFILE_PHOTO_SIZE });
}

export function normalizeAdminUsers(users: AdminUser[]): AdminUser[] {
  return users.map((user) => ({
    ...normalizePlatformUser(user, { preferredSize: PLATFORM_PROFILE_PHOTO_SIZE }),
    role: normalizeAdminUserRole(user.role),
  }));
}

export function matchesAdminUserSearch(user: AdminUser, rawSearch: string): boolean {
  const query = rawSearch.trim().toLowerCase();

  if (!query) {
    return true;
  }

  return [user.name, user.email, user.job_title ?? ""].some((value) =>
    value.toLowerCase().includes(query),
  );
}

export function isAdminEquivalentRole(role: AdminRole | AdminUserRole | null | undefined): boolean {
  if (!role) {
    return false;
  }

  const normalizedName = role.name.trim().toLowerCase();
  return role.is_system || normalizedName === "admin" || normalizedName === "platform admin";
}

export function buildAdminOverridesHref(userId: string): string {
  const params = new URLSearchParams({
    [ADMIN_SECTION_QUERY_PARAM]: "overrides",
    [ADMIN_USER_ID_QUERY_PARAM]: userId,
  });

  return `/admin?${params.toString()}`;
}

export function deriveAdminRoleOptions(users: AdminUser[]): AdminRole[] {
  return normalizeRoleOptionsFromUsers(users);
}
