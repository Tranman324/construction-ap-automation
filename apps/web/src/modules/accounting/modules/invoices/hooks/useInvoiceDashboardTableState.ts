"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { VisibilityState } from "@tanstack/react-table";

import { DEFAULT_COLUMN_ORDER } from "@/modules/accounting/modules/invoices/components/invoices/ColumnToggleDropdown";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";

const COLUMNS_STORAGE_KEY = "inv-columns-v3";
const COLUMN_ORDER_STORAGE_KEY = "inv-column-order-v3"; // gitleaks:allow (localStorage key name, not a secret)

interface SearchDraftState {
  baseValue: string;
  value: string;
}

interface UseInvoiceDashboardTableStateArgs {
  filters: InvoiceFilters;
  setFilter: (key: keyof InvoiceFilters, value: string | number | undefined) => void;
  visibleInvoices?: Invoice[];
}

function readColumnVisibility(): VisibilityState {
  if (typeof window === "undefined") return { emailFrom: false, emailSubject: false };
  try {
    const stored = JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY) ?? "null");
    if (stored) return { ...stored, activityMarker: true, vendorName: true };
  } catch {}
  return { emailFrom: false, emailSubject: false };
}

function readColumnOrder(): string[] {
  if (typeof window === "undefined") return DEFAULT_COLUMN_ORDER;
  try {
    const stored = JSON.parse(localStorage.getItem(COLUMN_ORDER_STORAGE_KEY) ?? "null");
    if (Array.isArray(stored) && stored.length > 0) return migrateColumnOrder(stored);
  } catch {}
  return DEFAULT_COLUMN_ORDER;
}

function migrateColumnOrder(order: unknown[]): string[] {
  const withoutMarker = order.filter((id): id is string => typeof id === "string" && id !== "activityMarker");
  const statusIndex = withoutMarker.indexOf("status");
  const insertAt = statusIndex >= 0 ? statusIndex + 1 : 0;
  withoutMarker.splice(insertAt, 0, "activityMarker");
  return withoutMarker;
}

export function useInvoiceDashboardTableState({
  filters,
  setFilter,
  visibleInvoices = [],
}: UseInvoiceDashboardTableStateArgs) {
  const currentSearch = filters.search ?? "";
  const activeStatus = filters.status ?? "all";
  const visibleInvoiceLookup = useMemo(
    () => new Map(visibleInvoices.map((invoice) => [invoice.id, invoice])),
    [visibleInvoices],
  );

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedInvoiceMap, setSelectedInvoiceMap] = useState<Record<string, Invoice>>({});
  const [searchDraft, setSearchDraft] = useState<SearchDraftState>(() => ({
    baseValue: currentSearch,
    value: currentSearch,
  }));
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(readColumnVisibility);
  const [columnOrder, setColumnOrder] = useState<string[]>(readColumnOrder);

  const selectedInvoices = useMemo(
    () => selectedIds
      .map((id) => visibleInvoiceLookup.get(id) ?? selectedInvoiceMap[id])
      .filter((invoice): invoice is Invoice => invoice !== undefined),
    [selectedIds, selectedInvoiceMap, visibleInvoiceLookup],
  );
  const searchValue = searchDraft.baseValue === currentSearch ? searchDraft.value : currentSearch;

  const handleSearchValueChange = useCallback((value: string) => {
    setSearchDraft({ baseValue: currentSearch, value });
  }, [currentSearch]);

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedIds(ids);
    setSelectedInvoiceMap((previous) => {
      const next: Record<string, Invoice> = {};

      for (const id of ids) {
        const invoice = visibleInvoiceLookup.get(id) ?? previous[id];
        if (invoice) next[id] = invoice;
      }

      return next;
    });
  }, [visibleInvoiceLookup]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setSelectedInvoiceMap({});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columnVisibility));
    } catch {}
  }, [columnVisibility]);

  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(columnOrder));
    } catch {}
  }, [columnOrder]);

  useEffect(() => {
    if (searchValue === currentSearch) return;

    const timeoutId = window.setTimeout(() => {
      setFilter("search", searchValue);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [currentSearch, searchValue, setFilter]);

  return {
    activeStatus,
    clearSelection,
    columnOrder,
    columnVisibility,
    handleSearchValueChange,
    handleSelectionChange,
    searchValue,
    selectedIds,
    selectedInvoices,
    setColumnOrder,
    setColumnVisibility,
  };
}
