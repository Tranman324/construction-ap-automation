"use client";

import { useState } from "react";
import type { VisibilityState } from "@tanstack/react-table";

import { InvoiceDashboardErrorState } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceDashboardErrorState";
import { InvoiceTable } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceTable";
import { PaginationBar } from "@/modules/accounting/modules/invoices/components/invoices/PaginationBar";
import type { InvoiceListResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";

interface InvoiceQueueTableSectionProps {
  data: InvoiceListResponse | undefined;
  error: boolean;
  filters: InvoiceFilters;
  isLoading: boolean;
  globalSearch?: boolean;
  selectedIds: string[];
  columnVisibility: VisibilityState;
  columnOrder: string[];
  onColumnOrderChange: (order: string[]) => void;
  onColumnVisibilityChange: (visibility: VisibilityState) => void;
  onLimitChange: (limit: number) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onRowClick: (id: string, status: string, isTrash: boolean) => void;
  onSelectionChange: (ids: string[]) => void;
  onSortChange: (field: string) => void;
}

export function InvoiceQueueTableSection({
  data,
  error,
  filters,
  isLoading,
  globalSearch = false,
  selectedIds,
  columnVisibility,
  columnOrder,
  onColumnOrderChange,
  onColumnVisibilityChange,
  onLimitChange,
  onPageChange,
  onRetry,
  onRowClick,
  onSelectionChange,
  onSortChange,
}: InvoiceQueueTableSectionProps) {
  const [hasReceivedResponse, setHasReceivedResponse] = useState(data !== undefined);
  if (data !== undefined && !hasReceivedResponse) setHasReceivedResponse(true);

  const awaitingFirstResponse = !hasReceivedResponse && data === undefined;

  if (error) {
    return (
      <InvoiceDashboardErrorState
        title="Invoice queue unavailable"
        message="The invoice list could not be loaded. Retry before approving or submitting invoices."
        onRetry={onRetry}
      />
    );
  }

  return (
    <>
      {globalSearch && (
        <p className="px-1 pb-3 text-sm text-muted-foreground">
          Searching all documents, including Trash. Queue filters are restored when you clear search.
        </p>
      )}
      <InvoiceTable
        data={data}
        isLoading={isLoading || awaitingFirstResponse}
        sortField={filters.sort}
        sortDir={filters.sortDir}
        onSortChange={onSortChange}
        onRowClick={onRowClick}
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={onColumnVisibilityChange}
        columnOrder={columnOrder}
        onColumnOrderChange={onColumnOrderChange}
        globalSearch={globalSearch}
        surface="flush"
      />

      {!awaitingFirstResponse && (
        <PaginationBar
          page={filters.page ?? 1}
          pages={data?.pages ?? 1}
          total={data?.total ?? 0}
          limit={filters.limit ?? 25}
          selectedCount={selectedIds.length}
          onPageChange={onPageChange}
          onLimitChange={onLimitChange}
        />
      )}
    </>
  );
}
