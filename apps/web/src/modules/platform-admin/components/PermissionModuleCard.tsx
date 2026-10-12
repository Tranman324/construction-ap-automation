"use client";

import type { CheckedState } from "@radix-ui/react-checkbox";

import { AdminFieldHelp } from "@/modules/platform-admin/components/AdminFieldHelp";
import { HIGH_RISK_KEYS } from "@/modules/platform-admin/lib/adminCopy";
import type { AdminPermission } from "@/modules/platform-admin/types/admin";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Button } from "@/modules/shared/components/ui/button";
import { Card, CardContent } from "@/modules/shared/components/ui/card";
import { Checkbox } from "@/modules/shared/components/ui/checkbox";
import { cn } from "@/modules/shared/lib/utils";

import { formatModuleLabel, type PermissionModuleAction } from "@/modules/platform-admin/components/permissionMatrixUtils";

interface PermissionModuleCardProps {
  moduleId: string;
  permissions: AdminPermission[];
  selectedPermissionKeys: Set<string>;
  controlsDisabled: boolean;
  disabledReason?: string;
  onModuleAction: (action: PermissionModuleAction) => void;
  onTogglePermission: (permissionKey: string, checked: CheckedState) => void;
}

export function PermissionModuleCard({
  moduleId,
  permissions,
  selectedPermissionKeys,
  controlsDisabled,
  disabledReason,
  onModuleAction,
  onTogglePermission,
}: PermissionModuleCardProps) {
  const moduleLabel = formatModuleLabel(moduleId);
  const selectedCount = permissions.filter((permission) =>
    selectedPermissionKeys.has(permission.key),
  ).length;

  return (
    <Card className="border-border/60 bg-card/95 py-0 shadow-sm shadow-primary/5 backdrop-blur-sm">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{moduleLabel}</h3>
              <Badge variant="outline" className="border-primary/15 bg-primary/[0.06] text-primary">
                {selectedCount}/{permissions.length} selected
              </Badge>
            </div>
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
              Module permissions
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="xs" onClick={() => onModuleAction("all")} disabled={controlsDisabled} title={controlsDisabled ? disabledReason : `Grant every ${moduleLabel} permission in this role baseline.`}>
              Select all {moduleLabel}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onModuleAction("clear")} disabled={controlsDisabled} title={controlsDisabled ? disabledReason : `Remove every ${moduleLabel} permission from this role baseline.`}>
              Clear {moduleLabel}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onModuleAction("reset")} disabled={controlsDisabled} title={controlsDisabled ? disabledReason : "Restore this module to the saved role baseline."}>
              Reset {moduleLabel}
            </Button>
          </div>
        </div>

        <div className="border-t border-border/50">
          {permissions.map((permission) => {
            const isHighRisk = HIGH_RISK_KEYS.has(permission.key);

            return (
              <div
                key={permission.key}
                data-testid={`permission-row-${permission.key}`}
                className={cn(
                  "flex items-start justify-between gap-4 border-b border-border/40 px-5 py-4 last:border-b-0",
                  isHighRisk && "bg-destructive/5",
                )}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-xs text-foreground">{permission.key}</p>
                    <AdminFieldHelp
                      label={permission.key}
                      description={permission.description ?? "Toggles whether this permission key is included in the role baseline."}
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
                </div>

                <Checkbox
                  aria-label={`Toggle ${permission.key}`}
                  checked={selectedPermissionKeys.has(permission.key)}
                  disabled={controlsDisabled}
                  title={controlsDisabled ? disabledReason : `Toggle ${permission.key} in this role baseline.`}
                  onCheckedChange={(checked) => onTogglePermission(permission.key, checked)}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}