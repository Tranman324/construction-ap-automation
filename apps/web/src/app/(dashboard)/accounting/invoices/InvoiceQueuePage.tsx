"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Settings } from "lucide-react";
import {
  ColumnToggleDropdown,
  DEFAULT_COLUMN_ORDER,
} from "@/modules/accounting/modules/invoices/components/invoices/ColumnToggleDropdown";
import { InvoiceDashboardFilters } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceDashboardFilters";
import { InvoiceFilterSummary } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceFilterSummary";
import { InvoiceMetricsGrid } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceMetricsGrid";
import { InvoiceSelectionActions } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceSelectionActions";
import { InvoiceQueueSubmitControl } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceQueueSubmitControl";
import { InvoiceQueueTableSection } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceQueueTableSection";
import { DashboardPanelFilters } from "@/modules/accounting/modules/invoices/components/dashboard/DashboardPanelFilters";
import { DocumentShelfWorkspace } from "@/modules/accounting/modules/invoices/components/documents/DocumentShelfWorkspace";
import { TrashTable } from "@/modules/accounting/modules/invoices/components/trash/TrashTable";
import { PipelineRunButton } from "@/modules/accounting/modules/invoices/components/dashboard/PipelineRunButton";
import { SettingsPanel } from "@/modules/accounting/modules/invoices/components/settings/SettingsPanel";
import { useInvoiceDashboardTableState } from "@/modules/accounting/modules/invoices/hooks/useInvoiceDashboardTableState";
import { useInvoiceFilters } from "@/modules/accounting/modules/invoices/hooks/useInvoiceFilters";
import { useRules } from "@/modules/accounting/modules/invoices/hooks/useRules";
import { useInvoices, useStats, useTrash } from "@/modules/accounting/modules/invoices/hooks/queries";
import { applyRules } from "@/modules/accounting/modules/invoices/lib/rules/engine";
import {
  applyDashboardFilters,
  buildInvoiceDashboardTabs,
  serializeQueueNavParams,
  toInvoiceQueryFilters,
} from "@/modules/accounting/modules/invoices/components/dashboard/invoiceDashboardModel";
import { DataTablePattern, PlatformSectionHeader } from "@/modules/shared/components/patterns";
import { formatShortcutTooltip, useDocumentPanelKeyboardShortcuts, useDocumentShortcutLabels } from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";
import { Button } from "@/modules/shared/components/ui/button";
import type { InvoiceFilters, InvoicePanel } from "@/modules/accounting/modules/invoices/types/ui";

