import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { InvoiceListResponse } from "@/modules/accounting/modules/invoices/types/api";
import { InvoiceQueueTableSection } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceQueueTableSection";

vi.mock("@/modules/accounting/modules/invoices/components/invoices/InvoiceTable", () => ({
  InvoiceTable: ({ data }: { data: InvoiceListResponse | undefined }) => (
    <div data-testid="invoice-table">Rows: {data?.total ?? 0}</div>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/PaginationBar", () => ({
  PaginationBar: ({ selectedCount, total }: { selectedCount?: number; total: number }) => (
    <div data-testid="pagination">Total: {total}; Selected: {selectedCount ?? 0}</div>
  ),
}));

function renderSection(overrides: { error?: boolean; onRetry?: () => void; selectedIds?: string[] } = {}) {
  return render(
    <InvoiceQueueTableSection
      data={{ invoices: [], total: 2, page: 1, limit: 25, pages: 1 }}
      error={overrides.error ?? false}
      filters={{ page: 1, limit: 25, search: "", status: "all" }}
      isLoading={false}
      selectedIds={overrides.selectedIds ?? []}
      columnVisibility={{}}
      columnOrder={[]}
      onColumnOrderChange={vi.fn()}
      onColumnVisibilityChange={vi.fn()}
      onLimitChange={vi.fn()}
      onPageChange={vi.fn()}
      onRetry={overrides.onRetry ?? vi.fn()}
      onRowClick={vi.fn()}
      onSelectionChange={vi.fn()}
      onSortChange={vi.fn()}
    />,
  );
}

describe("InvoiceQueueTableSection", () => {
  it("renders the table and pagination when data is available", () => {
    renderSection({ selectedIds: ["inv-1", "inv-2"] });

    expect(screen.getByTestId("invoice-table")).toHaveTextContent("Rows: 2");
    expect(screen.getByTestId("pagination")).toHaveTextContent("Total: 2; Selected: 2");
  });

  it("renders an explicit retryable error when the invoice query fails", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    renderSection({ error: true, onRetry });

    expect(screen.getByRole("alert")).toHaveTextContent("Invoice queue unavailable");

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
