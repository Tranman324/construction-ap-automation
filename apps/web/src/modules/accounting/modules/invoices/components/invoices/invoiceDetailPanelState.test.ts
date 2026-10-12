import { describe, expect, it } from "vitest";

import {
  getWaiverOverrideState,
  hasAllocationAttention,
  hasMissingWaiverAttention,
} from "@/modules/accounting/modules/invoices/components/invoices/invoiceDetailPanelState";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    classification: "invoice",
    confidence: 0.91,
    file: "invoice.pdf",
    email: {
      from: "accounting@example.com",
      subject: "Invoice",
      receivedAt: "2026-07-01T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-07-01T12:00:00.000Z",
    extracted: null,
    matching: null,
    overallConfidence: 0.91,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    lienWaiverStatus: "missing",
    lienWaiverRequired: true,
    linkedLienWaiverId: null,
    ...overrides,
  };
}

describe("invoice detail panel state", () => {
  it("clears missing-waiver attention when the waiver is marked on the document", () => {
    expect(hasMissingWaiverAttention(makeInvoice())).toBe(true);
    expect(hasMissingWaiverAttention(makeInvoice({ waiverOnDocument: true }))).toBe(false);
    expect(hasMissingWaiverAttention(makeInvoice({ linkedLienWaiverId: "waiver-1" }))).toBe(false);
  });

  it("returns waiver override actor and timestamp metadata", () => {
    expect(getWaiverOverrideState(makeInvoice({
      waiverOnDocument: true,
      waiverOnDocumentAt: "2026-07-03T12:00:00.000Z",
      waiverOnDocumentBy: "Dana Donnelly",
    }))).toEqual({
      active: true,
      at: "2026-07-03T12:00:00.000Z",
      by: "Dana Donnelly",
    });
  });

  it("flags allocation attention only when required values are incomplete", () => {
    expect(hasAllocationAttention(null)).toBe(false);
    expect(hasAllocationAttention({
      routingCode: "D",
      phaseCode: "",
      glAccount: "5450",
      costType: "S",
    })).toBe(true);
    expect(hasAllocationAttention({
      routingCode: "D",
      phaseCode: "15400",
      glAccount: "5450",
      costType: "S",
    })).toBe(false);
  });
});