export function InvoiceQueuePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { filters, setFilter, setFilters } = useInvoiceFilters();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const shortcuts = useDocumentShortcutLabels();
  const shortcutRef = useRef(null);
  useDocumentPanelKeyboardShortcuts({
    primaryActionRef: shortcutRef,
    undoAction: null,
    previousAction: null,
    nextAction: null,
    settingsAction: { label: "Settings", run: () => setSettingsOpen(true) },
  });
  const splitFrom = searchParams.get("splitFrom") ?? undefined;
  const isGlobalSearch = Boolean(filters.search?.trim());
  const isTrashView = !isGlobalSearch && filters.status === "discarded";
  const isDocumentsView = !isGlobalSearch && filters.status === "documents";
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 25;

  const invoiceQueryFilters = useMemo(
    () => toInvoiceQueryFilters(filters, splitFrom),
    [filters, splitFrom],
  );
  const {
    data: invoiceData,
    isLoading,
    isError: invoicesError,
    refetch: refetchInvoices,
  } = useInvoices(invoiceQueryFilters, {
    enabled: !isTrashView && !isDocumentsView,
    refetchInterval: splitFrom ? 5_000 : false,
  });
  // The stats endpoint intentionally exposes only a global flagged total. Use
  // the existing list contract with `limit=1` for the count shown beside the
  // Flagged control so it matches the current status/panel/query scope.
  const flaggedCountQuery = useMemo(
    () => ({ ...invoiceQueryFilters, flagged: true, page: 1, limit: 1 }),
    [invoiceQueryFilters],
  );
  const { data: flaggedCountData } = useInvoices(flaggedCountQuery, {
    enabled: !isGlobalSearch && !isTrashView && !isDocumentsView && !filters.flagged,
  });
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useStats({ filed: false, panel: filters.panel });
  const { data: trashData, isLoading: trashLoading } = useTrash(
    { limit, offset: (page - 1) * limit, search: filters.search || undefined, panel: filters.panel },
    { enabled: isTrashView },
  );
  const { data: rulesData } = useRules();
  const rulesFilteredInvoiceData = useMemo(() => {
    if (!invoiceData) return invoiceData;
    if (isGlobalSearch) return invoiceData;
    const rules = rulesData?.rules ?? [];
    const { visibleInvoices } = applyRules(invoiceData.invoices, rules);
    return { ...invoiceData, invoices: visibleInvoices };
  }, [invoiceData, isGlobalSearch, rulesData]);

  const filteredInvoiceData = useMemo(
    () => applyDashboardFilters(rulesFilteredInvoiceData, { ...filters, scope: invoiceQueryFilters.scope }),
    [filters, invoiceQueryFilters.scope, rulesFilteredInvoiceData],
  );
  // Job is intentionally client-only (and omitted from API requests), so do
  // not display a server total that would overstate that narrowed result set.
  const flaggedCount = filters.job
    ? filters.flagged
      ? filteredInvoiceData?.total
      : filteredInvoiceData?.invoices.filter((invoice) => invoice.flaggedAt != null).length
    : filters.flagged
      ? filteredInvoiceData?.total
      : flaggedCountData?.total;

  const {
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
  } = useInvoiceDashboardTableState({
    filters,
    setFilter,
    visibleInvoices: filteredInvoiceData?.invoices,
  });

  const tabs = useMemo(() => buildInvoiceDashboardTabs(stats), [stats]);
  const trashPages = Math.max(1, Math.ceil((trashData?.total ?? 0) / limit));

  function closeSearch(updates: Partial<InvoiceFilters> = {}) {
    setSearchOpen(false);
    handleSearchValueChange("");
    setFilters({ ...updates, search: "" });
  }

  function handleStatusChange(status: string) {
    if (status !== activeStatus) clearSelection();
    if ((status === "discarded" || status === "documents") && filters.flagged) {
      setFilters({ status, flagged: undefined });
      return;
    }
    setFilter("status", status);
  }

  function handlePanelChange(panel: InvoicePanel | undefined) {
    if (panel !== filters.panel) clearSelection();
    setFilters({ panel, classification: undefined });
  }

  function handleFlaggedSelect() {
    clearSelection();
    if (isTrashView || isDocumentsView) {
      setFilters({ status: "all", flagged: true });
      return;
    }
    setFilter("flagged", filters.flagged ? undefined : true);
  }

  function resetColumns() {
    setColumnVisibility({ emailFrom: false, emailSubject: false });
    setColumnOrder([...DEFAULT_COLUMN_ORDER]);
  }

  function handleSortChange(field: string) {
    if (filters.sort === field) {
      if (filters.sortDir === "asc") {
        setFilters({ sort: field, sortDir: "desc" });
      } else {
        setFilters({ sort: undefined, sortDir: undefined });
      }
      return;
    }

    setFilters({ sort: field, sortDir: "asc" });
  }

  function openDetail(id: string, status: string, isTrash: boolean) {
    const returnParams = new URLSearchParams(searchParams.toString());
    // A global result is independent of the tab that was active when search
    // began. Keep `from` byte-for-byte tied to that original URL so clearing
    // search on return restores the user's prior filters. Detail navigation
    // receives only the clicked record's status, never those stale filters.
    const detailStatus: NonNullable<InvoiceFilters["status"]> = isTrash
      ? "discarded"
      : isGlobalSearch
        ? (status as NonNullable<InvoiceFilters["status"]>)
        : activeStatus;
    if (detailStatus === "discarded" && !isGlobalSearch) returnParams.set("status", "discarded");
    const queryString = returnParams.toString();
    const from = pathname + (queryString ? `?${queryString}` : "");
    const detailFilters = isGlobalSearch ? { status: detailStatus } : { ...filters, status: detailStatus };
    const detailSplitFrom = isGlobalSearch ? undefined : splitFrom;

    // Soft-deleted search results stay in the safe, read-only detail route even
    // if their lifecycle status predates deletion and says needs-split.
    if (status === "needs-split" && !isTrash) {
      const splitParams = new URLSearchParams();
      splitParams.set("from", from);
      for (const [key, value] of Object.entries(serializeQueueNavParams(detailFilters, detailSplitFrom))) {
        splitParams.set(key, value);
      }
      router.push(`/accounting/invoices/splits/${id}?${splitParams.toString()}`);
      return;
    }

    const detailParams = new URLSearchParams();
    detailParams.set("from", from);
    if (isGlobalSearch) detailParams.set("globalSearch", "true");
    // Serialize the FULL queue context (status incl. the Flagged view, search,
    // panel, classification, sort, and splitFrom) so the detail neighbors request
    // is built from BYTE-IDENTICAL params — the shared boundary with the list
    // query. `splitFrom` was previously dropped, diverging the neighbors set.
    for (const [key, value] of Object.entries(serializeQueueNavParams(detailFilters, detailSplitFrom))) {
      detailParams.set(key, value);
    }
    router.push(`/accounting/invoices/${id}?${detailParams.toString()}`);
  }

  return (
    <>
      <div className="tbx-screen h-full overflow-y-auto px-4 py-4">
        <PlatformSectionHeader
          title="Accounting"
          accentLabel="AP Billing"
          className="tbx-screen__head"
          actions={(
            <InvoiceQueueSubmitControl stats={stats} statsLoading={statsLoading} selectedIds={selectedIds} selectedInvoices={selectedInvoices} />
          )}
        />

        <InvoiceMetricsGrid
          stats={stats}
          isLoading={statsLoading}
          isError={statsError}
          activeStatus={activeStatus}
          onStatusSelect={handleStatusChange}
          onRetry={() => { void refetchStats?.(); }}
        />

        <DataTablePattern
          toolbarActions={(
            <>
              <PipelineRunButton
                onCompleted={() => {
                  void refetchInvoices?.();
                  void refetchStats?.();
                }}
              />
              <Button variant="outline" size="sm" className="h-9 gap-2 px-3.5 text-sm font-semibold" title={formatShortcutTooltip("Settings", shortcuts.settings)} onClick={() => setSettingsOpen(true)}>
                <Settings className="h-4 w-4" />
                Settings
              </Button>
              <ColumnToggleDropdown
                columnVisibility={columnVisibility}
                onVisibilityChange={setColumnVisibility}
                columnOrder={columnOrder}
                onReset={resetColumns}
              />
            </>
          )}
          tabFilters={(
            <DashboardPanelFilters
              value={filters.panel}
              flaggedActive={filters.flagged}
              flaggedCount={flaggedCount}
              onFlaggedSelect={handleFlaggedSelect}
              onChange={handlePanelChange}
              search={{ value: searchValue, open: searchOpen, onOpen: () => setSearchOpen(true),
                onChange: handleSearchValueChange, onClose: () => closeSearch() }}
            >
              {!isTrashView && !isDocumentsView && <InvoiceDashboardFilters job={filters.job} onJobChange={(job) => setFilter("job", job)} />}
            </DashboardPanelFilters>
          )}
          tabFiltersPosition="after-tabs"
          tabs={tabs}
          activeTab={activeStatus}
          onTabChange={handleStatusChange}
          trash={{
            count: stats?.trashTotal ?? 0,
            active: isTrashView,
            onClick: () => handleStatusChange("discarded"),
          }}
          selection={isTrashView || isDocumentsView ? undefined : {
            count: selectedIds.length,
            onClear: clearSelection,
            actions: (
              <InvoiceSelectionActions selectedIds={selectedIds} onClear={clearSelection} />
            ),
          }}
        >
          <InvoiceFilterSummary
            filters={filters}
            resultCount={filteredInvoiceData?.total}
            onClear={() => {
              if (filters.flagged) {
                clearSelection();
                closeSearch({ flagged: undefined });
                return;
              }
              closeSearch({
                panel: undefined,
                classification: undefined,
                job: undefined,
              });
            }}
          />

          {isDocumentsView ? (
            <DocumentShelfWorkspace />
          ) : isTrashView ? (
            <TrashTable
              data={trashData}
              isLoading={trashLoading}
              page={page}
              pages={trashPages}
              limit={limit}
              onPageChange={(nextPage) => setFilter("page", nextPage)}
              onLimitChange={(nextLimit) => setFilter("limit", nextLimit)}
              onRowClick={(id) => openDetail(id, "discarded", true)}
              surface="flush"
            />
          ) : (
            <>
              <InvoiceQueueTableSection
                data={filteredInvoiceData} error={Boolean(invoicesError)}
                filters={filters} isLoading={isLoading} selectedIds={selectedIds}
                globalSearch={isGlobalSearch}
                columnVisibility={columnVisibility} columnOrder={columnOrder}
                onColumnOrderChange={setColumnOrder} onColumnVisibilityChange={setColumnVisibility}
                onLimitChange={(nextLimit) => setFilter("limit", nextLimit)}
                onPageChange={(nextPage) => setFilter("page", nextPage)}
                onRetry={() => { void refetchInvoices?.(); }}
                onSelectionChange={handleSelectionChange} onSortChange={handleSortChange}
                onRowClick={openDetail}
              />
            </>
          )}
        </DataTablePattern>
      </div>

      <SettingsPanel open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
