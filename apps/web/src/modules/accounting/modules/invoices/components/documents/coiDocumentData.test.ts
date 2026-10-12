import { describe, expect, it } from "vitest";

import { formatCoiLimit, getCoiDisplayData, getCoiFormSeeds } from "@/modules/accounting/modules/invoices/components/documents/coiDocumentData";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeRecord(): Invoice {
  return { id: "coi-100", classification: "coi", confidence: 0.72, file: "coi.pdf", email: { from: "broker@example.com", subject: "COI", receivedAt: "2026-06-15T12:00:00.000Z" }, status: "pending", queuedAt: "2026-06-15T12:00:00.000Z", extracted: { vendorName: "Ridge Steel", vendorAddress: null, invoiceNumber: null, invoiceDate: "2026-06-10", dueDate: "2027-06-10", amount: null, jobNumber: null, projectName: null, description: null, lineItems: [] }, matching: { vendor: { vendorCode: "RS100", vendorName: "Ridge Steel", confidence: 0.98, method: "name" }, job: null, subcontract: null, sourceInvoiceTotal: null }, overallConfidence: 0.72, splitFrom: null, duplicateOf: null, reason: null, error: null, reclassifiedFrom: null, reclassifiedAt: null, coiData: { coverageLines: [{ type: "general-liability", carrier: "Travelers", policyNumber: "GL-1", expirationDate: "2027-06-30", limits: { eachOccurrence: 1000000 } }] } };
}

describe("COI document display data", () => {
  it("preserves raw form/display fields without compliance derivation", () => {
    const record = makeRecord();
    expect(getCoiFormSeeds(record)).toEqual({ vendorCode: "RS100", expirationDate: "2027-06-10" });
    expect(getCoiDisplayData(record).coverageLines[0]).toMatchObject({ label: "General liability", carrier: "Travelers" });
    expect(formatCoiLimit(1000000)).toBe("$1,000,000.00");
  });
});
