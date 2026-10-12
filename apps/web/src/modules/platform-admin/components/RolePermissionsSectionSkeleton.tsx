"use client";

import { Card, CardContent, CardHeader } from "@/modules/shared/components/ui/card";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";

export function RolePermissionsSectionSkeleton() {
  return (
    <section data-testid="admin-section-role-perms" className="space-y-4">
      <Card className="border-border/60 bg-card/95 py-0 shadow-sm shadow-primary/5 backdrop-blur-sm">
        <CardHeader className="gap-3 border-b border-border/50 pb-5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-full max-w-3xl" />
        </CardHeader>
        <CardContent className="grid gap-4 py-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="space-y-3 rounded-2xl border border-border/50 bg-background/70 p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}