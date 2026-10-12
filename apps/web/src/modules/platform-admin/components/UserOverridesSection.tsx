"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { RolePermissionsSectionSkeleton } from "@/modules/platform-admin/components/RolePermissionsSectionSkeleton";
import { RolePermissionsStateCard } from "@/modules/platform-admin/components/RolePermissionsStateCard";
import { UserOverridesSectionLayout } from "@/modules/platform-admin/components/UserOverridesSectionLayout";
import { formatModuleLabel } from "@/modules/platform-admin/components/permissionMatrixUtils";
import {
  buildUserOverridesPayload,
  countUserOverrideModes,
  createUserOverrideModeMap,
  normalizeUserOverrides,
  type UserOverrideMode,
  type UserOverrideModeMap,
} from "@/modules/platform-admin/components/userOverridesUtils";
import { buildAdminOverridesHref } from "@/modules/platform-admin/lib/adminUsers";
import { useReplaceAdminUserOverrides } from "@/modules/platform-admin/hooks/mutations";
import { useAdminPermissions, useAdminRolePermissions, useAdminUserOverrides, useAdminUsers } from "@/modules/platform-admin/hooks/queries";
import type { AdminPermission, AdminUser, UserPermissionOverride } from "@/modules/platform-admin/types/admin";
import { usePermissions } from "@/modules/shared/hooks/usePermissions";

const EMPTY_USERS: AdminUser[] = [];
const EMPTY_OVERRIDE_MODE_MAP: UserOverrideModeMap = {};

interface UserScopedOverrides {
  userId: string;
  overrides: UserPermissionOverride[];
}

interface UserScopedDraft {
  userId: string;
  modes: UserOverrideModeMap;
}

interface UserScopedFeedback {
  userId: string;
  tone: "success" | "error";
  message: string;
}

