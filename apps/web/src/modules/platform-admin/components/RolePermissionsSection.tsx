"use client";

import { useMemo, useState } from "react";
import { PermissionMatrix } from "@/modules/platform-admin/components/PermissionMatrix";
import { RolePermissionsMatrixSkeleton } from "@/modules/platform-admin/components/RolePermissionsMatrixSkeleton";
import { RolePermissionsSectionHeader } from "@/modules/platform-admin/components/RolePermissionsSectionHeader";
import { RolePermissionsSectionSkeleton } from "@/modules/platform-admin/components/RolePermissionsSectionSkeleton";
import { RolePermissionsSidebar } from "@/modules/platform-admin/components/RolePermissionsSidebar";
import { RolePermissionsStateCard } from "@/modules/platform-admin/components/RolePermissionsStateCard";
import type { RoleScopedFeedback, RoleScopedPermissions } from "@/modules/platform-admin/components/rolePermissionsState";
import { EMPTY_PERMISSIONS, EMPTY_ROLES, getReadOnlyMessage } from "@/modules/platform-admin/components/rolePermissionsUtils";
import { useReplaceAdminRolePermissions } from "@/modules/platform-admin/hooks/mutations";
import { useAdminPermissions, useAdminRolePermissions, useAdminRoles } from "@/modules/platform-admin/hooks/queries";
import { formatAdminRoleName } from "@/modules/platform-admin/lib/adminRoles";
import { usePermissions } from "@/modules/shared/hooks/usePermissions";
import { Card, CardContent } from "@/modules/shared/components/ui/card";

export function RolePermissionsSection() {
  const rolesQuery = useAdminRoles();
  const permissionsQuery = useAdminPermissions();
  const roleMutation = useReplaceAdminRolePermissions();
  const { hasPermission } = usePermissions();

  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [feedback, setFeedback] = useState<RoleScopedFeedback | null>(null);
  const [savedPermissions, setSavedPermissions] = useState<RoleScopedPermissions | null>(null);

  const roles = useMemo(() => rolesQuery.data ?? EMPTY_ROLES, [rolesQuery.data]);
  const groupedPermissions = permissionsQuery.data;

  const currentRoleId =
    roles.length === 0
      ? ""
      : roles.some((role) => role.id === selectedRoleId)
        ? selectedRoleId
        : roles[0].id;

  const selectedRole = useMemo(
    () => roles.find((role) => role.id === currentRoleId) ?? null,
    [roles, currentRoleId],
  );
  const rolePermissionsQuery = useAdminRolePermissions(currentRoleId);

  const moduleCount = groupedPermissions ? Object.keys(groupedPermissions).length : 0;
  const permissionCount = useMemo(
    () =>
      groupedPermissions
        ? Object.values(groupedPermissions).reduce(
            (total, permissions) => total + permissions.length,
            0,
          )
        : 0,
    [groupedPermissions],
  );
  const canManagePermissions = hasPermission("platform.manage_permissions");
  const loadedPermissions =
    savedPermissions?.roleId === currentRoleId
      ? savedPermissions.permissions
      : rolePermissionsQuery.data ?? EMPTY_PERMISSIONS;
  const readOnlyMessage = getReadOnlyMessage(selectedRole);
  const scopedFeedback = feedback?.roleId === currentRoleId ? feedback : null;

  function handleRoleChange(nextRoleId: string) {
    setSelectedRoleId(nextRoleId);
    setFeedback(null);
  }

  async function handleSave(permissions: string[]) {
    if (!currentRoleId || !selectedRole) {
      return;
    }

    setFeedback(null);

    try {
      const response = await roleMutation.mutateAsync({
        roleId: currentRoleId,
        payload: { permissions },
      });
      setSavedPermissions({ roleId: currentRoleId, permissions: response.permissions });
      setFeedback({
        roleId: currentRoleId,
        tone: "success",
        message: `Saved ${response.permissions.length} permissions for ${formatAdminRoleName(selectedRole.name)}.`,
      });
    } catch (error) {
      setFeedback({
        roleId: currentRoleId,
        tone: "error",
        message: error instanceof Error ? error.message : "Unable to save role permissions right now.",
      });
    }
  }

  if (rolesQuery.isPending || permissionsQuery.isPending || (roles.length > 0 && !currentRoleId)) {
    return <RolePermissionsSectionSkeleton />;
  }

  if (rolesQuery.isError) {
    return (
      <RolePermissionsStateCard
        title="Unable to load roles"
        description={rolesQuery.error?.message ?? "The role list could not be loaded."}
        actionLabel="Retry roles"
        onAction={() => {
          void rolesQuery.refetch();
        }}
      />
    );
  }

  if (permissionsQuery.isError) {
    return (
      <RolePermissionsStateCard
        title="Unable to load permissions"
        description={permissionsQuery.error?.message ?? "The permission registry could not be loaded."}
        actionLabel="Retry permissions"
        onAction={() => {
          void permissionsQuery.refetch();
        }}
      />
    );
  }

  if (roles.length === 0) {
    return (
      <RolePermissionsStateCard
        title="No roles available"
        description="Create or sync roles before editing grouped permission baselines."
      />
    );
  }

  if (!groupedPermissions || Object.keys(groupedPermissions).length === 0) {
    return (
      <RolePermissionsStateCard
        title="No permission registry available"
        description="The grouped permission registry is empty, so there is nothing to assign yet."
      />
    );
  }

  return (
    <section data-testid="admin-section-role-perms" className="space-y-4">
      <Card className="border-border/60 bg-card/95 py-0 shadow-sm shadow-primary/5 backdrop-blur-sm">
        <RolePermissionsSectionHeader
          roleCount={roles.length}
          moduleCount={moduleCount}
          permissionCount={permissionCount}
        />

        <CardContent className="grid gap-4 py-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <RolePermissionsSidebar
            roles={roles}
            currentRoleId={currentRoleId}
            selectedRole={selectedRole}
            canManagePermissions={canManagePermissions}
            onRoleChange={handleRoleChange}
          />

          <div className="min-w-0">
            {rolePermissionsQuery.isError ? (
              <RolePermissionsStateCard
                title="Unable to load role permissions"
                description={
                  rolePermissionsQuery.error?.message ??
                  "The selected role baseline could not be loaded."
                }
                actionLabel="Retry role permissions"
                onAction={() => {
                  void rolePermissionsQuery.refetch();
                }}
              />
            ) : rolePermissionsQuery.isPending && savedPermissions?.roleId !== currentRoleId ? (
              <RolePermissionsMatrixSkeleton />
            ) : (
              <PermissionMatrix
                permissionGroups={groupedPermissions}
                loadedPermissions={loadedPermissions}
                canManagePermissions={canManagePermissions}
                disabledPermissionMessage="Requires platform.manage_permissions"
                readOnlyMessage={readOnlyMessage}
                isSaving={roleMutation.isPending}
                feedback={scopedFeedback}
                onSave={handleSave}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}