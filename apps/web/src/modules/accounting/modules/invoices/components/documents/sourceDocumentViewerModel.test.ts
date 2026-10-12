import { describe, expect, it } from "vitest";

import {
  buildInlineDocumentSrc,
  clampPage,
  clampZoom,
  getSourceDocumentPageCount,
  getSourceDocumentRenderMode,
  isImageDocument,
  stepZoom,
} from "@/modules/accounting/modules/invoices/components/documents/sourceDocumentViewerModel";

describe("sourceDocumentViewerModel", () => {
  it("derives render modes from classification, probe state, and file type", () => {
    expect(getSourceDocumentRenderMode({
      classification: "invoice",
      fileName: "invoice.pdf",
      available: null,
      contentType: null,
      imageFailed: false,
    })).toBe("loading");

    expect(getSourceDocumentRenderMode({
      classification: "no-attachment",
      fileName: null,
      available: false,
      contentType: null,
      imageFailed: false,
    })).toBe("no-attachment");

    expect(getSourceDocumentRenderMode({
      classification: "image",
      fileName: "photo.jpg",
      available: true,
      contentType: null,
      imageFailed: true,
    })).toBe("image-error");

    expect(getSourceDocumentRenderMode({
      classification: "contract",
      fileName: "contract.docx",
      available: true,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      imageFailed: false,
    })).toBe("download-only");
  });

  it("handles image heuristics, zoom, page, and PDF fragment helpers", () => {
    expect(isImageDocument("img-receipt-1", null)).toBe(true);
    expect(isImageDocument("scan.pdf", "image/png")).toBe(true);
    expect(clampZoom(0.1)).toBe(0.5);
    expect(stepZoom(1, "in")).toBe(1.1);
    expect(stepZoom(0.5, "out")).toBe(0.5);
    expect(getSourceDocumentPageCount({ splitSuggestion: { pageCount: 3.8 } })).toBe(3);
    expect(clampPage(5, 3)).toBe(3);
    expect(buildInlineDocumentSrc("/api/backend/invoices/1/file", 2, true))
      .toBe("/api/backend/invoices/1/file#page=2&view=FitH");
  });
});
