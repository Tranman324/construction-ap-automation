import { describe, expect, it } from "vitest";

import { DEFAULT_MAPPINGS } from "@/modules/accounting/modules/invoices/hooks/queries";
import {
  getDocumentSurface,
  getOpensAs,
  getSurface,
  normalizeInvoiceActionPath,
  shouldRenderDocumentPanelRoute,
  usesInvoiceWorkflow,
} from "@/modules/accounting/modules/invoices/lib/documentRouting";
import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";

describe("document routing helpers", () => {
  it("maps opensAs values to stable document surfaces", () => {
    expect(getSurface("invoice")).toBe("invoice_workflow");
    expect(getSurface("receipt")).toBe("document_panel");
    expect(getSurface("other")).toBe("generic_panel");
    expect(getSurface(null)).toBe("generic_panel");
  });

  it("falls unknown classifications back to generic panel behavior", () => {
    expect(getOpensAs("mystery-doc", DEFAULT_MAPPINGS)).toBe("other");
    expect(getDocumentSurface("mystery-doc", DEFAULT_MAPPINGS)).toBe("generic_panel");
    expect(shouldRenderDocumentPanelRoute("mystery-doc", DEFAULT_MAPPINGS)).toBe(true);
  });

  it("keeps default invoice-workflow mappings out of document panel routing", () => {
    expect(usesInvoiceWorkflow("invoice", DEFAULT_MAPPINGS)).toBe(true);
    expect(usesInvoiceWorkflow("pay-application", DEFAULT_MAPPINGS)).toBe(true);
    expect(usesInvoiceWorkflow("purchase-order", DEFAULT_MAPPINGS)).toBe(true);
    expect(usesInvoiceWorkflow("credit-memo", DEFAULT_MAPPINGS)).toBe(true);
    expect(shouldRenderDocumentPanelRoute("pay-application", DEFAULT_MAPPINGS)).toBe(false);
  });

  it("routes warranty classifications to the dedicated warranty panel by default", () => {
    expect(getOpensAs("warranty", DEFAULT_MAPPINGS)).toBe("warranty");
    expect(getDocumentSurface("warranty", DEFAULT_MAPPINGS)).toBe("document_panel");
    expect(shouldRenderDocumentPanelRoute("warranty", DEFAULT_MAPPINGS)).toBe(true);
  });

  it("treats null opensAs the same as other", () => {
    const mappings: ClassificationInfo[] = [
      {
        name: "custom-unassigned",
        label: "Custom Unassigned",
        opensAs: null,
        action: "view-only",
        builtIn: false,
        status: "active",
      },
    ];

    expect(getOpensAs("custom-unassigned", mappings)).toBeNull();
    expect(getDocumentSurface("custom-unassigned", mappings)).toBe("generic_panel");
  });

  it("prefers the served panel.surface and reads it (not a re-derivation)", () => {
    // A classification whose served panel.surface deliberately DIFFERS from what
    // getSurface(opensAs) would derive — proves getDocumentSurface reads the
    // served metadata rather than recomputing it. (This is the sabotage-style
    // guard: change the served surface and routing follows it.)
    const mappings: ClassificationInfo[] = [
      {
        name: "surprise",
        label: "Surprise",
        opensAs: "receipt", // getSurface("receipt") === "document_panel"
        action: "view-only",
        builtIn: true,
        status: "active",
        panel: { surface: "invoice_workflow", filterGroup: "receipt" }, // served surface differs
      },
    ];
    expect(getSurface("receipt")).toBe("document_panel"); // the derivation
    expect(getDocumentSurface("surprise", mappings)).toBe("invoice_workflow"); // reads the served value
    expect(usesInvoiceWorkflow("surprise", mappings)).toBe(true);
  });

  it("routing parity: served panel.surface equals the pre-rewire derivation for every classification", () => {
    // Per-classification parity: for each built-in, the served panel.surface must
    // equal getSurface(opensAs) (the pre-rewire behavior), and getDocumentSurface
    // must return it. A metadata drift for any one classification fails here.
    const withPanel: ClassificationInfo[] = [
      { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active", panel: { surface: "invoice_workflow", filterGroup: "invoice" } },
      { name: "receipt", label: "Receipt", opensAs: "receipt", action: "extract-match", builtIn: true, status: "active", panel: { surface: "document_panel", filterGroup: "receipt" } },
      { name: "statement", label: "Statement", opensAs: "statement", action: "extract-match", builtIn: true, status: "active", panel: { surface: "document_panel", filterGroup: "statement" } },
      { name: "coi", label: "COI", opensAs: "coi", action: "view-only", builtIn: true, status: "active", panel: { surface: "document_panel", filterGroup: "coi" } },
      { name: "w9", label: "W-9", opensAs: "w9", action: "view-only", builtIn: true, status: "active", panel: { surface: "document_panel", filterGroup: "w9" } },
      { name: "lien-waiver", label: "Lien Waiver", opensAs: "lien-waiver", action: "view-only", builtIn: true, status: "active", panel: { surface: "document_panel", filterGroup: "lien-waiver" } },
      { name: "custom-thing", label: "Custom", opensAs: "other", action: "view-only", builtIn: false, status: "active", panel: { surface: "generic_panel", filterGroup: "other" } },
    ];

    for (const c of withPanel) {
      // parity: the served surface equals the pre-rewire derivation
      expect(c.panel?.surface).toBe(getSurface(c.opensAs));
      // routing returns the served surface
      expect(getDocumentSurface(c.name, withPanel)).toBe(c.panel?.surface);
    }
  });

  it("normalizes legacy invoice action paths into accounting routes", () => {
    expect(normalizeInvoiceActionPath("/invoices/splits/doc-1")).toBe("/accounting/invoices/splits/doc-1");
    expect(normalizeInvoiceActionPath("invoices/splits/doc-1")).toBe("/accounting/invoices/splits/doc-1");
    expect(normalizeInvoiceActionPath("/accounting/invoices/splits/doc-1")).toBe("/accounting/invoices/splits/doc-1");
  });
});
