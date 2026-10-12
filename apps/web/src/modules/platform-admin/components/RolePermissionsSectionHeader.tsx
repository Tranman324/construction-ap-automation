"use client";

import { Badge } from "@/modules/shared/components/ui/badge";
import { CardDescription, CardHeader, CardTitle } from "@/modules/shared/components/ui/card";

interface RolePermissionsSectionHeaderProps {
  roleCount: number;
  moduleCount: number;
  permissionCount: number;
}

export function RolePermissionsSectionHeader({
  roleCount,
  moduleCount,
  permissionCount,
}: RolePermissionsSectionHeaderProps) {
  return (
    <CardHeader className="gap-3 border-b border-border/50 px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <CardTitle className="text-xl font-bold text-foreground">Grouped role permission matrix</CardTitle>
          <CardDescription className="max-w-3xl text-sm leading-6">
            Review grouped permissions by module, compare them against the selected role baseline,
            and save a full replacement permission set when changes are ready.
          </CardDescription>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-border/60 bg-background/70 text-foreground">
            {roleCount} roles
          </Badge>
          <Badge variant="outline" className="border-border/60 bg-background/70 text-foreground">
            {moduleCount} modules
          </Badge>
          <Badge variant="outline" className="border-border/60 bg-background/70 text-foreground">
            {permissionCount} permissions
          </Badge>
        </div>
      </div>
    </CardHeader>
  );
}