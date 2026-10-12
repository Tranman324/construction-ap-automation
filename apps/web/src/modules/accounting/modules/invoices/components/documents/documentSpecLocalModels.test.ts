import { describe, expect, it } from "vitest";

import {
  formatDocumentMoney,
  getReceiptLastFour,
  getInitialStatementLines,
  getStatementStats,
} from "@/modules/accounting/modules/invoices/components/documents/documentSpecLocalModels";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeRecord(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "doc-1234",
    classification: "statement",
    confidence: 0.72,
    file: "statement.pdf",
    email: {
      from: "vendor@example.com",
      subject: "June statement",
      receivedAt: "2026-06-15T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-15T12:00:00.000Z",
    extracted: {
      vendorName: "Acme Supply",
      vendorAddress: null,
      invoiceNumber: "ST-100",
      invoiceDate: "2026-06-10T12:00:00.000Z",
      dueDate: null,
      amount: 1000,
      jobNumber: null,
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: null,
    overallConfidence: 0.72,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    ...overrides,
  };
}

describe("documentSpecLocalModels", () => {
  it("formats money without fabricating receipt card identity", () => {
    expect(formatDocumentMoney(128.4)).toBe("$128.40");
    expect(formatDocumentMoney(2529.7599999999998)).toBe("$2,529.76");
    expect(formatDocumentMoney(null)).toBe("-");
    expect(getReceiptLastFour()).toBeNull();
  });

  it("does not fabricate statement lines when extraction is empty", () => {
    const lines = getInitialStatementLines(makeRecord());
    expect(lines).toEqual([]);
    expect(getStatementStats(lines)).toMatchObject({ total: 0, balance: 0 });
  });

  it("sums statement line balances in cents", () => {
    const lines = getInitialStatementLines(makeRecord({
      extracted: {
        ...makeRecord().extracted!,
        amount: null,
        balance: null,
        statementLines: [
          { id: "line-1", invoiceNumber: "INV-1", date: "2026-06-01", amount: 2261.81, status: "matched", source: "extracted" },
          { id: "line-2", invoiceNumber: "INV-2", date: "2026-06-02", amount: 267.95, status: "matched", source: "extracted" },
        ],
      },
    }));

    expect(getStatementStats(lines).balance).toBe(2529.76);
  });
});
