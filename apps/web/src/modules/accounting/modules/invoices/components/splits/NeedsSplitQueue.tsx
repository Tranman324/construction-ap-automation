"use client";

import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { FileQuestion } from "lucide-react";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/modules/shared/components/ui/table";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import { useSplitQueue } from "@/modules/accounting/modules/invoices/hooks/queries";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";
import { useQueueArrival } from "@/modules/shared/hooks/useQueueArrival";

function SplitSkeletonCell({ column }: { column: number }) {
  if (column === 2) return (
    <div className="space-y-1.5">
      <Skeleton className="h-4 w-36 max-w-full" />
      <Skeleton className="h-3 w-24 max-w-full" />
    </div>
  );
  if (column >= 4) return <Skeleton className="h-5 w-20 max-w-full rounded-full" />;
  return <Skeleton className={column === 3 ? "ml-auto h-4 w-8" : "h-4 w-24 max-w-full"} />;
}

export function NeedsSplitQueue() {
  const router = useRouter();
  const { data, isLoading } = useSplitQueue({ limit: 50 });
  const items = data?.items ?? [];
  const arrivingRows = useQueueArrival(isLoading, items.map((item) => item.id));

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Needs Split</h1>
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Filename</TableHead>
                <TableHead className="text-right">Pages</TableHead>
                <TableHead>Detected</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}>
                      <SplitSkeletonCell column={j} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Needs Split</h1>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            <FileQuestion className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-base font-medium mb-1">No PDFs need splitting</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Documents manually queued for split review will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Needs Split</h1>
        <Badge variant="secondary" className="tabular-nums">
          {data?.total ?? items.length}
        </Badge>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Filename</TableHead>
              <TableHead className="text-right">Pages</TableHead>
              <TableHead>Detected</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((doc: import("@/modules/accounting/modules/invoices/types/api").SplitDoc, index: number) => {
              const groupCount =
                doc.splitSuggestion?.suggestedGroups?.length ?? 0;
              return (
                <TableRow
                  key={doc.id}
                  data-arriving={index < arrivingRows ? "true" : undefined}
                  data-row-order={index < arrivingRows ? index : undefined}
                  style={index < arrivingRows ? { "--queue-row-order": index } as CSSProperties : undefined}
                  className={`cursor-pointer hover:bg-muted/50 ${motionStyles.queueArrivalRow}`}
                  onClick={() => router.push(`/accounting/invoices/splits/${doc.id}`)}
                >
                  <TableCell className="text-sm tabular-nums">
                    {doc.email?.receivedAt
                      ? format(new Date(doc.email.receivedAt), "MMM d, yyyy")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">
                    {doc.email?.from ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {doc.fileName}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {doc.pageCount}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        groupCount === 0
                          ? "text-gray-600 bg-gray-50"
                          : groupCount === 1
                            ? "text-amber-600 bg-amber-50"
                            : "text-emerald-600 bg-emerald-50"
                      }
                    >
                      {groupCount === 0
                        ? "Unknown"
                        : `${groupCount} group${groupCount > 1 ? "s" : ""}`}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/accounting/invoices/splits/${doc.id}`);
                      }}
                    >
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
