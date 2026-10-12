import { Skeleton } from "@/modules/shared/components/ui/skeleton";

export function SplitReviewSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-5 w-72" />
      </div>
      <div className="flex min-h-0 flex-1">
        <Skeleton className="h-full flex-1 rounded-none" />
        <div className="flex flex-1 flex-col gap-3 border-l p-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </div>
  );
}
