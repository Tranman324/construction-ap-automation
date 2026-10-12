import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  SpectrumSubmitResolveNotice,
  getSpectrumSubmitResolveCopy,
  getSpectrumSubmitResolveIssue,
} from "@/modules/accounting/modules/invoices/components/invoices/SpectrumSubmitResolveNotice";
import type { SpectrumSubmitFailureWorkflowSnapshot } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitFailureWorkflowModel";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    classification: "invoice",
    confidence: 0.9,
    overallConfidence: 0.9,
    file: "invoice.pdf",
    email: {
      from: "vendor@example.com",
      subject: "Invoice",
      receivedAt: "2026-07-07T12:00:00.000Z",
    },
    status: "approved",
    queuedAt: "2026-07-07T12:00:00.000Z",
    extracted: {
      vendorName: "Vendor",
      vendorAddress: null,
      invoiceNumber: "INV-001",
      invoiceDate: "2026-07-01",
      dueDate: null,
      amount: 100,
      jobNumber: "26-401",
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: {
      vendor: null,
      job: null,
      subcontract: null,
      sourceInvoiceTotal: null,
    },
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    ...overrides,
  };
}

function makeSnapshot(issue: string): SpectrumSubmitFailureWorkflowSnapshot {
  return {
    activeInvoiceId: "invoice-1",
    results: {
      phase: "results",
      candidates: [],
      rows: [
        {
          invoiceId: "invoice-1",
          invoiceNumber: "INV-001",
          vendorName: "Vendor",
          amount: 100,
          submitted: false,
          resolved: false,
          discarded: false,
          issue,
        },
      ],
      submittedCount: 0,
      failedCount: 1,
    },
  };
}

describe("SpectrumSubmitResolveNotice", () => {
  it("maps known Spectrum issues to actionable guidance", () => {
    expect(getSpectrumSubmitResolveCopy("Cost type does not match distribution G/L account").guidance)
      .toBe("Update the GL Account in the Allocation tab to match the cost type.");
    expect(getSpectrumSubmitResolveCopy("G/L date is outside of min/max range for A/P").guidance)
      .toBe("Update the Invoice Date in the Details tab; Toolbox uses it as the GL date.");
    expect(getSpectrumSubmitResolveCopy("Invoice number exists in posted invoices").guidance)
      .toBe("This invoice number already exists in Spectrum. Verify it is not a duplicate before resubmitting.");
  });

  it("prefers the workflow row issue over the invoice fallback issue", () => {
    const issue = getSpectrumSubmitResolveIssue(
      makeInvoice({ lastSpectrumError: "Invoice fallback issue" }),
      makeSnapshot("Workflow issue"),
    );

    expect(issue).toBe("Workflow issue");
  });

  it("renders the issue and guidance", () => {
    render(<SpectrumSubmitResolveNotice issue="Cost type does not match distribution G/L account" />);

    expect(screen.getByText("Spectrum rejected this invoice")).toBeInTheDocument();
    expect(screen.getByText("Cost type does not match distribution G/L account")).toBeInTheDocument();
    expect(screen.getByText("Update the GL Account in the Allocation tab to match the cost type.")).toBeInTheDocument();
  });
});
