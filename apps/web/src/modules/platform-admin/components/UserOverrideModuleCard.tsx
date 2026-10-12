"use client";

import { AdminFieldHelp } from "@/modules/platform-admin/components/AdminFieldHelp";
import { HIGH_RISK_KEYS } from "@/modules/platform-admin/lib/adminCopy";
import type { AdminPermission } from "@/modules/platform-admin/types/admin";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Button } from "@/modules/shared/components/ui/button";
import { Card, CardContent } from "@/modules/shared/components/ui/card";
import { cn } from "@/modules/shared/lib/utils";

import { formatModuleLabel } from "@/modules/platform-admin/components/permissionMatrixUtils";
import {
  getEffectiveUserOverrideState,
  type UserOverrideMode,
  type UserOverrideModeMap,
} from "@/modules/platform-admin/components/userOverridesUtils";

interface UserOverrideModuleCardProps {
  moduleId: string;
  permissions: AdminPermission[];
  inheritedPermissions: ReadonlySet<string>;
  overrideModeMap: UserOverrideModeMap;
  controlsDisabled: boolean;
  disabledReason?: string;
  onModeChange: (permissionKey: string, mode: UserOverrideMode) => void;
}

function getModeButtonVariant(currentMode: UserOverrideMode, targetMode: UserOverrideMode) {
  if (currentMode !== targetMode) {
    return "outline";
  }

  if (targetMode === "grant") {
    return "default";
  }

  if (targetMode === "revoke") {
    return "destructive";
  }

  return "secondary";
}

function getModeButtonTitle(targetMode: UserOverrideMode, permissionKey: string) {
  if (targetMode === "grant") {
    return `Grant ${permissionKey} directly to this user.`;
  }

  if (targetMode === "revoke") {
    return `Revoke ${permissionKey} directly from this user.`;
  }

  return `Use the role baseline for ${permissionKey}.`;
}

export function UserOverrideModuleCard({
  moduleId,
  permissions,
  inheritedPermissions,
  overrideModeMap,
  controlsDisabled,
  disabledReason,
  onModeChange,
}: UserOverrideModuleCardProps) {
  const moduleLabel = formatModuleLabel(moduleId);
  const explicitCount = permissions.filter((permission) => {
    const mode = overrideModeMap[permission.key] ?? "inherited";
    return mode !== "inherited";
  }).length;

  return (
    <Card className="border-border/60 bg-card/95 py-0 shadow-sm shadow-primary/5 backdrop-blur-sm">
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-foreground">{moduleLabel}</p>
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Explicit overrides</p>
          </div>
          <Badge variant="outline">{explicitCount}</Badge>
        </div>

        <div className="border-t border-border/50">
          {permissions.map((permission) => {
            const state = getEffectiveUserOverrideState(
              permission.key,
              inheritedPermissions,
              overrideModeMap,
            );
            const isHighRisk = HIGH_RISK_KEYS.has(permission.key);

            return (
              <div
                key={permission.key}
                data-testid={`override-row-${permission.key}`}
                className={cn(
                  "space-y-3 border-b border-border/40 px-5 py-4 last:border-b-0",
                  isHighRisk && "bg-destructive/5",
                )}
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-xs text-foreground">{permission.key}</p>
                    <AdminFieldHelp
                      label={permission.key}
                      description={permission.description ?? "Controls whether this user inherits, receives, or loses this permission directly."}
                    />
                    {isHighRisk ? (
                      <Badge variant="outline" className="border-destructive/35 bg-destructive/10 text-destructive">
                        High risk
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {permission.description ?? "No description provided."}
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline">
                      {state.inheritedGranted ? "Inherited grant" : "Inherited deny"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        state.effectiveGranted
                          ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-100",
                      )}
                    >
                      {state.effectiveGranted ? "Effective grant" : "Effective revoke"}
                    </Badge>
                  </div>
                </div>

                <div role="radiogroup" aria-label={`Override state for ${permission.key}`} className="flex flex-wrap gap-2">
                  {(["inherited", "grant", "revoke"] as const).map((targetMode) => (
                    <Button
                      key={targetMode}
                      type="button"
                      role="radio"
                      size="xs"
                      variant={getModeButtonVariant(state.mode, targetMode)}
                      aria-checked={state.mode === targetMode}
                      aria-label={`Set ${permission.key} to ${targetMode}`}
                      data-testid={`override-${permission.key}-${targetMode}`}
                      disabled={controlsDisabled}
                      title={controlsDisabled ? disabledReason : getModeButtonTitle(targetMode, permission.key)}
                      onClick={() => onModeChange(permission.key, targetMode)}
                    >
                      {targetMode.charAt(0).toUpperCase() + targetMode.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}