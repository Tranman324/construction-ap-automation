import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DocumentClassificationControl } from "@/modules/accounting/modules/invoices/components/documents/DocumentClassificationControl";
import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const classifications: ClassificationInfo[] = [
  { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  { name: "receipt", label: "Receipt", opensAs: "receipt", action: "view-only", builtIn: true, status: "active" },
  { name: "w9", label: "W-9", opensAs: "w9", action: "view-only", builtIn: true, status: "active" },
  { name: "disabled-doc", label: "Disabled Doc", opensAs: "other", action: "view-only", builtIn: false, status: "disabled" },
];

function makeRecord(): Invoice {
  return {
    id: "doc-1",
    classification: "receipt",
    confidence: 0.75,
    file: "receipt.pdf",
    email: {
      from: "vendor@example.com",
      subject: "Receipt",
      receivedAt: "2026-06-01T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-01T12:00:00.000Z",
    extracted: null,
    matching: null,
    overallConfidence: 0.75,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

describe("DocumentClassificationControl", () => {
  it("hides invoice options and routes changes through the handler", async () => {
    const user = userEvent.setup();
    const onReclassify = vi.fn();

    render(
      <DocumentClassificationControl
        record={makeRecord()}
        classifications={classifications}
        allowInvoiceClassification={false}
        onReclassify={onReclassify}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Reclassify document" }));

    expect(screen.queryByRole("option", { name: "Invoice" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Disabled Doc" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "W-9" }));

    expect(onReclassify).toHaveBeenCalledWith("w9");
  });

  it("disables the selector while a route reclassification is pending", () => {
    render(
      <DocumentClassificationControl
        record={makeRecord()}
        classifications={classifications}
        pending
        onReclassify={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Reclassify document" })).toBeDisabled();
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });
});
