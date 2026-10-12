"use client";

import { Skeleton } from "@/modules/shared/components/ui/skeleton";

export function DocSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full min-h-0 flex-col gap-3 bg-muted/20 p-3" data-testid="doc-skeleton">
      <div className="flex shrink-0 items-center justify-between border-b pb-3">
        <div className="flex gap-2"><Skeleton className="h-7 w-7" /><Skeleton className="h-7 w-24" /></div>
        <div className="flex gap-2"><Skeleton className="h-7 w-7" /><Skeleton className="h-7 w-7" /></div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-white p-5 shadow-sm dark:bg-card">
        <div className="flex items-center justify-between border-b pb-4"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-24" /></div>
        <div className="space-y-4 py-5">
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className={`h-4 ${index % 2 ? "w-4/5" : "w-full"}`} />)}
        </div>
        <div className="mt-6 flex justify-end border-t pt-4"><Skeleton className="h-5 w-28" /></div>
      </div>
    </div>
  );
}
