import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Action, ResolveCardModel } from "../documents/resolveCardModel";
import { buildDuplicateCardModel, type DuplicateCardInput } from "./duplicateCardModel";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

/** Server evaluations for the four duplicate shapes; literals from the content spec fixtures table. */
export const F_SPEC: DuplicateStatusResponse = {
  state: "spectrum",
  evidence: { invoiceNumber: "25-907", normalizedInvoiceNumber: "25907", vendorCode: "ZCON92", amount: 9642, duplicateOf: null, originalDiscardedAt: null },
  spectrum: { source: "OPEN_ITEMS", invoiceNumber: "25-907", vendorCode: "ZCON92", amount: 9642 },
  original: null,
  bypassed: null,
};

export const F_SUB: DuplicateStatusResponse = {
  state: "spectrum",
  evidence: { invoiceNumber: "53477", normalizedInvoiceNumber: "53477", vendorCode: "VANT01", amount: 74877, duplicateOf: "orig-9", originalDiscardedAt: null },
  spectrum: null,
  original: { id: "orig-9", status: "submitted", amount: 74877, invoiceNumber: "53477", fileName: "VANT01_53477.pdf" },
  bypassed: null,
};

export const F_TBX: DuplicateStatusResponse = {
  state: "toolbox",
  evidence: { invoiceNumber: "53-477", normalizedInvoiceNumber: "53477", vendorCode: "VANT01", amount: 74877, duplicateOf: "orig-1", originalDiscardedAt: null },
  spectrum: null,
  original: { id: "orig-1", status: "approved", amount: 74787, invoiceNumber: "53477", fileName: "VANT01_53477.pdf" },
  bypassed: null,
};

export const F_STALE: DuplicateStatusResponse = {
  state: "stale",
  evidence: { invoiceNumber: "53477", normalizedInvoiceNumber: "53477", vendorCode: "VANT01", amount: 74877, duplicateOf: "orig-1", originalDiscardedAt: "2026-09-14T16:12:00.000Z" },
  spectrum: null,
  original: null,
  bypassed: null,
};

export const DEL = "accounting.invoices.delete";
export const APPR = "accounting.invoices.approve";

export function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "copy-2", classification: "invoice", confidence: 0.9, overallConfidence: 0.9, file: "copy-2.pdf",
    email: { from: "ap@example.com", subject: "Invoice 123", receivedAt: "2026-08-10T00:00:00.000Z" },
    status: "pending", queuedAt: "2026-08-10T00:00:00.000Z", extracted: null, matching: null, splitFrom: null,
    duplicateOf: "orig-1", reason: null, error: null, reclassifiedFrom: null, reclassifiedAt: null,
    ...overrides,
  };
}

export function build(invoice = makeInvoice(), status?: DuplicateStatusResponse | null, flags: Partial<DuplicateCardInput> = {}) {
  return buildDuplicateCardModel({ invoice, status, discardPending: false, bypassPending: false, ...flags });
}
export function built(status: DuplicateStatusResponse | null | undefined, flags: Partial<DuplicateCardInput> = {}): ResolveCardModel {
  const model = build(makeInvoice(), status, flags);
  if (!model) throw new Error("expected a model");
  return model;
}
export const ids = (model: ResolveCardModel) => (model.actions ?? []).map((a) => a.id);
export const action = (model: ResolveCardModel, id: string): Action => {
  const found = (model.actions ?? []).find((a) => a.id === id);
  if (!found) throw new Error(`no action ${id}`);
  return found;
};
export function amountRow(model: ResolveCardModel) {
  const rows = model.evidence?.layout === "compare" ? model.evidence.rows : [];
  return rows.find((r) => r.label === "Amount");
}
