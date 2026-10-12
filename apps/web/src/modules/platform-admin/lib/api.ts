import { api } from "@/modules/shared/lib/api";
import type {
  AdminPermissionsResponse,
  AdminRole,
  AdminRoleCreatePayload,
  AdminRolePermissionsReplacePayload,
  AdminRolePermissionsReplaceResponse,
  AdminRolePermissionsResponse,
  AdminRolesResponse,
  AdminTitleRulesResponse,
  AdminUser,
  AdminUserOverridesReplacePayload,
  AdminUserOverridesReplaceResponse,
  AdminUserOverridesResponse,
  AdminUsersResponse,
  AdminUserUpdatePayload,
  TitleRule,
  TitleRuleCreatePayload,
  TitleRulePreviewPayload,
  TitleRulePreviewResponse,
  TitleRuleUpdatePayload,
  AdminRoleUpdatePayload,
} from "@/modules/platform-admin/types/admin";

export function getAdminRoles(): Promise<AdminRolesResponse> {
  return api.get<AdminRolesResponse>("/api/roles");
}

export function createAdminRole(payload: AdminRoleCreatePayload): Promise<AdminRole> {
  return api.post<AdminRole>("/api/roles", payload);
}

export function updateAdminRole(
  roleId: string,
  payload: AdminRoleUpdatePayload,
): Promise<AdminRole> {
  return api.patch<AdminRole>(`/api/roles/${roleId}`, payload);
}

export function deleteAdminRole(roleId: string): Promise<void> {
  return api.del<void>(`/api/roles/${roleId}`);
}

export function getAdminUsers(): Promise<AdminUsersResponse> {
  return api.get<AdminUsersResponse>("/api/admin/users");
}

export function updateAdminUser(
  userId: string,
  payload: AdminUserUpdatePayload,
): Promise<AdminUser> {
  return api.patch<AdminUser>(`/api/admin/users/${userId}`, payload);
}

export function getAdminPermissions(): Promise<AdminPermissionsResponse> {
  return api.get<AdminPermissionsResponse>("/api/permissions");
}

export function getAdminRolePermissions(
  roleId: string,
): Promise<AdminRolePermissionsResponse> {
  return api.get<AdminRolePermissionsResponse>(`/api/roles/${roleId}/permissions`);
}

export function replaceAdminRolePermissions(
  roleId: string,
  payload: AdminRolePermissionsReplacePayload,
): Promise<AdminRolePermissionsReplaceResponse> {
  return api.put<AdminRolePermissionsReplaceResponse>(
    `/api/roles/${roleId}/permissions`,
    payload,
  );
}

export function getAdminUserOverrides(
  userId: string,
): Promise<AdminUserOverridesResponse> {
  return api.get<AdminUserOverridesResponse>(`/api/users/${userId}/overrides`);
}

export function replaceAdminUserOverrides(
  userId: string,
  payload: AdminUserOverridesReplacePayload,
): Promise<AdminUserOverridesReplaceResponse> {
  return api.put<AdminUserOverridesReplaceResponse>(`/api/users/${userId}/overrides`, payload);
}

export function getAdminTitleRules(): Promise<AdminTitleRulesResponse> {
  return api.get<AdminTitleRulesResponse>("/api/title-rules");
}

export function createAdminTitleRule(
  payload: TitleRuleCreatePayload,
): Promise<TitleRule> {
  return api.post<TitleRule>("/api/title-rules", payload);
}

export function updateAdminTitleRule(
  ruleId: string,
  payload: TitleRuleUpdatePayload,
): Promise<TitleRule> {
  return api.patch<TitleRule>(`/api/title-rules/${ruleId}`, payload);
}

export function deleteAdminTitleRule(ruleId: string): Promise<void> {
  return api.del<void>(`/api/title-rules/${ruleId}`);
}

export function previewTitleRule(
  payload: TitleRulePreviewPayload,
): Promise<TitleRulePreviewResponse> {
  return api.post<TitleRulePreviewResponse>("/api/title-rules/preview", payload);
}