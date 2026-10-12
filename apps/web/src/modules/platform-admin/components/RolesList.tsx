"use client";

import { Lock, Trash2 } from "lucide-react";

import { formatAdminRoleName } from "@/modules/platform-admin/lib/adminRoles";
import type { AdminRole } from "@/modules/platform-admin/types/admin";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Button } from "@/modules/shared/components/ui/button";

interface RolesListProps {
  roles: AdminRole[];
  canManageRoles: boolean;
  isMutating: boolean;
  onEdit: (role: AdminRole) => void;
  onDelete: (role: AdminRole) => void;
}

export function RolesList({
  roles,
  canManageRoles,
  isMutating,
  onEdit,
  onDelete,
}: RolesListProps) {
  if (roles.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-border/50 bg-background/70 px-4 py-8 text-sm text-muted-foreground">
        No roles are available yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-background/70">
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(8rem,0.5fr)_minmax(11rem,0.7fr)_auto] gap-3 border-b border-border/50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <span>Role</span>
        <span>Users</span>
        <span>Status</span>
        <span className="text-right">Actions</span>
      </div>

      {roles.map((role) => {
        const isLocked = role.is_system;
        const roleName = formatAdminRoleName(role.name);

        return (
          <div
            key={role.id}
            className="grid grid-cols-[minmax(0,1.6fr)_minmax(8rem,0.5fr)_minmax(11rem,0.7fr)_auto] gap-3 border-b border-border/40 px-4 py-4 last:border-b-0"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-foreground">{roleName}</p>
                {isLocked ? (
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  >
                    <Lock className="h-3 w-3" />
                    System role
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                {role.description ?? "No description added yet."}
              </p>
            </div>

            <div className="font-mono text-sm text-foreground">{role.user_count}</div>

            <div className="space-y-1 text-sm text-muted-foreground">
              <p>{isLocked ? "System role is locked." : "Custom role"}</p>
              {isLocked ? (
                <p className="text-xs">Edit and delete stay disabled for system roles.</p>
              ) : null}
            </div>

            <div className="space-y-2 justify-self-end text-right">
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`edit-role-${role.id}`}
                  onClick={() => onEdit(role)}
                  disabled={!canManageRoles || isLocked || isMutating}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`delete-role-${role.id}`}
                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onDelete(role)}
                  disabled={!canManageRoles || isLocked || isMutating}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
              {!canManageRoles ? (
                <p className="text-xs text-muted-foreground">Requires platform.manage_roles</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}