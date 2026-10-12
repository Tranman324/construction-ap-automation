import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  invalidateInvoiceCollections,
  invalidateInvoiceDetail,
  invalidateInvoiceListNavigation,
  markInvoiceListsStale,
} from "@/modules/accounting/modules/invoices/hooks/invalidation";

describe("invoice cache invalidation", () => {
  it("refreshes only one invoice detail for detail-only mutations", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    invalidateInvoiceDetail(queryClient, "invoice-1");

    expect(invalidateQueries).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "invoice-1"] });
  });

  it("marks invoice lists stale without requesting an immediate refetch", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    markInvoiceListsStale(queryClient);

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["invoices"],
      refetchType: "none",
    });
  });

  it("refreshes invoice lists and navigation without unrelated counts", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    invalidateInvoiceListNavigation(queryClient);

    expect(invalidateQueries.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ["invoices"] },
      { queryKey: ["invoice-neighbors"] },
    ]);
  });

  it("refreshes details and all membership-dependent collections", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    invalidateInvoiceCollections(queryClient, ["invoice-1", "invoice-2"]);

    expect(invalidateQueries.mock.calls.map(([filters]) => filters)).toEqual([
      { queryKey: ["invoice", "invoice-1"] },
      { queryKey: ["invoice", "invoice-2"] },
      { queryKey: ["invoices"] },
      { queryKey: ["invoice-neighbors"] },
      { queryKey: ["stats"] },
      { queryKey: ["trash"] },
    ]);
  });
});
