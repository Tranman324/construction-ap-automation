"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { AdminInlineNotice } from "@/modules/platform-admin/components/AdminInlineNotice";
import { RoleDeleteDialog } from "@/modules/platform-admin/components/RoleDeleteDialog";
import {
  useCreateAdminRole,
  useDeleteAdminRole,
  useUpdateAdminRole,
} from "@/modules/platform-admin/hooks/mutations";
import { useAdminRoles } from "@/modules/platform-admin/hooks/queries";
import { RoleEditor } from "@/modules/platform-admin/components/RoleEditor";
import { RolesList } from "@/modules/platform-admin/components/RolesList";
import { formatAdminRoleName } from "@/modules/platform-admin/lib/adminRoles";
import type { AdminRole, AdminRoleCreatePayload } from "@/modules/platform-admin/types/admin";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/modules/shared/components/ui/card";
import { isApiError } from "@/modules/shared/lib/api";
import { usePermissions } from "@/modules/shared/hooks/usePermissions";

interface RolesNotice {
  tone: "error" | "success";
  message: string;
}

function getRoleMutationMessage(error: Error, intent: "create" | "update" | "delete") {
  if (isApiError(error) && error.status === 409) {
    if (intent === "delete") {
      return "This role is still assigned to one or more users and cannot be deleted.";
    }

    return "A role with this name already exists.";
  }

  if (error.message.trim().length > 0) {
    return error.message;
  }

  return intent === "delete" ? "Failed to delete role." : "Failed to save role.";
}

export function RolesSection() {
  const rolesQuery = useAdminRoles();
  const createRole = useCreateAdminRole();
  const updateRole = useUpdateAdminRole();
  const deleteRole = useDeleteAdminRole();
  const { hasPermission } = usePermissions();
  const canManageRoles = hasPermission("platform.manage_roles");

  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [selectedRole, setSelectedRole] = useState<AdminRole | null>(null);
  const [rolePendingDelete, setRolePendingDelete] = useState<AdminRole | null>(null);
  const [notice, setNotice] = useState<RolesNotice | null>(null);

  const roles = rolesQuery.data ?? [];
  const isMutating = createRole.isPending || updateRole.isPending || deleteRole.isPending;
  const createRoleDisabledReason = !canManageRoles ? "Requires platform.manage_roles" : "";

  function openCreateEditor() {
    setSelectedRole(null);
    setEditorMode("create");
    setNotice(null);
  }

  function openEditEditor(role: AdminRole) {
    setSelectedRole(role);
    setEditorMode("edit");
    setNotice(null);
  }

  function closeEditor(open: boolean) {
    if (!open) {
      setEditorMode(null);
      setSelectedRole(null);
    }
  }

  function handleEditorSubmit(payload: AdminRoleCreatePayload) {
    if (editorMode === "edit" && selectedRole) {
      updateRole.mutate(
        { roleId: selectedRole.id, payload },
        {
          onSuccess: () => {
            setNotice({ tone: "success", message: `Updated ${payload.name}.` });
            setEditorMode(null);
            setSelectedRole(null);
          },
          onError: (error) => {
            setNotice({ tone: "error", message: getRoleMutationMessage(error, "update") });
          },
        },
      );
      return;
    }

    createRole.mutate(payload, {
      onSuccess: () => {
        setNotice({ tone: "success", message: `Created ${payload.name}.` });
        setEditorMode(null);
      },
      onError: (error) => {
        setNotice({ tone: "error", message: getRoleMutationMessage(error, "create") });
      },
    });
  }

  function handleDeleteConfirm() {
    if (!rolePendingDelete) {
      return;
    }

    deleteRole.mutate(
      { roleId: rolePendingDelete.id },
      {
        onSuccess: () => {
          setNotice({ tone: "success", message: `Deleted ${formatAdminRoleName(rolePendingDelete.name)}.` });
          setRolePendingDelete(null);
        },
        onError: (error) => {
          setNotice({ tone: "error", message: getRoleMutationMessage(error, "delete") });
          setRolePendingDelete(null);
        },
      },
    );
  }

  return (
    <section data-testid="admin-section-roles" className="space-y-4">
      <Card className="border-border/60 bg-card/90 shadow-sm shadow-primary/5 backdrop-blur-sm">
        <CardHeader className="gap-3 border-b border-border/50 px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <CardTitle className="text-xl font-bold text-foreground">Role inventory</CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                System roles stay protected while custom roles remain editable for operational access changes.
              </CardDescription>
            </div>
            <div className="space-y-2 text-right">
              <Button onClick={openCreateEditor} disabled={!canManageRoles || isMutating} title={createRoleDisabledReason || undefined}>
                <Plus className="h-4 w-4" />
                Create role
              </Button>
              {createRoleDisabledReason ? (
                <p className="text-xs text-muted-foreground">{createRoleDisabledReason}</p>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 py-6">
          {notice ? <AdminInlineNotice tone={notice.tone} message={notice.message} /> : null}

          {rolesQuery.isLoading ? (
            <div className="rounded-xl border border-border/50 bg-background/70 px-4 py-8 text-sm text-muted-foreground">
              Loading role inventory...
            </div>
          ) : null}

          {rolesQuery.error ? (
            <AdminInlineNotice tone="error" message={rolesQuery.error.message || "Unable to load roles."} />
          ) : null}

          {!rolesQuery.isLoading && !rolesQuery.error ? (
            <RolesList
              roles={roles}
              canManageRoles={canManageRoles}
              isMutating={isMutating}
              onEdit={openEditEditor}
              onDelete={setRolePendingDelete}
            />
          ) : null}
        </CardContent>
      </Card>

      <RoleEditor
        mode={editorMode ?? "create"}
        open={editorMode !== null}
        role={selectedRole}
        isPending={createRole.isPending || updateRole.isPending}
        onOpenChange={closeEditor}
        onSubmit={handleEditorSubmit}
      />

      <RoleDeleteDialog
        open={rolePendingDelete !== null}
        role={rolePendingDelete}
        isPending={deleteRole.isPending}
        onConfirm={handleDeleteConfirm}
        onOpenChange={(open) => !open && setRolePendingDelete(null)}
      />
    </section>
  );
}