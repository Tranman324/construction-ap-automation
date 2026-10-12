"use client";

import { useMemo, type CSSProperties } from "react";
import { Circle, Trash2 } from "lucide-react";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/modules/shared/components/ui/table";
import { cn } from "@/modules/shared/lib/utils";
import { PaginationBar } from "@/modules/accounting/modules/invoices/components/invoices/PaginationBar";
import { CurrencyCell } from "@/modules/accounting/modules/invoices/components/invoices/renderers/CurrencyCell";
import { DateCell } from "@/modules/accounting/modules/invoices/components/invoices/renderers/DateCell";
import { ClassificationBadge } from "@/modules/accounting/modules/invoices/components/invoices/renderers/ClassificationBadge";
import { TrashActions } from "@/modules/accounting/modules/invoices/components/trash/TrashActions";
import { TrashDiscardSourcePill } from "@/modules/accounting/modules/invoices/components/trash/TrashDiscardSourcePill";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";
import { useQueueArrival } from "@/modules/shared/hooks/useQueueArrival";
import type { TrashListResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

interface TrashTableProps {
  data: TrashListResponse | undefined;
  isLoading: boolean;
  page: number;
  pages: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  onRowClick?: (id: string) => void;
  surface?: "framed" | "flush";
}

function getVendorName(invoice: Invoice): string {
  const vendor = invoice.matching?.vendor;
  const name = vendor?.vendorName || invoice.extracted?.vendorName;
  if (name) return vendor?.vendorCode ? `${vendor.vendorCode} — ${name}` : name;
  return invoice.email?.from || "Unidentified sender";
}

function getInvoiceNumber(invoice: Invoice): string {
  return invoice.extracted?.invoiceNumber || invoice.file || invoice.email?.subject || `Document ${invoice.id}`;
}

function TrashSkeletonCell({ column }: { column: number }) {
  if (column === 1) return (
    <div className="space-y-1.5">
      <Skeleton className="h-4 w-32 max-w-full" />
      <Skeleton className="h-3 w-20 max-w-full" />
    </div>
  );
  if (column === 6) return (
    <div className="flex items-center justify-end gap-2">
      <Skeleton className="h-8 w-20 rounded-md" />
      <Skeleton className="h-8 w-28 rounded-md" />
    </div>
  );
  if ([0, 2, 3].includes(column)) return <Skeleton className="h-5 w-20 max-w-full rounded-full" />;
  return <Skeleton className="h-4 w-16 max-w-full" />;
}

export function TrashTable({
  data,
  isLoading,
  page,
  pages,
  limit,
  onPageChange,
  onLimitChange,
  onRowClick,
  surface = "framed",
}: TrashTableProps) {
  const invoices = useMemo(() => data?.invoices ?? [], [data]);
  const arrivingRows = useQueueArrival(isLoading, invoices.map((invoice) => invoice.id));

  if (isLoading) {
    return (
      <div className={cn(surface === "framed" && "rounded-xl border border-border/60 bg-card/70 shadow-sm")}>
        <Table className="tbx-table inv-trash-table min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Vendor / Document</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Discarded</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 6 }).map((_, index) => (
              <TableRow key={index}>
                {Array.from({ length: 7 }).map((__, cellIndex) => (
                  <TableCell key={cellIndex}>
                    <TrashSkeletonCell column={cellIndex} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <div className={cn(
        "flex flex-col items-center justify-center px-6 py-20 text-center",
        surface === "framed" && "rounded-xl border border-dashed border-border/70 bg-card/50 shadow-sm",
      )}>
        <div className="mb-4 rounded-full bg-muted p-4 shadow-sm">
          <Trash2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-base font-semibold text-foreground">Trash is empty</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Deleted invoices will appear here for recovery.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className={cn(surface === "framed" && "rounded-xl border border-border/60 bg-card/70 shadow-sm")}>
        <Table className="tbx-table inv-trash-table min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Vendor / Document</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Discarded</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice, index) => (
              <TableRow
                key={invoice.id}
                data-arriving={index < arrivingRows ? "true" : undefined}
                data-row-order={index < arrivingRows ? index : undefined}
                style={index < arrivingRows ? { "--queue-row-order": index } as CSSProperties : undefined}
                className={cn("transition-colors hover:bg-muted/30", onRowClick && "cursor-pointer", motionStyles.queueArrivalRow)}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={() => onRowClick?.(invoice.id)}
                onKeyDown={(event) => {
                  if (onRowClick && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onRowClick(invoice.id);
                  }
                }}
              >
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    <Circle className="h-2 w-2 fill-current" aria-hidden="true" />
                    Discarded
                  </span>
                </TableCell>
                <TableCell>
                  <div className="min-w-0">
                    <div className="inv-vendor truncate" title={getVendorName(invoice)}>{getVendorName(invoice)}</div>
                    <div className="inv-sub-num truncate" title={getInvoiceNumber(invoice)}>{getInvoiceNumber(invoice)}</div>
                  </div>
                </TableCell>
                <TableCell>
                  <ClassificationBadge classification={invoice.classification} />
                </TableCell>
                <TableCell><TrashDiscardSourcePill invoice={invoice} /></TableCell>
                <TableCell>
                  <CurrencyCell amount={invoice.extracted?.amount ?? null} />
                </TableCell>
                <TableCell>
                  <DateCell dateStr={invoice.deletedAt ?? invoice.discardedAt ?? null} />
                </TableCell>
                <TableCell
                  className="whitespace-nowrap text-right"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <TrashActions invoice={invoice} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <PaginationBar
        page={page}
        pages={pages}
        total={data?.total ?? 0}
        limit={limit}
        onPageChange={onPageChange}
        onLimitChange={onLimitChange}
      />
    </div>
  );
}
