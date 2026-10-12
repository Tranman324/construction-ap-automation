"use client";

import { useEffect, useMemo, useState } from "react";
import type { CheckedState } from "@radix-ui/react-checkbox";

import { PermissionModuleCard } from "@/modules/platform-admin/components/PermissionModuleCard";
import { PermissionMatrixSaveBar } from "@/modules/platform-admin/components/PermissionMatrixSaveBar";
import {
  formatModuleLabel,
  haveSamePermissions,
  normalizePermissionList,
  type PermissionModuleAction,
} from "@/modules/platform-admin/components/permissionMatrixUtils";
import type { AdminPermissionGroups } from "@/modules/platform-admin/types/admin";
import { cn } from "@/modules/shared/lib/utils";

export interface PermissionMatrixFeedback {
  tone: "success" | "error";
  message: string;
}

interface PermissionMatrixProps {
  permissionGroups: AdminPermissionGroups;
  loadedPermissions: string[];
  canManagePermissions: boolean;
  disabledPermissionMessage?: string;
  readOnlyMessage?: string;
  isSaving?: boolean;
  feedback?: PermissionMatrixFeedback | null;
  onSave: (permissions: string[]) => Promise<void> | void;
}

export function PermissionMatrix({
  permissionGroups,
  loadedPermissions,
  canManagePermissions,
  disabledPermissionMessage,
  readOnlyMessage,
  isSaving = false,
  feedback = null,
  onSave,
}: PermissionMatrixProps) {
  const normalizedLoadedPermissions = useMemo(
    () => normalizePermissionList(loadedPermissions),
    [loadedPermissions],
  );
  const [selectedPermissions, setSelectedPermissions] = useState(normalizedLoadedPermissions);

  useEffect(() => {
    setSelectedPermissions(normalizedLoadedPermissions);
  }, [normalizedLoadedPermissions]);

  const selectedPermissionSet = useMemo(
    () => new Set(selectedPermissions),
    [selectedPermissions],
  );
  const loadedPermissionSet = useMemo(
    () => new Set(normalizedLoadedPermissions),
    [normalizedLoadedPermissions],
  );
  const moduleEntries = useMemo(
    () =>
      Object.entries(permissionGroups).sort(([left], [right]) =>
        formatModuleLabel(left).localeCompare(formatModuleLabel(right)),
      ),
    [permissionGroups],
  );
  const isDirty = !haveSamePermissions(selectedPermissions, normalizedLoadedPermissions);
  const controlsDisabled = isSaving || !canManagePermissions || Boolean(readOnlyMessage);
  const statusMessage = readOnlyMessage ?? (!canManagePermissions ? disabledPermissionMessage : undefined);

  function updateSelection(nextSelection: Iterable<string>) {
    setSelectedPermissions(normalizePermissionList(nextSelection));
  }

  function togglePermission(permissionKey: string, checked: CheckedState) {
    const nextSelection = new Set(selectedPermissionSet);

    if (checked === true) {
      nextSelection.add(permissionKey);
    } else {
      nextSelection.delete(permissionKey);
    }

    updateSelection(nextSelection);
  }

  function applyModuleAction(modulePermissionKeys: string[], action: PermissionModuleAction) {
    const nextSelection = new Set(selectedPermissionSet);

    for (const permissionKey of modulePermissionKeys) {
      nextSelection.delete(permissionKey);
    }

    if (action === "all") {
      for (const permissionKey of modulePermissionKeys) {
        nextSelection.add(permissionKey);
      }
    }

    if (action === "reset") {
      for (const permissionKey of modulePermissionKeys) {
        if (loadedPermissionSet.has(permissionKey)) {
          nextSelection.add(permissionKey);
        }
      }
    }

    updateSelection(nextSelection);
  }

  async function handleSave() {
    await onSave(selectedPermissions);
  }

  if (moduleEntries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-sm text-muted-foreground">
        No permissions are available for this role yet.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="permission-matrix">
      {statusMessage ? (
        <div
          data-testid={readOnlyMessage ? "permission-matrix-readonly" : "permission-matrix-disabled"}
          className={cn(
            "rounded-xl border px-4 py-3 text-sm",
            readOnlyMessage
              ? "border-amber-500/40 bg-amber-500/8 text-amber-900 dark:text-amber-100"
              : "border-border/60 bg-muted/50 text-muted-foreground",
          )}
        >
          {statusMessage}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {moduleEntries.map(([moduleId, permissions]) => (
          <PermissionModuleCard
            key={moduleId}
            moduleId={moduleId}
            permissions={permissions}
            selectedPermissionKeys={selectedPermissionSet}
            controlsDisabled={controlsDisabled}
            disabledReason={statusMessage}
            onModuleAction={(action) =>
              applyModuleAction(
                permissions.map((permission) => permission.key),
                action,
              )
            }
            onTogglePermission={togglePermission}
          />
        ))}
      </div>

      <PermissionMatrixSaveBar
        isDirty={isDirty}
        isSaving={isSaving}
        controlsDisabled={controlsDisabled}
        disabledReason={statusMessage}
        feedback={feedback}
        onReset={() => setSelectedPermissions(normalizedLoadedPermissions)}
        onSave={() => {
          void handleSave();
        }}
      />
    </div>
  );
}