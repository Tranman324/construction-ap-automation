import { describe, expect, it } from "vitest";

import {
  getLienWaiverInitialForm,
  getLienWaiverWorkflowSummary,
} from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentState";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeWaiver(): Invoice {
  return {
    id: "waiver-1",
    classification: "lien-waiver",
    confidence: 0.9,
    file: "final-waiver.pdf",
    // Persisted waiver type (the form seeds from this, not from filename/subject).
    waiverType: "Conditional final waiver",
    email: {
      from: "apex@example.com",
      subject: "Final waiver",
      receivedAt: "2026-06-14T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-14T12:00:00.000Z",
    extracted: {
      vendorName: "Apex Concrete",
      vendorAddress: null,
      invoiceNumber: "LW-100",
      invoiceDate: "2026-05-31",
      dueDate: null,
      amount: 2400,
      jobNumber: "24-017",
      projectName: "North Tower",
      description: null,
      lineItems: [],
    },
    matching: {
      vendor: { vendorCode: "V100", vendorName: "Apex Concrete", confidence: 0.95, method: "name" },
      job: { jobNumber: "24-017", confidence: 0.9, method: "subject", jobDescription: "North Tower" },
      subcontract: null,
      sourceInvoiceTotal: null,
    },
    overallConfidence: 0.9,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

describe("lienWaiverDocumentState", () => {
  it("creates initial form state with the provided default destination", () => {
    const form = getLienWaiverInitialForm(makeWaiver(), "02 Financials / Lien Waivers");

    expect(form.destination).toBe("02 Financials / Lien Waivers");
    expect(form.vendorCode).toBe("V100");
    expect(form.jobNumber).toBe("24-017");
    expect(form.amountInput).toBe("2400");
    expect(form.throughDate).toBe("2026-05-31");
    expect(form.savedThroughDate).toBe("2026-05-31");
    expect(form.waiverType).toBe("Conditional final waiver");
    expect(form.savedWaiverType).toBe("Conditional final waiver");
  });

  it("summarizes dirty and held workflow state", () => {
    const form = {
      ...getLienWaiverInitialForm(makeWaiver(), "02 Financials / Lien Waivers"),
      waiverType: "Unconditional final waiver",
      held: true,
    };
    const summary = getLienWaiverWorkflowSummary(form);

    expect(summary.dirty).toBe(true);
    expect(summary.held).toBe(true);
    expect(summary.paired).toBe(false);
    expect(summary.currentSnapshot.waiverType).toBe("Unconditional final waiver");
    expect(summary.savedSnapshot.waiverType).toBe("Conditional final waiver");
  });
});
