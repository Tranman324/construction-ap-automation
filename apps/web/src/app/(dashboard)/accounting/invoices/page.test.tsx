import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/app/(dashboard)/accounting/invoices/InvoiceQueuePage", () => ({
  InvoiceQueuePage: () => <div>Invoice Queue Route</div>,
}));

import InvoicesPage from "@/app/(dashboard)/accounting/invoices/page";

describe("InvoicesPage", () => {
  it("renders the invoice queue entry point", () => {
    render(React.createElement(InvoicesPage));

    expect(screen.getByText("Invoice Queue Route")).toBeInTheDocument();
  });
});