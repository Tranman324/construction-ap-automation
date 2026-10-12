import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClosedPeriodApprovalNotice } from "@/modules/accounting/modules/invoices/components/invoices/ClosedPeriodApprovalNotice";

describe("ClosedPeriodApprovalNotice", () => {
  it("renders the exact recovery copy and CTA", () => {
    render(
      <ClosedPeriodApprovalNotice
        recovery={{ invoiceDateMonth: "July 2026", currentMonth: "August 2026", suggestedInvoiceDate: "2026-08-01" }}
        onUseSuggestedDate={vi.fn()}
      />,
    );

    expect(screen.getByText("Invoice date falls in July 2026 — a closed period. Only August 2026 is open.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use 2026-08-01" })).toBeEnabled();
  });
});
