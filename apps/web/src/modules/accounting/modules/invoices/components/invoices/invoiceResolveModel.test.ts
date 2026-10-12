import { describe, expect, it } from "vitest";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import { getInvoiceResolveRows } from "./invoiceResolveModel";

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    classification: "invoice",
    confidence: 1,
    overallConfidence: 1,
    file: "invoice.pdf",
    email: { from: "vendor@example.com", subject: "Invoice", receivedAt: "2026-01-01T00:00:00.000Z" },
    status: "pending",
    queuedAt: "2026-01-01T00:00:00.000Z",
    extracted: null,
    matching: null,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    ...overrides,
  };
}

describe("getInvoiceResolveRows", () => {
  it("adds one actionable recovery row only for the matching invoice", () => {
    const action = { invoiceId: "invoice-1", recovery: { invoiceDateMonth: "2026-07", currentMonth: "2026-08", suggestedInvoiceDate: "2026-08-01" }, disabled: false, onUseSuggestedDate: () => undefined };
    expect(getInvoiceResolveRows(invoice(), action)).toEqual([expect.objectContaining({
      kind: "closed-period", recoveryAction: action, description: expect.stringContaining("2026-07"),
    })]);
    expect(getInvoiceResolveRows(invoice({ id: "invoice-2" }), action)).toEqual([]);
    expect(getInvoiceResolveRows(invoice(), null)).toEqual([]);
  });
  it("uses one row model for duplicate and waiting waiver attention", () => {
    const rows = getInvoiceResolveRows(invoice({
      duplicateOf: "invoice-original",
      lienWaiverRequired: true,
      lienWaiverStatus: "missing",
    }));

    expect(rows).toEqual([
      expect.objectContaining({ kind: "duplicate", id: "duplicate:invoice-1" }),
      expect.objectContaining({ kind: "waiver", id: "waiver:invoice-1", waiting: true }),
    ]);
  });

  it("does not create local rows for a satisfied waiver or non-pending duplicate", () => {
    expect(getInvoiceResolveRows(invoice({
      status: "approved",
      duplicateOf: "invoice-original",
      lienWaiverRequired: true,
      waiverOnDocument: true,
    }))).toEqual([]);

    expect(getInvoiceResolveRows(invoice({
      status: "duplicate",
      duplicateOf: "invoice-original",
      lienWaiverRequired: true,
      lienWaiverStatus: "missing",
    }))).toEqual([]);
  });
});

function liveStatus(state: DuplicateStatusResponse["state"], extra: Partial<DuplicateStatusResponse> = {}): DuplicateStatusResponse {
  return { state, spectrum: null, original: null, bypassed: null, evidence: null, ...extra };
}

describe("getInvoiceResolveRows duplicate membership", () => {
  const kinds = (rows: ReturnType<typeof getInvoiceResolveRows>) => rows.map((row) => row.kind);

  it("falls back to the served flag before the live status loads", () => {
    expect(kinds(getInvoiceResolveRows(invoice({ duplicateOf: "orig" }), null, undefined))).toEqual(["duplicate"]);
    expect(kinds(getInvoiceResolveRows(invoice({ duplicateOf: "orig", duplicateBypassed: true }), null, undefined))).toEqual([]);
    expect(kinds(getInvoiceResolveRows(invoice(), null, undefined))).toEqual([]);
  });

  it("lets the live status win once it loads", () => {
    expect(kinds(getInvoiceResolveRows(invoice({ duplicateOf: "orig" }), null, liveStatus("none")))).toEqual([]);
    expect(kinds(getInvoiceResolveRows(invoice({ duplicateOf: "orig" }), null, liveStatus("stale")))).toEqual(["duplicate"]);
  });

  it("shows a Spectrum-only match with no duplicateOf once status loads", () => {
    const rows = getInvoiceResolveRows(invoice(), null, liveStatus("spectrum"));
    expect(rows).toEqual([expect.objectContaining({ kind: "duplicate", label: "Possible duplicate" })]);
  });

  it("excludes a bypassed match (state none with bypassed set)", () => {
    const status = liveStatus("none", { bypassed: { at: "2026-09-01T00:00:00.000Z", by: "Pat" } });
    expect(kinds(getInvoiceResolveRows(invoice({ duplicateOf: "orig", duplicateBypassed: true }), null, status))).toEqual([]);
  });

  it("never shows a duplicate row for a non-pending invoice, even if live status flags it", () => {
    expect(kinds(getInvoiceResolveRows(invoice({ status: "approved" }), null, liveStatus("spectrum")))).toEqual([]);
  });
});

describe("getInvoiceResolveRows duplicate row copy", () => {
  const duplicateRow = (inv: Invoice, status?: DuplicateStatusResponse | null) =>
    getInvoiceResolveRows(inv, null, status).find((row) => row.kind === "duplicate");
  const original = { id: "o", status: "approved", amount: 100, invoiceNumber: "53477", fileName: null };

  it("labels the row Possible duplicate in every state", () => {
    for (const state of ["spectrum", "toolbox", "stale"] as const) {
      expect(duplicateRow(invoice(), liveStatus(state))).toMatchObject({ kind: "duplicate", label: "Possible duplicate" });
    }
  });

  it("describes the match with the same context the card shows", () => {
    expect(duplicateRow(invoice(), liveStatus("spectrum"))?.description).toBe("already posted in Spectrum");
    expect(duplicateRow(invoice(), liveStatus("toolbox", { original }))?.description).toBe("of 53477 in Toolbox");
    expect(duplicateRow(invoice(), liveStatus("toolbox", { original: { ...original, invoiceNumber: null } }))?.description).toBe("in Toolbox");
    expect(duplicateRow(invoice(), liveStatus("toolbox"))?.description).toBe("in Toolbox");
    expect(duplicateRow(invoice(), liveStatus("stale"))?.description).toBe("the original was discarded");
  });

  it("never prints the duplicateOf id while the status is not loaded", () => {
    const row = duplicateRow(invoice({ duplicateOf: "orig-id-77" }), undefined);
    expect(row?.description).toBe("in Toolbox");
    expect(JSON.stringify(row)).not.toContain("orig-id-77");
  });
});
