"use client";

import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";
import { DASHBOARD_PANELS } from "@/modules/accounting/modules/invoices/components/dashboard/DashboardPanelFilters";
import { FilterSummaryBar } from "@/modules/shared/components/patterns";

interface InvoiceFilterSummaryProps {
  filters: InvoiceFilters;
  onClear: () => void;
  resultCount?: number;
}

export function hasInvoiceFilterSummary(filters: InvoiceFilters): boolean {
  return Boolean(
    filters.flagged ||
    filters.search ||
    filters.panel ||
    filters.classification ||
    filters.job,
  );
}

function getPanelLabel(panel: NonNullable<InvoiceFilters["panel"]>): string {
  const option = DASHBOARD_PANELS.find((item) => item.value === panel);
  return option?.label ?? panel;
}

function getClassificationLabel(classification: string): string {
  return classification.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function InvoiceFilterSummary({
  filters,
  onClear,
  resultCount,
}: InvoiceFilterSummaryProps) {
  if (!hasInvoiceFilterSummary(filters)) return null;

  const contextualFilters = (
    <>
      {filters.search && <> for <strong>&quot;{filters.search}&quot;</strong></>}
      {filters.panel && <> in <strong>{getPanelLabel(filters.panel)}</strong></>}
      {filters.classification && <> of type <strong>{getClassificationLabel(filters.classification)}</strong></>}
      {filters.job && <> in <strong>{filters.job}</strong></>}
    </>
  );

  if (filters.flagged) {
    const statusLabel = filters.status && filters.status !== "all" ? `${filters.status} ` : "";
    return (
      <FilterSummaryBar onClear={onClear} clearLabel={`Show all ${statusLabel}documents`}>
        Showing <strong>{resultCount ?? "…"} flagged</strong> {statusLabel}documents{contextualFilters}
      </FilterSummaryBar>
    );
  }

  return (
    <FilterSummaryBar onClear={onClear}>
      Showing <strong>{resultCount ?? "…"}</strong> results
      {contextualFilters}
    </FilterSummaryBar>
  );
}
