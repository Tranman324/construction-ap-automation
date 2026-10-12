"use client";

import { Plus, RefreshCcw } from "lucide-react";

import { Button } from "@/modules/shared/components/ui/button";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";

export function LoadingWorkspace() {
  return (
    <div className="col-span-2 grid grid-cols-[300px_minmax(0,1fr)]">
      <div className="space-y-3 border-r bg-muted/30 p-3">
        {[0, 1, 2].map((item) => <Skeleton key={item} className="h-24 rounded-lg" />)}
      </div>
      <div className="space-y-4 p-4">
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-44 rounded-lg" />
        <Skeleton className="h-44 rounded-lg" />
      </div>
    </div>
  );
}

export function ErrorWorkspace({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="col-span-2 flex flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm font-medium">Rules could not be loaded.</p>
      <Button variant="outline" size="sm" className="gap-2" onClick={onRetry}>
        <RefreshCcw className="h-4 w-4" />
        Retry
      </Button>
    </div>
  );
}

export function EmptyWorkspace({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="col-span-2 flex flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm font-medium">No rules yet</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Create a rule to automatically code, file, flag, or hide matching invoices.
      </p>
      <Button size="sm" className="gap-2" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        Create rule
      </Button>
    </div>
  );
}
