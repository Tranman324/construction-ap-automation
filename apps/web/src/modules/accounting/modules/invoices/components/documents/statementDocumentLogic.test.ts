import { describe, expect, it } from "vitest";

import {
  getStatementLinesAfterAdd,
  initStatementDocumentForm,
  parseStatementLinePayload,
} from "@/modules/accounting/modules/invoices/components/documents/statementDocumentLogic";
import type { Invoice, StatementLine } from "@/modules/accounting/modules/invoices/types/invoice";

const statementLines: StatementLine[] = [
  { id: "line-1", invoiceNumber: "INV-100", date: "2026-06-01", amount: 100, status: "matched", source: "extracted" },
  { id: "line-2", invoiceNumber: "INV-101", date: "2026-06-08", amount: 200, status: "not_received", source: "extracted" },
];

function makeStatement(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "statement-logic",
    classification: "statement",
    confidence: 0.81,
    file: "statement-logic.pdf",
    email: { from: "vendor@example.com", subject: "Statement", receivedAt: "2026-06-15T12:00:00.000Z" },
    status: "pending",
    queuedAt: "2026-06-15T12:00:00.000Z",
    extracted: {
      vendorName: null,
      vendorAddress: null,
      vendor: "Document Vendor",
      invoiceNumber: "ST-200",
      invoiceDate: "2026-06-10T12:00:00.000Z",
      dueDate: null,
      amount: 300,
      balance: 300,
      statementPeriod: "June 2026",
      statementLines,
      jobNumber: null,
      projectName: null,
      description: null,
      lineItems: [],
    },
    statementLines,
    matching: {
      vendor: { vendorCode: "V100", vendorName: "Matched Vendor", confidence: 0.92, method: "document" },
      job: null,
      subcontract: null,
      sourceInvoiceTotal: null,
    },
    overallConfidence: 0.81,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    statementAttributes: {
      statementPeriod: { value: "June 2026", source: "extracted" },
      balance: { value: 300, source: "computed" },
    },
    ...overrides,
  };
}

describe("statement document logic", () => {
  it("initializes statement form state from canonical resolved attributes", () => {
    const form = initStatementDocumentForm(makeStatement());

    expect(form.vendorCode).toBe("V100");
    expect(form.statementPeriod).toBe("June 2026");
    expect(form.statementBalance).toBe("300.00");
    expect(form.lines).toHaveLength(2);
    expect(form.lines[1]).toMatchObject({ invoiceNumber: "INV-101", matchState: "not_received", source: "extracted" });
  });

  it("resumes persisted line resolutions after reopening a statement", () => {
    const persisted = statementLines.map((line) => line.id === "line-2" ? {
      ...line,
      resolvedAt: "2026-07-15T12:00:00.000Z",
      resolutionType: "accept_line" as const,
      resolvedBy: "worker@example.com",
    } : line);
    const form = initStatementDocumentForm(makeStatement({ statementLines: persisted }));
    expect(form.lines[1]).toMatchObject({
      id: "line-2",
      resolved: true,
      resolutionType: "accept_line",
      resolvedBy: "worker@example.com",
    });
  });

  it("does not derive display values when the canonical attribute envelope is absent", () => {
    const form = initStatementDocumentForm(makeStatement({ statementAttributes: undefined }));

    expect(form.statementPeriod).toBe("");
    expect(form.statementBalance).toBe("");
  });

  it("normalizes add-line payloads and trusts the canonical response", () => {
    const form = {
      ...initStatementDocumentForm(makeStatement()),
      newLineInvoiceNumber: " INV-200 ",
      newLineDate: "2026-06-30",
      newLineAmount: "$1,200.50",
    };

    const parsed = parseStatementLinePayload(form);
    expect(parsed).toEqual({
      payload: { invoiceNumber: "INV-200", date: "2026-06-30", amount: 1200.5 },
      error: null,
    });

    if (!parsed.payload) throw new Error("Expected a valid statement line payload.");
    const addedLine: StatementLine & { source: "manual" } = { id: "manual-INV-200", invoiceNumber: "INV-200", date: "2026-06-30", amount: 1200.5, status: "not_received", source: "manual" };
    const nextLines = getStatementLinesAfterAdd({
      invoice: makeStatement({ statementLines: [...statementLines, addedLine] }),
      statementLines: [...statementLines, addedLine],
      addedLine,
    });
    expect(nextLines.at(-1)).toMatchObject({
      id: "manual-INV-200",
      invoiceNumber: "INV-200",
      statementAmount: 1200.5,
      matchState: "not_received",
      source: "manual",
    });
  });

  it("returns validation errors without creating local resolution state", () => {
    const form = initStatementDocumentForm(makeStatement());

    expect(parseStatementLinePayload(form).error).toBe("Invoice number is required.");
    expect(parseStatementLinePayload({ ...form, newLineInvoiceNumber: "INV-300", newLineAmount: "0" }).error)
      .toBe("Enter a positive amount.");
  });
});
