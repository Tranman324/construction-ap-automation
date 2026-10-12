export type CollaborationRouteFamily = "invoice" | "document";

export function collaborationApiBase(routeFamily: CollaborationRouteFamily = "invoice"): string {
  return routeFamily === "document" ? "/api/documents" : "/api/invoices";
}

export function collaborationQueryKey(routeFamily: CollaborationRouteFamily, id: string, offset: number) {
  return ["activity", routeFamily, id, offset] as const;
}
