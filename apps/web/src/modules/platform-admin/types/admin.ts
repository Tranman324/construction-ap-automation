export interface AdminRole {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  user_count: number;
}

export interface AdminUserRole {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
}

export interface AdminUser {
  id: string;
  azure_id: string | null;
  email: string;
  name: string;
  role_id: string;
  is_active: boolean;
  job_title: string | null;
  phone: string | null;
  avatar_url: string | null;
  role_version: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string | null;
  role: AdminUserRole | null;
}

export interface AdminPermission {
  key: string;
  description: string | null;
}

export interface UserPermissionOverride {
  key: string;
  granted: boolean;
}

export type TitleRuleMatchType = "equals" | "contains" | "starts_with";

export interface TitleRule {
  id: string;
  pattern: string;
  match_type: TitleRuleMatchType;
  role_id: string;
  priority: number;
  is_active: boolean;
  created_at: string;
  role_name: string | null;
}

export interface AdminPermissionGroups {
  [moduleId: string]: AdminPermission[];
}

export type AdminRolesResponse = AdminRole[];

export type AdminUsersResponse = AdminUser[];

export type AdminPermissionsResponse = AdminPermissionGroups;

export type AdminRolePermissionsResponse = string[];

export type AdminUserOverridesResponse = UserPermissionOverride[];

export type AdminTitleRulesResponse = TitleRule[];

export interface AdminRoleCreatePayload {
  name: string;
  description?: string | null;
}

export interface AdminRoleUpdatePayload {
  name?: string;
  description?: string | null;
}

export interface AdminUserUpdatePayload {
  role_id?: string;
  is_active?: boolean;
}

export interface AdminRolePermissionsReplacePayload {
  permissions: string[];
}

export interface AdminRolePermissionsReplaceResponse {
  ok: true;
  permissions: string[];
}

export interface AdminUserOverridesReplacePayload {
  overrides: UserPermissionOverride[];
}

export interface AdminUserOverridesReplaceResponse {
  ok: true;
  overrides: UserPermissionOverride[];
}

export interface TitleRuleCreatePayload {
  pattern: string;
  match_type: TitleRuleMatchType;
  role_id: string;
  priority: number;
  is_active?: boolean;
}

export interface TitleRuleUpdatePayload {
  pattern?: string;
  match_type?: TitleRuleMatchType;
  role_id?: string;
  priority?: number;
  is_active?: boolean;
}

export interface TitleRulePreviewPayload {
  jobTitle: string;
}

export interface TitleRulePreviewResponse {
  matched: TitleRule | null;
}