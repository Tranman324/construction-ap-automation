"use client";

import dynamic from "next/dynamic";
import { use } from "react";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import type { SplitQueueNavigationParams } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewPage";

interface SplitReviewSurfaceProps {
  id: string;
  returnTo?: string;
  queueParams?: SplitQueueNavigationParams;
}

const SplitReviewSurface = dynamic<SplitReviewSurfaceProps>(
  () =>
    import(
      "@/modules/accounting/modules/invoices/components/splits/SplitReviewPage"
    ).then((mod) => mod.SplitReviewPage),
  {
    loading: SplitReviewRouteFallback,
  },
);

function SplitReviewRouteFallback() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-[640px] rounded-lg" />
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-36 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default function SplitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("from") ?? undefined;
  const queueParams: SplitQueueNavigationParams = {};
  for (const key of ["from", "sort", "sortDir", "panel", "classification", "search", "status", "splitFrom"] as const) {
    const value = searchParams.get(key);
    if (value) queueParams[key] = value;
  }
  return <SplitReviewSurface id={id} returnTo={returnTo} queueParams={queueParams} />;
}
