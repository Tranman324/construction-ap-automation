import { describe, expect, it } from "vitest";

import {
  buildGlobalApprovedQueueSubmitMode,
  buildSelectedSpectrumSubmitMode,
} from "@/modules/accounting/modules/invoices/components/dashboard/invoiceQueueSubmitModel";
import type { DashboardStats } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeInvoice(id: string, overrides: Partial<Invoice> = {}): Invoice {
  return {
    id,
    classification: "invoice",
    confidence: 0.9,
    file: `${id}.pdf`,
    email: { from: "vendor@example.com", subject: "Invoice", receivedAt: "2026-01-01T00:00:00Z" },
    status: "approved",
    queuedAt: "2026-01-01T00:00:00Z",
    extracted: {
      vendorName: "Extracted Vendor",
      vendorAddress: null,
      invoiceNumber: id,
      invoiceDate: null,
      dueDate: null,
      amount: 100,
      jobNumber: "25-401",
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: {
      vendor: { vendorCode: "V001", vendorName: "Matched Vendor", confidence: 0.9, method: "test" },
      job: { jobNumber: "25-799", confidence: 0.9, method: "test" },
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
    ...overrides,
  };
}

describe("invoiceQueueSubmitModel", () => {
  it("builds selected mode from approved invoice workflow documents only", () => {
    const result = buildSelectedSpectrumSubmitMode(
      [
        makeInvoice("eligible"),
        makeInvoice("pending", { status: "pending" }),
        makeInvoice("coi", { classification: "coi" }),
        makeInvoice("pay-app", { classification: "pay-application" }),
        makeInvoice("po", { classification: "purchase-order" }),
        makeInvoice("credit", { classification: "credit-memo" }),
      ],
      6,
    );

    expect(result.skippedCount).toBe(4);
    expect(result.mode).toEqual({
      kind: "selected",
      invoices: [
        {
          id: "eligible",
          vendorName: "Extracted Vendor",
          invoiceNumber: "eligible",
          amount: 100,
          jobNumber: "25-401",
          lienWaiverStatus: null,
          lienWaiverRequired: false,
          linkedLienWaiverId: null,
          waiverOnDocument: false,
        },
        {
          id: "pay-app",
          vendorName: "Extracted Vendor",
          invoiceNumber: "pay-app",
          amount: 100,
          jobNumber: "25-401",
          lienWaiverStatus: null,
          lienWaiverRequired: false,
          linkedLienWaiverId: null,
          waiverOnDocument: false,
        },
      ],
    });
  });

  it("falls back to matching vendor and job data for selected candidates", () => {
    const result = buildSelectedSpectrumSubmitMode(
      [
        makeInvoice("fallback", {
          extracted: {
            vendorName: " ",
            vendorAddress: null,
            invoiceNumber: null,
            invoiceDate: null,
            dueDate: null,
            amount: null,
            jobNumber: "",
            projectName: null,
            description: null,
            lineItems: [],
          },
        }),
      ],
      1,
    );

    expect(result.mode?.invoices[0]).toMatchObject({
      vendorName: "Matched Vendor",
      invoiceNumber: null,
      amount: null,
      jobNumber: "25-799",
      lienWaiverRequired: false,
    });
  });

  it("builds the global approved queue descriptor from stats", () => {
    const stats = {
      approved: 4,
      amounts: { approved: 1200 },
    } as DashboardStats;

    expect(buildGlobalApprovedQueueSubmitMode(stats)).toEqual({
      kind: "global-approved-queue",
      invoiceCount: 4,
      totalAmount: 1200,
      jobsAffected: null,
    });
  });
});
