"use client";

import type { AdminRole } from "@/modules/platform-admin/types/admin";
import { AdminFieldHelp } from "@/modules/platform-admin/components/AdminFieldHelp";
import { formatAdminRoleName } from "@/modules/platform-admin/lib/adminRoles";
import {
  ADMIN_DISABLED_PERMISSION_COPY,
  ADMIN_PROTECTED_ROLE_COPY,
} from "@/modules/platform-admin/lib/adminCopy";
import { Badge } from "@/modules/shared/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";

import { isProtectedRole } from "@/modules/platform-admin/components/rolePermissionsUtils";

interface RolePermissionsSidebarProps {
  roles: AdminRole[];
  currentRoleId: string;
  selectedRole: AdminRole | null;
  canManagePermissions: boolean;
  onRoleChange: (roleId: string) => void;
}

export function RolePermissionsSidebar({
  roles,
  currentRoleId,
  selectedRole,
  canManagePermissions,
  onRoleChange,
}: RolePermissionsSidebarProps) {
  return (
    <div className="space-y-4 rounded-2xl border border-border/50 bg-background/70 p-4 shadow-sm shadow-primary/5">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Role</p>
          <AdminFieldHelp label="Permission role selector" description="Chooses which role baseline appears in the matrix for review and replacement saves." />
        </div>
        <Select value={currentRoleId} onValueChange={onRoleChange}>
          <SelectTrigger
            aria-label="Role selector"
            className="w-full bg-card/90"
            data-testid="role-permissions-role-selector"
          >
            <SelectValue placeholder="Select a role" />
          </SelectTrigger>
          <SelectContent>
            {roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {formatAdminRoleName(role.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedRole ? (
        <div className="rounded-xl border border-border/50 bg-card/90 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Selected role
          </p>
          <p data-testid="role-permissions-current-role" className="mt-2 text-sm font-semibold text-foreground">
            {formatAdminRoleName(selectedRole.name)}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {selectedRole.description ?? "No description provided for this role."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline" className="border-border/60 bg-background/80 text-foreground">
              {selectedRole.user_count} assigned users
            </Badge>
            {selectedRole.is_system ? (
              <Badge variant="outline" className="border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-100">
                System role
              </Badge>
            ) : null}
          </div>
        </div>
      ) : null}

      {!canManagePermissions ? (
        <div className="rounded-xl border border-border/60 bg-muted/45 px-4 py-3 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">{ADMIN_DISABLED_PERMISSION_COPY.title}</p>
          <p className="mt-1 leading-6">{ADMIN_DISABLED_PERMISSION_COPY.description}</p>
        </div>
      ) : null}

      {isProtectedRole(selectedRole) ? (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/8 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          <p className="font-semibold">Protected role</p>
          <p className="mt-1 leading-6">{ADMIN_PROTECTED_ROLE_COPY.description}</p>
        </div>
      ) : null}
    </div>
  );
}