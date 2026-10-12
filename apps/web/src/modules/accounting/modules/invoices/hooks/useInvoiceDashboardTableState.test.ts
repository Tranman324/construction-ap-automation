import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_COLUMN_ORDER } from "@/modules/accounting/modules/invoices/components/invoices/ColumnToggleDropdown";
import { useInvoiceDashboardTableState } from "@/modules/accounting/modules/invoices/hooks/useInvoiceDashboardTableState";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";

const defaultFilters: InvoiceFilters = {
  status: "all",
  search: "",
  page: 1,
  limit: 25,
};

function makeInvoice(id: string): Invoice {
  return {
    id,
    classification: "invoice",
    confidence: 0.9,
    overallConfidence: 0.9,
    file: `${id}.pdf`,
    email: { from: "vendor@example.com", subject: "Invoice", receivedAt: "2026-01-01T00:00:00Z" },
    status: "approved",
    queuedAt: "2026-01-01T00:00:00Z",
    extracted: {
      vendorName: "Acme Corp",
      vendorAddress: null,
      invoiceNumber: id,
      invoiceDate: null,
      dueDate: null,
      amount: 100,
      jobNumber: null,
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: null,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

describe("useInvoiceDashboardTableState", () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("debounces search updates into invoice filters", () => {
    vi.useFakeTimers();
    const setFilter = vi.fn();
    const { result } = renderHook(() =>
      useInvoiceDashboardTableState({ filters: defaultFilters, setFilter }),
    );

    act(() => result.current.handleSearchValueChange("acme"));
    expect(result.current.searchValue).toBe("acme");

    act(() => vi.advanceTimersByTime(299));
    expect(setFilter).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(setFilter).toHaveBeenCalledWith("search", "acme");
  });

  it("keeps selected rows and metadata when the page changes", () => {
    const setFilter = vi.fn();
    const { result, rerender } = renderHook(
      ({ filters, visibleInvoices }) =>
        useInvoiceDashboardTableState({ filters, setFilter, visibleInvoices }),
      { initialProps: { filters: defaultFilters, visibleInvoices: [makeInvoice("inv-1")] } },
    );

    act(() => result.current.handleSelectionChange(["inv-1"]));
    expect(result.current.selectedIds).toEqual(["inv-1"]);
    expect(result.current.selectedInvoices.map((invoice) => invoice.id)).toEqual(["inv-1"]);

    rerender({ filters: { ...defaultFilters, page: 2 }, visibleInvoices: [makeInvoice("inv-2")] });
    expect(result.current.selectedIds).toEqual(["inv-1"]);
    expect(result.current.selectedInvoices.map((invoice) => invoice.id)).toEqual(["inv-1"]);
  });

  it("ignores old invoice column preference keys and persists versioned keys", () => {
    localStorage.setItem("invoiceColumnVisibility", JSON.stringify({ emailFrom: true }));
    localStorage.setItem("invoiceColumnOrder", JSON.stringify(["invoiceNumber", "vendorName"]));
    const setFilter = vi.fn();
    const { result } = renderHook(() =>
      useInvoiceDashboardTableState({ filters: defaultFilters, setFilter }),
    );

    expect(result.current.columnVisibility.emailFrom).toBe(false);
    expect(result.current.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);

    act(() => result.current.setColumnVisibility({ waiver: false }));
    expect(localStorage.getItem("inv-columns-v3")).toBe("{\"waiver\":false}");

    act(() => result.current.setColumnOrder(["status", "vendorName"]));
    expect(localStorage.getItem("inv-column-order-v3")).toBe("[\"status\",\"vendorName\"]");
  });
});
