"use client";

import { Card, CardContent } from "@/modules/shared/components/ui/card";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";

export function RolePermissionsMatrixSkeleton() {
  return (
    <Card className="border-border/60 bg-card/95 py-0 shadow-sm shadow-primary/5 backdrop-blur-sm">
      <CardContent className="space-y-4 px-6 py-6">
        <Skeleton className="h-4 w-40" />
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}