export function UserOverridesSection({ userId }: { userId?: string | null }) {
  const router = useRouter();
  const usersQuery = useAdminUsers();
  const permissionsQuery = useAdminPermissions();
  const overridesMutation = useReplaceAdminUserOverrides();
  const { hasPermission } = usePermissions();
  const [search, setSearch] = useState("");
  const [localSelectedUserId, setLocalSelectedUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserScopedDraft | null>(null);
  const [savedOverrides, setSavedOverrides] = useState<UserScopedOverrides | null>(null);
  const [feedback, setFeedback] = useState<UserScopedFeedback | null>(null);

  const users = usersQuery.data ?? EMPTY_USERS;
  const incomingUserId = userId?.trim() ?? "";
  const requestedUser = users.find((user) => user.id === incomingUserId) ?? null;
  const locallySelectedUser = localSelectedUserId
    ? users.find((user) => user.id === localSelectedUserId) ?? null
    : null;
  const selectedUser = requestedUser ?? locallySelectedUser;
  const missingRequestedUserId = incomingUserId && !requestedUser && !locallySelectedUser ? incomingUserId : null;
  const rolePermissionsQuery = useAdminRolePermissions(selectedUser?.role_id);
  const userOverridesQuery = useAdminUserOverrides(selectedUser?.id);
  const canManagePermissions = hasPermission("platform.manage_permissions");

  const inheritedPermissions = useMemo(() => new Set(rolePermissionsQuery.data ?? []), [rolePermissionsQuery.data]);
  const loadedOverrides = useMemo(() => normalizeUserOverrides(savedOverrides && savedOverrides.userId === selectedUser?.id ? savedOverrides.overrides : userOverridesQuery.data ?? []), [savedOverrides, selectedUser?.id, userOverridesQuery.data]);
  const loadedModeMap = useMemo(() => createUserOverrideModeMap(loadedOverrides), [loadedOverrides]);
  const draftModeMap = draft && draft.userId === selectedUser?.id ? draft.modes : EMPTY_OVERRIDE_MODE_MAP;
  const overrideModeMap = useMemo(() => ({ ...loadedModeMap, ...draftModeMap }), [loadedModeMap, draftModeMap]);
  const moduleEntries = useMemo<Array<[string, AdminPermission[]]>>(() => Object.entries(permissionsQuery.data ?? {}).sort(([left], [right]) => formatModuleLabel(left).localeCompare(formatModuleLabel(right))), [permissionsQuery.data]);
  const permissionKeys = useMemo(() => moduleEntries.flatMap(([, permissions]) => permissions.map((permission) => permission.key)), [moduleEntries]);
  const summaryCounts = useMemo(() => countUserOverrideModes(permissionKeys, overrideModeMap), [permissionKeys, overrideModeMap]);
  const isDirty = Object.keys(draftModeMap).length > 0;
  const scopedFeedback = feedback?.userId === selectedUser?.id ? feedback : null;

  function handleSelectUser(nextUserId: string) {
    setLocalSelectedUserId(nextUserId);
    setFeedback(null);
    router.replace(buildAdminOverridesHref(nextUserId));
  }

  function handleModeChange(permissionKey: string, nextMode: UserOverrideMode) {
    if (!selectedUser) {
      return;
    }

    const loadedMode = loadedModeMap[permissionKey] ?? "inherited";
    const nextModes = { ...draftModeMap };

    if (nextMode === loadedMode) {
      delete nextModes[permissionKey];
    } else {
      nextModes[permissionKey] = nextMode;
    }

    setDraft({ userId: selectedUser.id, modes: nextModes });
  }

  async function handleSave() {
    if (!selectedUser) {
      return;
    }

    setFeedback(null);

    try {
      const response = await overridesMutation.mutateAsync({
        userId: selectedUser.id,
        payload: { overrides: buildUserOverridesPayload(overrideModeMap) },
      });
      setSavedOverrides({ userId: selectedUser.id, overrides: response.overrides });
      setDraft({ userId: selectedUser.id, modes: {} });
      setFeedback({
        userId: selectedUser.id,
        tone: "success",
        message: `Saved ${response.overrides.length} explicit overrides for ${selectedUser.name}.`,
      });
    } catch (error) {
      setFeedback({
        userId: selectedUser.id,
        tone: "error",
        message: error instanceof Error ? error.message : "Unable to save user overrides right now.",
      });
    }
  }

  if (usersQuery.isPending && !usersQuery.data) {
    return <RolePermissionsSectionSkeleton />;
  }

  if (usersQuery.isError) {
    return (
      <RolePermissionsStateCard
        title="Unable to load users"
        description={usersQuery.error?.message ?? "The user directory could not be loaded."}
        actionLabel="Retry users"
        onAction={() => {
          void usersQuery.refetch();
        }}
      />
    );
  }

  if (users.length === 0) {
    return <RolePermissionsStateCard title="No users available" description="Admin users will appear here once the backend returns a directory inventory." />;
  }

  const showDataError = permissionsQuery.isError || rolePermissionsQuery.isError || userOverridesQuery.isError;
  const showDataLoading = Boolean(selectedUser && (permissionsQuery.isPending || rolePermissionsQuery.isPending || userOverridesQuery.isPending));
  const errorDescription = permissionsQuery.error?.message ?? rolePermissionsQuery.error?.message ?? userOverridesQuery.error?.message ?? "The selected user's override data could not be loaded.";

  return (
    <UserOverridesSectionLayout
      users={users}
      selectedUser={selectedUser}
      missingRequestedUserId={missingRequestedUserId}
      search={search}
      showDataError={showDataError}
      errorDescription={errorDescription}
      showDataLoading={showDataLoading}
      moduleEntries={moduleEntries}
      inheritedPermissions={inheritedPermissions}
      overrideModeMap={overrideModeMap}
      summaryCounts={summaryCounts}
      canManagePermissions={canManagePermissions}
      isSaving={overridesMutation.isPending}
      isDirty={isDirty}
      feedback={scopedFeedback}
      onSearchChange={setSearch}
      onSelectUser={handleSelectUser}
      onRetryData={() => {
        void permissionsQuery.refetch();
        void rolePermissionsQuery.refetch();
        void userOverridesQuery.refetch();
      }}
      onModeChange={handleModeChange}
      onReset={() => setDraft(selectedUser ? { userId: selectedUser.id, modes: {} } : null)}
      onSave={() => {
        void handleSave();
      }}
    />
  );
}