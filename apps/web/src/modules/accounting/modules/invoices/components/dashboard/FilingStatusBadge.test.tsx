import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FilingStatusBadge } from "@/modules/accounting/modules/invoices/components/dashboard/FilingStatusBadge";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "doc-1",
    classification: "other",
    confidence: 0.8,
    file: "document.pdf",
    email: {
      from: "vendor@example.com",
      subject: "Document",
      receivedAt: "2026-07-03T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-07-03T12:00:00.000Z",
    extracted: null,
    matching: null,
    overallConfidence: 0.8,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    ...overrides,
  };
}

describe("FilingStatusBadge", () => {
  it("renders nothing for unfiled documents", () => {
    const { container } = render(<FilingStatusBadge invoice={makeInvoice({ filed: false })} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders a shelf badge for locally filed documents", () => {
    render(<FilingStatusBadge invoice={makeInvoice({ filed: true, spFileUrl: null })} />);

    expect(screen.getByText("Shelved")).toBeInTheDocument();
  });

  it("renders a SharePoint badge when a SharePoint URL exists", () => {
    render(<FilingStatusBadge invoice={makeInvoice({ filed: true, spFileUrl: "https://sharepoint/file.pdf" })} />);

    expect(screen.getByText("Filed to SP")).toBeInTheDocument();
  });
});
