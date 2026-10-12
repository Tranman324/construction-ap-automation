import { describe, it, expect } from "vitest";

import {
  toInvoiceQueryFilters,
  serializeQueueNavParams,
  deserializeQueueNavContext,
} from "@/modules/accounting/modules/invoices/components/dashboard/invoiceDashboardModel";
import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";

// ─── Queue navigation parity tripwire (QA 4.8/4.9 correction) ────────────────
//
// Production defect: the invoice list footer showed "of 144" (pending BUCKET =
// pending+modified) while the detail counter showed "N / 143", and position/next
// were one row off. Root cause class: the LIST request and the detail-panel
// NEIGHBORS request were NOT built from byte-identical filter params — the detail
// page reconstructed the neighbors params with a PARALLEL construction that
// dropped `splitFrom` and normalized empty `search` differently from the list.
//
// Invariant: for ANY queue context, the list request params and the neighbors
// request params must be byte-identical (so the backend — which uses the SAME
// buildInvoiceListFilter for both — returns the same total/order, and
// position/next/prev agree with the rendered rows). This test drives BOTH paths
// through the shared serialize/deserialize boundary and diffs them. It is the
// permanent tripwire against future drift.

// Every param that scopes the COUNT (total) or the ORDER (position/next/prev).
// Pagination (page/limit) is intentionally excluded — the list paginates, the
// neighbors endpoint rejects pagination.
const PARITY_KEYS = ["status", "search", "classification", "panel", "filed", "flagged", "splitFrom", "sort", "sortDir"] as const;

function pick(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(PARITY_KEYS.map((k) => [k, params[k]]));
}

/** The REAL list-query param construction (verbatim from InvoiceQueuePage). */
function listParams(filters: InvoiceFilters, splitFrom: string | undefined) {
  return pick(toInvoiceQueryFilters(filters, splitFrom) as Record<string, unknown>);
}

/** The REAL neighbors param construction: the dashboard serializes the queue
 *  context into the detail URL (openDetail), the detail page deserializes it,
 *  then feeds the SAME toInvoiceQueryFilters. `activeStatus` = filters.status. */
function neighborsParams(filters: InvoiceFilters, splitFrom: string | undefined) {
  const activeStatus = (filters.status ?? "all") as InvoiceFilters["status"];
  const url = new URLSearchParams(serializeQueueNavParams({ ...filters, status: activeStatus }, splitFrom));
  const ctx = deserializeQueueNavContext((key) => url.get(key));
  // effectiveNavStatus for queue navigation equals the URL status (= activeStatus).
  return pick(toInvoiceQueryFilters({ ...ctx.filters, status: activeStatus }, ctx.splitFrom) as Record<string, unknown>);
}

function expectParity(filters: InvoiceFilters, splitFrom: string | undefined) {
  expect(neighborsParams(filters, splitFrom)).toEqual(listParams(filters, splitFrom));
}

describe("queue navigation param parity (list request === neighbors request)", () => {
  it("Pending tab, default sort — status resolves to the pending bucket on BOTH sides", () => {
    const filters: InvoiceFilters = { status: "pending", search: "", page: 1, limit: 25 };
    // Both requests send status='pending' → the backend buckets pending+modified
    // identically for the list and the neighbors, so the one modified doc is
    // counted the same way (no 143-vs-144).
    expect(listParams(filters, undefined).status).toBe("pending");
    expect(neighborsParams(filters, undefined).status).toBe("pending");
    expectParity(filters, undefined);
  });

  it("Pending tab with an active search", () => {
    expectParity({ status: "pending", search: "acme" }, undefined);
  });

  it("split-family view — carries splitFrom (the param that was dropped)", () => {
    expectParity({ status: "all", search: "" }, "doc-1783627296406-0f72");
    expectParity({ status: "pending", search: "" }, "doc-1783627296406-0f72");
  });

  it("Flagged view resolves to flagged=true on both sides", () => {
    expect(listParams({ status: "flagged", search: "" }, undefined).flagged).toBe(true);
    expectParity({ status: "flagged", search: "" }, undefined);
  });

  it("type pill + sort + sortDir", () => {
    expectParity({ status: "approved", panel: "coi", classification: "coi", sort: "vendor", sortDir: "desc", search: "" }, undefined);
  });

  it("empty search is normalized identically (no '' vs undefined drift)", () => {
    expect(listParams({ status: "pending", search: "" }, undefined).search).toBeUndefined();
    expect(neighborsParams({ status: "pending", search: "" }, undefined).search).toBeUndefined();
  });
});
