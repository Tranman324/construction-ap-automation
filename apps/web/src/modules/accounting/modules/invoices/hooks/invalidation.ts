import type { QueryClient } from "@tanstack/react-query";

const COLLECTION_QUERY_KEYS = ["invoices", "invoice-neighbors", "stats", "trash"] as const;

export function invalidateInvoiceDetail(queryClient: QueryClient, id: string) {
  void queryClient.invalidateQueries({ queryKey: ["invoice", id] });
}

export function markInvoiceListsStale(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["invoices"], refetchType: "none" });
}

/** Marks every invoice collection cache stale without triggering a refetch. */
export function markInvoiceCollectionsStale(queryClient: QueryClient) {
  COLLECTION_QUERY_KEYS.forEach((key) => {
    void queryClient.invalidateQueries({ queryKey: [key], refetchType: "none" });
  });
}

export function invalidateInvoiceListNavigation(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["invoices"] });
  void queryClient.invalidateQueries({ queryKey: ["invoice-neighbors"] });
}

export function invalidateInvoiceCollections(
  queryClient: QueryClient,
  ids: string | string[] = [],
) {
  const detailIds = Array.isArray(ids) ? ids : [ids];
  detailIds.forEach((id) => invalidateInvoiceDetail(queryClient, id));
  COLLECTION_QUERY_KEYS.forEach((key) => {
    void queryClient.invalidateQueries({ queryKey: [key] });
  });
}
