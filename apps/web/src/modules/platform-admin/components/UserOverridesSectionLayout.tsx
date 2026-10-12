"use client";

import { UserOverridesPanel } from "@/modules/platform-admin/components/UserOverridesPanel";
import { UserOverridesSidebar } from "@/modules/platform-admin/components/UserOverridesSidebar";
import type { UserOverrideMode, UserOverrideModeMap, UserOverrideSummaryCounts } from "@/modules/platform-admin/components/userOverridesUtils";
import type { AdminPermission, AdminUser } from "@/modules/platform-admin/types/admin";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/modules/shared/components/ui/card";

interface UserOverridesSectionLayoutProps {
  users: AdminUser[];
  selectedUser: AdminUser | null;
  missingRequestedUserId?: string | null;
  search: string;
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
  onSearchChange: (value: string) => void;
  onSelectUser: (userId: string) => void;
  onRetryData: () => void;
  onModeChange: (permissionKey: string, mode: UserOverrideMode) => void;
  onReset: () => void;
  onSave: () => void;
}

export function UserOverridesSectionLayout({
  users,
  selectedUser,
  missingRequestedUserId,
  search,
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
  onSearchChange,
  onSelectUser,
  onRetryData,
  onModeChange,
  onReset,
  onSave,
}: UserOverridesSectionLayoutProps) {
  return (
    <section data-testid="admin-section-overrides" className="space-y-4">
      <Card className="border-border/60 bg-card/95 py-0 shadow-sm shadow-primary/5 backdrop-blur-sm">
        <CardHeader className="gap-3 border-b border-border/50 px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <CardTitle className="text-xl font-bold text-foreground">Explicit user permission overrides</CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">Overrides stay durable on the single admin route and should remain rarer than role-level permission changes.</CardDescription>
            </div>
            <Badge variant="outline" className="border-border/60 bg-background/70 text-foreground">{users.length} users</Badge>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4 py-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <UserOverridesSidebar
            users={users}
            selectedUserId={selectedUser?.id ?? null}
            search={search}
            missingRequestedUserId={missingRequestedUserId}
            onSearchChange={onSearchChange}
            onSelectUser={onSelectUser}
          />
          <UserOverridesPanel
            selectedUser={selectedUser}
            missingRequestedUserId={missingRequestedUserId}
            showDataError={showDataError}
            errorDescription={errorDescription}
            showDataLoading={showDataLoading}
            moduleEntries={moduleEntries}
            inheritedPermissions={inheritedPermissions}
            overrideModeMap={overrideModeMap}
            summaryCounts={summaryCounts}
            canManagePermissions={canManagePermissions}
            isSaving={isSaving}
            isDirty={isDirty}
            feedback={feedback}
            onRetryData={onRetryData}
            onModeChange={onModeChange}
            onReset={onReset}
            onSave={onSave}
          />
        </CardContent>
      </Card>
    </section>
  );
}