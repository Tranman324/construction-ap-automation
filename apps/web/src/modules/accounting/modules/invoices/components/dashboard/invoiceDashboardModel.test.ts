import { describe, expect, it } from "vitest";

import {
  applyDashboardFilters,
  buildInvoiceDashboardTabs,
  deriveOpenApBalance,
  getDashboardTabCount,
  toInvoiceQueryFilters,
} from "@/modules/accounting/modules/invoices/components/dashboard/invoiceDashboardModel";
import type { DashboardStats, InvoiceListResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeStats(): DashboardStats {
  return {
    total: 12,
    activeTotal: 12,
    trashTotal: 2,
    shelfTotal: 5,
    globalTotal: 19,
    pending: 4,
    approved: 3,
    rejected: 0,
    submitted: 5,
    discarded: 0,
    duplicate: 0,
    reviewed: 0,
    errors: 2,
    skipped: 0,
    todayProcessed: 6,
    avgConfidence: 0.86,
    missingLienWaivers: 1,
    flaggedCount: 3,
    amounts: { pending: 2500, approved: 5000, submitted: 12000, total: 19500 },
  };
}

function makeInvoice(id: string, overrides: Partial<Invoice> = {}): Invoice {
  return {
    id,
    classification: "invoice",
    confidence: 0.9,
    file: `${id}.pdf`,
    email: { from: "billing@example.com", subject: "Invoice", receivedAt: "2026-06-01T00:00:00Z" },
    status: "pending",
    queuedAt: "2026-06-01T00:00:00Z",
    extracted: {
      vendorName: "Vendor",
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
    matching: null,
    overallConfidence: 0.95,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    ...overrides,
  };
}

function makeResponse(invoices: Invoice[]): InvoiceListResponse {
  return { invoices, total: invoices.length, page: 1, limit: 25, pages: 1 };
}

describe("invoiceDashboardModel", () => {
  it("derives dashboard metric values from existing stats fields", () => {
    const stats = makeStats();

    expect(deriveOpenApBalance(stats)).toBe(7500);
    expect(buildInvoiceDashboardTabs(stats)).toEqual([
      expect.objectContaining({ value: "pending", count: 4 }),
      expect.objectContaining({ value: "approved", count: 3 }),
      expect.objectContaining({ value: "submitted", count: 5 }),
      expect.objectContaining({ value: "all", count: 12 }),
      expect.objectContaining({ value: "documents", count: 5 }),
    ]);
    // "Flagged" is no longer a status tab (it moved to the type-filter row), so
    // buildInvoiceDashboardTabs must NOT emit it...
    expect(buildInvoiceDashboardTabs(stats).map((tab) => tab.value)).not.toContain("flagged");
    expect(getDashboardTabCount(stats, "discarded")).toBe(2);
    expect(getDashboardTabCount(stats, "documents")).toBe(5);
    // ...but the flagged count mapping stays — it feeds the "Flagged (N)" pill.
    expect(getDashboardTabCount(stats, "flagged")).toBe(3);
  });

  it("uses active total for the All tab count while preserving the all status value", () => {
    const stats = {
      ...makeStats(),
      total: 15,
      activeTotal: 12,
      discarded: 2,
      duplicate: 1,
    };

    const tabs = buildInvoiceDashboardTabs(stats);

    expect(tabs).toContainEqual(expect.objectContaining({ value: "all", label: "All", count: 12 }));
    expect(tabs.find((tab) => tab.value === "all")?.count).not.toBe(stats.total);
    expect(toInvoiceQueryFilters({ status: "all" }, undefined)).toMatchObject({
      status: "all",
      filed: false,
    });
  });

  it("falls back to active bucket sum when activeTotal is missing from a stale stats response", () => {
    const stats: DashboardStats = {
      ...makeStats(),
      activeTotal: undefined,
      pending: 7,
      approved: 2,
      submitted: 4,
    };

    const tabs = buildInvoiceDashboardTabs(stats);

    expect(tabs).toContainEqual(expect.objectContaining({ value: "all", count: 13 }));
  });

  it("omits client-only filters from ordinary invoice API params", () => {
    const filters = toInvoiceQueryFilters(
      { status: "pending", panel: "receipt", job: "25-401" },
      undefined,
    );

    expect(filters).toMatchObject({ status: "pending", panel: "receipt", filed: false });
    expect(filters).not.toHaveProperty("job");
  });

  it("uses global scope for text search and pauses existing dashboard filters", () => {
    const filters = toInvoiceQueryFilters(
      { status: "pending", panel: "receipt", classification: "receipt", job: "25-401", flagged: true, search: " acme " },
      "parent-1",
    );

    expect(filters).toEqual({ search: "acme", page: undefined, limit: undefined, sort: undefined, sortDir: undefined, scope: "global" });
  });

  it("composes the Flagged pill with the active status and panel on the server", () => {
    const filters = toInvoiceQueryFilters({ status: "pending", flagged: true, panel: "invoice" }, undefined);
    expect(filters).toMatchObject({ status: "pending", flagged: true, panel: "invoice", filed: false });
  });

  it("does not send the flagged param unless the Flagged control is active", () => {
    expect(toInvoiceQueryFilters({ status: "pending" }, undefined).flagged).toBeUndefined();
    expect(toInvoiceQueryFilters({ status: "all" }, undefined).flagged).toBeUndefined();
    expect(toInvoiceQueryFilters({ status: "documents" }, undefined).flagged).toBeUndefined();
  });

  it("never sends the dashboard-only Documents status to the active invoice API", () => {
    expect(toInvoiceQueryFilters({ status: "documents" }, undefined)).toMatchObject({
      status: undefined,
      filed: false,
    });
  });

  it("applies client-only dashboard filters to returned invoices", () => {
    const invoice = makeInvoice("inv-1");
    const other = makeInvoice("inv-2", {
      extracted: { ...makeInvoice("inv-2").extracted!, jobNumber: "25-402" },
    });

    const result = applyDashboardFilters(makeResponse([invoice, other]), {
      job: "25-401",
    });

    expect(result?.invoices).toEqual([invoice]);
    expect(result?.total).toBe(1);
    expect(result?.pages).toBe(1);
  });

  it("does not client-filter a global search response", () => {
    const invoice = makeInvoice("inv-1");
    const other = makeInvoice("inv-2", {
      extracted: { ...makeInvoice("inv-2").extracted!, jobNumber: "25-402" },
    });

    const result = applyDashboardFilters(makeResponse([invoice, other]), { job: "25-401", scope: "global" });

    expect(result?.invoices).toEqual([invoice, other]);
    expect(result?.total).toBe(2);
  });

  it("keeps tab counts sourced from global stats while client filters narrow rows", () => {
    const stats = makeStats();
    const invoice = makeInvoice("inv-1");
    const other = makeInvoice("inv-2", {
      extracted: { ...makeInvoice("inv-2").extracted!, jobNumber: "25-402" },
    });

    const tabs = buildInvoiceDashboardTabs(stats);
    const filtered = applyDashboardFilters(makeResponse([invoice, other]), {
      job: "25-401",
    });

    expect(tabs.find((tab) => tab.value === "pending")?.count).toBe(4);
    expect(filtered?.invoices).toEqual([invoice]);
  });
});
