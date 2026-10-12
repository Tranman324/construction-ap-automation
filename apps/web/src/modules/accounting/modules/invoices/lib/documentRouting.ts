import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";

export type DocumentSurface = "invoice_workflow" | "document_panel" | "generic_panel";

export function getSurface(opensAs: string | null): DocumentSurface {
  if (opensAs === "invoice") return "invoice_workflow";
  if (opensAs === "other" || opensAs === null) return "generic_panel";
  return "document_panel";
}

export function getOpensAs(
  classification: string,
  mappings: readonly ClassificationInfo[],
): string | null {
  const mapping = mappings.find((item) => item.name === classification);
  return mapping ? mapping.opensAs : "other";
}

export function getDocumentSurface(
  classification: string,
  mappings: readonly ClassificationInfo[],
): DocumentSurface {
  const mapping = mappings.find((item) => item.name === classification);
  // Prefer the server-provided routing surface (classification `panel.surface`,
  // which equals getSurface(opensAs) by contract). Fall back to deriving it from
  // opensAs — and the Generic fallback for unknown classifications — so behavior
  // is identical when metadata is absent (e.g. DEFAULT_MAPPINGS during load, or
  // fixtures). This keeps documentRouting's decision behavior unchanged while
  // sourcing it from the served metadata when present.
  return mapping?.panel?.surface ?? getSurface(mapping ? mapping.opensAs : "other");
}

export function usesInvoiceWorkflow(
  classification: string,
  mappings: readonly ClassificationInfo[],
): boolean {
  return getDocumentSurface(classification, mappings) === "invoice_workflow";
}

export function shouldRenderDocumentPanelRoute(
  classification: string,
  mappings: readonly ClassificationInfo[],
): boolean {
  return !usesInvoiceWorkflow(classification, mappings);
}

export function normalizeInvoiceActionPath(path: string): string {
  if (path.startsWith("/accounting/")) return path;
  if (path.startsWith("/invoices/")) return `/accounting${path}`;
  if (path.startsWith("invoices/")) return `/accounting/${path}`;
  return path.startsWith("/") ? path : `/${path}`;
}
