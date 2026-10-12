import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  hasInvoiceFilterSummary,
  InvoiceFilterSummary,
} from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceFilterSummary";
import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";

const FILTER_CASES: Array<[string, InvoiceFilters]> = [
  ["search", { search: "acme" }],
  ["panel", { panel: "receipt" }],
  ["classification", { classification: "lien-waiver" }],
  ["job", { job: "25-401" }],
  ["flagged", { status: "pending", flagged: true }],
];

describe("InvoiceFilterSummary", () => {
  it("renders active dashboard filters and clears them", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();

    render(
      <InvoiceFilterSummary
        filters={{ search: "acme", status: "approved", job: "25-401" }}
        resultCount={3}
        onClear={onClear}
      />,
    );

    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
    expect(screen.getByText("3").parentElement).toHaveTextContent("Showing 3 results");
    expect(screen.getByText(/acme/)).toBeInTheDocument();
    expect(screen.getByText("25-401")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it.each(FILTER_CASES)("renders when the %s filter is active", (_, filters) => {
    render(
      <InvoiceFilterSummary
        filters={filters}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: filters.flagged ? /show all/i : /clear filters/i })).toBeInTheDocument();
  });

  it("does not render for dashboard status tabs alone", () => {
    render(
      <InvoiceFilterSummary
        filters={{ status: "submitted" }}
        onClear={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing Submitted results/i)).not.toBeInTheDocument();
  });

  it("renders a human-readable label for a classification-only filter", () => {
    render(
      <InvoiceFilterSummary
        filters={{ classification: "lien-waiver" }}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText("Lien Waiver")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeInTheDocument();
  });

  it("renders the plural human-readable label for a panel-only filter", () => {
    render(
      <InvoiceFilterSummary
        filters={{ panel: "lien-waiver" }}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText("Lien Waivers")).toBeInTheDocument();
  });

  it("describes flagged results within the active status instead of every status", () => {
    render(
      <InvoiceFilterSummary
        filters={{ status: "pending", flagged: true }}
        resultCount={4}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText("4 flagged").parentElement).toHaveTextContent("Showing 4 flagged pending documents");
    expect(screen.getByRole("button", { name: "Show all pending documents" })).toBeInTheDocument();
  });

  it("keeps the selected type in a combined Flagged summary", () => {
    render(
      <InvoiceFilterSummary
        filters={{ panel: "receipt", flagged: true }}
        resultCount={1}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText("1 flagged").parentElement).toHaveTextContent("Showing 1 flagged documents in Receipts");
  });

  it("detects when no summary should be shown", () => {
    expect(hasInvoiceFilterSummary({ status: "all", search: "" })).toBe(false);
    expect(hasInvoiceFilterSummary({ status: "approved" })).toBe(false);
    expect(hasInvoiceFilterSummary({ status: "pending" })).toBe(false);
    expect(hasInvoiceFilterSummary({ status: "submitted" })).toBe(false);
  });
});
