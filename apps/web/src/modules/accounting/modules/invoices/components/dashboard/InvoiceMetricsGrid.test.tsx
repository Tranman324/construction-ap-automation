import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InvoiceMetricsGrid } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceMetricsGrid";
import type { DashboardStats } from "@/modules/accounting/modules/invoices/types/api";

function makeStats(): DashboardStats {
  return {
    total: 18,
    activeTotal: 18,
    trashTotal: 2,
    shelfTotal: 5,
    globalTotal: 25,
    pending: 7,
    approved: 4,
    rejected: 0,
    submitted: 7,
    discarded: 0,
    duplicate: 0,
    reviewed: 0,
    errors: 2,
    skipped: 0,
    todayProcessed: 9,
    avgConfidence: 0.91,
    missingLienWaivers: 3,
    amounts: { pending: 4200, approved: 3300, submitted: 16000, total: 23500 },
  };
}

describe("InvoiceMetricsGrid", () => {
  it("renders the queue dashboard metrics using existing stats fields", () => {
    render(
      <InvoiceMetricsGrid
        stats={makeStats()}
        isLoading={false}
        activeStatus="all"
        onStatusSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Pending Approval")).toBeInTheDocument();
    expect(screen.getByText("Ready to Submit")).toBeInTheDocument();
    expect(screen.getByText("Open AP Balance")).toBeInTheDocument();
    expect(screen.getByText("$7.5K")).toBeInTheDocument();
    expect(screen.getByText("7 submitted this cycle")).toBeInTheDocument();
  });

  it("clicks metric cards into their status filters", async () => {
    const user = userEvent.setup();
    const onStatusSelect = vi.fn();

    render(
      <InvoiceMetricsGrid
        stats={makeStats()}
        isLoading={false}
        activeStatus="all"
        onStatusSelect={onStatusSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: /ready to submit/i }));

    expect(onStatusSelect).toHaveBeenCalledWith("approved");
  });

  it("renders an explicit error state when stats fail", () => {
    render(
      <InvoiceMetricsGrid
        stats={undefined}
        isLoading={false}
        isError
        activeStatus="all"
        onStatusSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Invoice metrics unavailable");
  });
});
