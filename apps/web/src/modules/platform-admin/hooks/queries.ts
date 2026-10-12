import { useQuery } from "@tanstack/react-query";

import {
  getAdminPermissions,
  getAdminRolePermissions,
  getAdminRoles,
  getAdminTitleRules,
  getAdminUserOverrides,
  getAdminUsers,
} from "@/modules/platform-admin/lib/api";
import {
  normalizeAdminRoles,
  normalizeAdminTitleRules,
} from "@/modules/platform-admin/lib/adminRoles";
import { normalizeAdminUsers } from "@/modules/platform-admin/lib/adminUsers";
import type {
  AdminPermissionsResponse,
  AdminRolePermissionsResponse,
  AdminRolesResponse,
  AdminTitleRulesResponse,
  AdminUserOverridesResponse,
  AdminUsersResponse,
} from "@/modules/platform-admin/types/admin";

const adminQueryRoot = ["platform-admin"] as const;

export const adminQueryKeys = {
  all: adminQueryRoot,
  roles: () => [...adminQueryRoot, "roles"] as const,
  users: () => [...adminQueryRoot, "users"] as const,
  permissions: () => [...adminQueryRoot, "permissions"] as const,
  rolePermissions: (roleId: string) =>
    [...adminQueryRoot, "role-permissions", roleId] as const,
  userOverrides: (userId: string) =>
    [...adminQueryRoot, "user-overrides", userId] as const,
  titleRules: () => [...adminQueryRoot, "title-rules"] as const,
};

export function useAdminRoles() {
  return useQuery<AdminRolesResponse>({
    queryKey: adminQueryKeys.roles(),
    queryFn: async () => normalizeAdminRoles(await getAdminRoles()),
  });
}

export function useAdminUsers() {
  return useQuery<AdminUsersResponse>({
    queryKey: adminQueryKeys.users(),
    queryFn: async () => normalizeAdminUsers(await getAdminUsers()),
  });
}

export function useAdminPermissions() {
  return useQuery<AdminPermissionsResponse>({
    queryKey: adminQueryKeys.permissions(),
    queryFn: getAdminPermissions,
    staleTime: 60_000,
  });
}

export function useAdminRolePermissions(roleId?: string | null) {
  const normalizedRoleId = roleId?.trim() ?? "";

  return useQuery<AdminRolePermissionsResponse>({
    queryKey: adminQueryKeys.rolePermissions(normalizedRoleId),
    queryFn: () => getAdminRolePermissions(normalizedRoleId),
    enabled: normalizedRoleId.length > 0,
  });
}

export function useAdminUserOverrides(userId?: string | null) {
  const normalizedUserId = userId?.trim() ?? "";

  return useQuery<AdminUserOverridesResponse>({
    queryKey: adminQueryKeys.userOverrides(normalizedUserId),
    queryFn: () => getAdminUserOverrides(normalizedUserId),
    enabled: normalizedUserId.length > 0,
  });
}

export function useAdminTitleRules() {
  return useQuery<AdminTitleRulesResponse>({
    queryKey: adminQueryKeys.titleRules(),
    queryFn: async () => normalizeAdminTitleRules(await getAdminTitleRules()),
  });
}
