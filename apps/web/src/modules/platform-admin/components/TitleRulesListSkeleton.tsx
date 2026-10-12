import { Skeleton } from "@/modules/shared/components/ui/skeleton";

export function TitleRulesListSkeleton() {
  return (
    <div
      data-testid="title-rules-loading-state"
      className="overflow-hidden rounded-xl border border-border/50 bg-background/70"
    >
      <div className="space-y-4 px-4 py-5">
        <p className="text-sm text-muted-foreground">Loading title rules...</p>
        <div className="grid gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>
    </div>
  );
}