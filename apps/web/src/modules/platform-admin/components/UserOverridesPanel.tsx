"use client";

import { RolePermissionsMatrixSkeleton } from "@/modules/platform-admin/components/RolePermissionsMatrixSkeleton";
import { RolePermissionsStateCard } from "@/modules/platform-admin/components/RolePermissionsStateCard";
import { UserOverrideModuleCard } from "@/modules/platform-admin/components/UserOverrideModuleCard";
import {
  ADMIN_DISABLED_PERMISSION_COPY,
  ADMIN_OVERRIDE_COPY,
  getOverrideSummary,
} from "@/modules/platform-admin/lib/adminCopy";
import type { AdminPermission, AdminUser } from "@/modules/platform-admin/types/admin";
import { Button } from "@/modules/shared/components/ui/button";

import type {
  UserOverrideMode,
  UserOverrideModeMap,
  UserOverrideSummaryCounts,
} from "@/modules/platform-admin/components/userOverridesUtils";

interface UserOverridesPanelProps {
  selectedUser: AdminUser | null;
  missingRequestedUserId?: string | null;
  showDataError: boolean;
  errorDescription: string;
  showDataLoading: boolean;
  moduleEntries: Array<[string, AdminPermission[]]>;
  inheritedPermissions: ReadonlySet<string>;
  overrideModeMap: UserOverrideModeMap;
  summaryCounts: UserOverrideSummaryCounts;
  canManagePermissions: boolean;
  isSaving: boolean;
  isDirty: boolean;
  feedback?: { tone: "success" | "error"; message: string } | null;
  onRetryData: () => void;
  onModeChange: (permissionKey: string, mode: UserOverrideMode) => void;
  onReset: () => void;
  onSave: () => void;
}

export function UserOverridesPanel({
  selectedUser,
  missingRequestedUserId,
  showDataError,
  errorDescription,
  showDataLoading,
  moduleEntries,
  inheritedPermissions,
  overrideModeMap,
  summaryCounts,
  canManagePermissions,
  isSaving,
  isDirty,
  feedback,
  onRetryData,
  onModeChange,
  onReset,
  onSave,
}: UserOverridesPanelProps) {
  const permissionDisabledReason = canManagePermissions ? undefined : "Requires platform.manage_permissions";

  if (!selectedUser) {
    return (
      <RolePermissionsStateCard
        title={missingRequestedUserId ? "Requested user not found" : "Choose a user"}
        description={
          missingRequestedUserId
            ? `User ${missingRequestedUserId} is no longer available. Select another user to review overrides.`
            : ADMIN_OVERRIDE_COPY.emptyState
        }
      />
    );
  }

  if (showDataError) {
    return (
      <RolePermissionsStateCard
        title="Unable to load override data"
        description={errorDescription}
        actionLabel="Retry override data"
        onAction={onRetryData}
      />
    );
  }

  if (showDataLoading) {
    return <RolePermissionsMatrixSkeleton />;
  }

  if (moduleEntries.length === 0) {
    return (
      <RolePermissionsStateCard
        title="No permission registry available"
        description="The grouped permission registry is empty, so there is nothing to override yet."
      />
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="rounded-2xl border border-border/60 bg-background/75 px-4 py-4 shadow-sm shadow-primary/5">
        <p className="text-sm font-semibold text-foreground">{getOverrideSummary(selectedUser.name)}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{ADMIN_OVERRIDE_COPY.description}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div data-testid="summary-inherited" className="rounded-xl border border-border/50 bg-card/90 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Inherited</p><p className="mt-2 text-2xl font-semibold text-foreground">{summaryCounts.inheritedCount}</p></div>
          <div data-testid="summary-grant" className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">Extra grants</p><p className="mt-2 text-2xl font-semibold text-foreground">{summaryCounts.grantCount}</p></div>
          <div data-testid="summary-revoke" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-900 dark:text-amber-100">Revokes</p><p className="mt-2 text-2xl font-semibold text-foreground">{summaryCounts.revokeCount}</p></div>
        </div>
      </div>

      {!canManagePermissions ? (
        <div data-testid="user-overrides-disabled" className="rounded-xl border border-border/60 bg-muted/45 px-4 py-3 text-sm text-muted-foreground"><p className="font-semibold text-foreground">{ADMIN_DISABLED_PERMISSION_COPY.title}</p><p className="mt-1 leading-6">Requires platform.manage_permissions. {ADMIN_DISABLED_PERMISSION_COPY.description}</p></div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {moduleEntries.map(([moduleId, permissions]) => (
          <UserOverrideModuleCard
            key={moduleId}
            moduleId={moduleId}
            permissions={permissions}
            inheritedPermissions={inheritedPermissions}
            overrideModeMap={overrideModeMap}
            controlsDisabled={isSaving || !canManagePermissions}
            disabledReason={permissionDisabledReason}
            onModeChange={onModeChange}
          />
        ))}
      </div>

      <div data-testid="user-overrides-save-bar" className="sticky bottom-3 z-10 rounded-2xl border border-primary/20 bg-primary/[0.05] px-4 py-4 shadow-sm shadow-primary/5 supports-[backdrop-filter]:backdrop-blur-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{isDirty ? "Unsaved override changes" : "Override baseline is current"}</p>
            <p className="text-sm text-muted-foreground">{isDirty ? "Save replaces the full explicit override list for this user." : "Keep explicit grants and revokes limited; prefer adjusting the underlying role when possible."}</p>
            {feedback ? <p role={feedback.tone === "error" ? "alert" : "status"} className="text-sm text-foreground">{feedback.message}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onReset} disabled={!isDirty || isSaving}>Reset all</Button>
            <Button onClick={onSave} disabled={!isDirty || isSaving || !canManagePermissions} title={!canManagePermissions ? permissionDisabledReason : undefined}>Save overrides</Button>
          </div>
        </div>
      </div>
    </div>
  );
}