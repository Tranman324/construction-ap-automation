"use client";

import { RefreshCcw } from "lucide-react";

import { Button } from "@/modules/shared/components/ui/button";
import { Card, CardContent } from "@/modules/shared/components/ui/card";

interface RolePermissionsStateCardProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function RolePermissionsStateCard({
  title,
  description,
  actionLabel,
  onAction,
}: RolePermissionsStateCardProps) {
  return (
    <section data-testid="admin-section-role-perms" className="space-y-4">
      <Card className="border-border/60 bg-card/95 py-0 shadow-sm shadow-primary/5 backdrop-blur-sm">
        <CardContent className="flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
          {actionLabel && onAction ? (
            <Button variant="outline" onClick={onAction}>
              <RefreshCcw className="h-4 w-4" />
              {actionLabel}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}