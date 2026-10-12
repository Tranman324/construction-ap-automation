import { describe, expect, it, vi } from "vitest";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

const TM = vi.hoisted(() => ({
  emitAuditEvent: vi.fn(),
}));

vi.mock("@/modules/shared/lib/auditEmitter", () => ({
  emitAuditEvent: TM.emitAuditEvent,
}));

import { emitInvoiceAuditEvent, getInvoiceLabel } from "@/modules/accounting/modules/invoices/lib/auditEvents";

function makeInvoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: "inv-1",
    classification: "invoice",
    confidence: 0.9,
    file: "fallback.pdf",
    email: {
      from: "vendor@example.com",
      subject: "Invoice",
      receivedAt: "2026-05-14T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-05-14T12:00:00.000Z",
    extracted: null,
    matching: null,
    overallConfidence: 0.9,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    ...overrides,
  };
}

describe("invoice audit event helpers", () => {
  it("prefers vendor labels before file and id fallbacks", () => {
    expect(getInvoiceLabel(makeInvoice({
      extracted: {
        vendorName: "Acme",
        vendorAddress: null,
        invoiceNumber: null,
        invoiceDate: null,
        dueDate: null,
        amount: null,
        jobNumber: null,
        projectName: null,
        description: null,
        lineItems: [],
      },
    }), "inv-1")).toBe("Acme");
    expect(getInvoiceLabel(makeInvoice({ file: "invoice.pdf" }), "inv-1")).toBe("invoice.pdf");
  });

  it("emits catalog-backed invoice audit payloads", () => {
    TM.emitAuditEvent.mockReset();

    emitInvoiceAuditEvent(
      { userId: "user-1", name: "Alex", email: "alex@example.com", role: "admin" },
      "invoice.deleted",
      "inv-1",
      "Deleted invoice inv-1",
      "Invoice 1",
    );

    expect(TM.emitAuditEvent).toHaveBeenCalledWith({
      type: "invoice.deleted",
      actor: { userId: "user-1", name: "Alex", role: "admin" },
      target: { type: "invoice", id: "inv-1", label: "Invoice 1" },
      summary: "Deleted invoice inv-1",
      module: "invoices",
      severity: "warning",
    });
  });
});
