import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  createAdminRole,
  createAdminTitleRule,
  deleteAdminRole,
  deleteAdminTitleRule,
  previewTitleRule,
  replaceAdminRolePermissions,
  replaceAdminUserOverrides,
  updateAdminRole,
  updateAdminTitleRule,
  updateAdminUser,
} from "@/modules/platform-admin/lib/api";
import { adminQueryKeys } from "@/modules/platform-admin/hooks/queries";
import { emitPlatformAdminAuditEvent } from "@/modules/platform-admin/lib/auditEvents";
import { useAuth } from "@/modules/shared/lib/auth";
import type {
  AdminRole,
  AdminRoleCreatePayload,
  AdminRolePermissionsReplacePayload,
  AdminRolePermissionsReplaceResponse,
  AdminRoleUpdatePayload,
  AdminUser,
  AdminUserOverridesReplacePayload,
  AdminUserOverridesReplaceResponse,
  AdminUserUpdatePayload,
  TitleRule,
  TitleRuleCreatePayload,
  TitleRulePreviewPayload,
  TitleRulePreviewResponse,
  TitleRuleUpdatePayload,
} from "@/modules/platform-admin/types/admin";

interface UpdateAdminRoleInput { roleId: string; payload: AdminRoleUpdatePayload; }
interface DeleteAdminRoleInput { roleId: string; }
interface UpdateAdminUserInput { userId: string; payload: AdminUserUpdatePayload; }
interface ReplaceAdminRolePermissionsInput { roleId: string; payload: AdminRolePermissionsReplacePayload; }
interface ReplaceAdminUserOverridesInput { userId: string; payload: AdminUserOverridesReplacePayload; }
interface UpdateAdminTitleRuleInput { ruleId: string; payload: TitleRuleUpdatePayload; }
interface DeleteAdminTitleRuleInput { ruleId: string; }

export function useCreateAdminRole() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation<AdminRole, Error, AdminRoleCreatePayload>({
    mutationFn: (payload) => createAdminRole(payload),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.roles() });
      emitPlatformAdminAuditEvent(user, "admin.role.created", {
        targetId: data.id,
        label: data.name,
        summary: `Created role ${data.name}`,
      });
    },
  });
}

export function useUpdateAdminRole() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation<AdminRole, Error, UpdateAdminRoleInput>({
    mutationFn: ({ roleId, payload }) => updateAdminRole(roleId, payload),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.roles() });
      emitPlatformAdminAuditEvent(user, "admin.role.updated", {
        targetId: data.id,
        label: data.name,
        summary: `Updated role ${data.name}`,
      });
    },
  });
}

export function useDeleteAdminRole() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation<void, Error, DeleteAdminRoleInput>({
    mutationFn: ({ roleId }) => deleteAdminRole(roleId),
    onSuccess: (_data, { roleId }) => {
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.roles() });
      emitPlatformAdminAuditEvent(user, "admin.role.deleted", {
        targetId: roleId,
        summary: `Deleted role ${roleId}`,
      });
    },
  });
}

export function useUpdateAdminUser() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation<AdminUser, Error, UpdateAdminUserInput>({
    mutationFn: ({ userId, payload }) => updateAdminUser(userId, payload),
    onSuccess: (data, { payload }) => {
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.users() });
      if (payload.role_id) {
        const roleLabel = data.role?.name ?? data.role_id;
        emitPlatformAdminAuditEvent(user, "admin.user.role_changed", {
          targetId: data.id,
          label: data.name,
          summary: `Changed ${data.name}'s role to ${roleLabel}`,
        });
      }
    },
  });
}

export function useReplaceAdminRolePermissions() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation<AdminRolePermissionsReplaceResponse, Error, ReplaceAdminRolePermissionsInput>({
    mutationFn: ({ roleId, payload }) => replaceAdminRolePermissions(roleId, payload),
    onSuccess: (data, variables) => {
      const previousPermissions = queryClient.getQueryData<string[]>(adminQueryKeys.rolePermissions(variables.roleId));
      void queryClient.invalidateQueries({
        queryKey: adminQueryKeys.rolePermissions(variables.roleId),
      });
      emitPlatformAdminAuditEvent(user, "admin.role.updated", {
        targetId: variables.roleId,
        summary: `Updated permissions for role ${variables.roleId}`,
        ...(previousPermissions ? { changes: { permissions: { from: previousPermissions, to: data.permissions } } } : {}),
      });
    },
  });
}

export function useReplaceAdminUserOverrides() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation<AdminUserOverridesReplaceResponse, Error, ReplaceAdminUserOverridesInput>({
    mutationFn: ({ userId, payload }) => replaceAdminUserOverrides(userId, payload),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: adminQueryKeys.userOverrides(variables.userId),
      });
      emitPlatformAdminAuditEvent(user, "admin.user.permissions_overridden", {
        targetId: variables.userId,
        summary: `Updated permission overrides for user ${variables.userId}`,
      });
    },
  });
}

export function useCreateAdminTitleRule() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation<TitleRule, Error, TitleRuleCreatePayload>({
    mutationFn: (payload) => createAdminTitleRule(payload),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.titleRules() });
      emitPlatformAdminAuditEvent(user, "admin.title_rule.created", {
        targetId: data.id,
        label: data.pattern,
        summary: `Created title rule ${data.pattern}`,
      });
    },
  });
}

export function useUpdateAdminTitleRule() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation<TitleRule, Error, UpdateAdminTitleRuleInput>({
    mutationFn: ({ ruleId, payload }) => updateAdminTitleRule(ruleId, payload),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.titleRules() });
      emitPlatformAdminAuditEvent(user, "admin.title_rule.updated", {
        targetId: data.id,
        label: data.pattern,
        summary: `Updated title rule ${data.pattern}`,
      });
    },
  });
}

export function useDeleteAdminTitleRule() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation<void, Error, DeleteAdminTitleRuleInput>({
    mutationFn: ({ ruleId }) => deleteAdminTitleRule(ruleId),
    onSuccess: (_data, { ruleId }) => {
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.titleRules() });
      emitPlatformAdminAuditEvent(user, "admin.title_rule.deleted", {
        targetId: ruleId,
        summary: `Deleted title rule ${ruleId}`,
      });
    },
  });
}

export function usePreviewTitleRule() {
  return useMutation<TitleRulePreviewResponse, Error, TitleRulePreviewPayload>({
    mutationFn: (payload) => previewTitleRule(payload),
  });
}
