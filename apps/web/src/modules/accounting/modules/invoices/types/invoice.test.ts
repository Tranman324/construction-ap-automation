import { describe, expect, it } from "vitest";

import { getFilingStatus, type Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
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

describe("getFilingStatus", () => {
  it("distinguishes unfiled, shelved, and SharePoint-filed documents", () => {
    expect(getFilingStatus(makeInvoice({ filed: false }))).toBe("unfiled");
    expect(getFilingStatus(makeInvoice({ filed: true, spFileUrl: null }))).toBe("shelved");
    expect(getFilingStatus(makeInvoice({ filed: true, spFileUrl: "https://sharepoint/file.pdf" }))).toBe("sp-filed");
  });
});
