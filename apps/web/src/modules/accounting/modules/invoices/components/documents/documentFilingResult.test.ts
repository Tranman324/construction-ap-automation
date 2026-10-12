import { describe, expect, it, vi, beforeEach } from "vitest";

const toasterMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: toasterMocks,
}));

import { showFileToProjectResultToast } from "@/modules/accounting/modules/invoices/components/documents/documentFilingResult";

describe("showFileToProjectResultToast", () => {
  beforeEach(() => {
    toasterMocks.success.mockReset();
    toasterMocks.error.mockReset();
    toasterMocks.warning.mockReset();
  });

  it("shows success for a completed SharePoint upload", () => {
    const uploaded = showFileToProjectResultToast({
      invoice: {} as never,
      sharePoint: { uploaded: true, webUrl: "https://sharepoint.example/doc.pdf" },
    }, "doc.pdf filed to Project.");

    expect(uploaded).toBe(true);
    expect(toasterMocks.success).toHaveBeenCalledWith("File to Project", {
      description: "doc.pdf filed to Project.",
    });
    expect(toasterMocks.error).not.toHaveBeenCalled();
  });

  it("says a document remains unfiled when SharePoint upload fails before filing", () => {
    const uploaded = showFileToProjectResultToast({
      invoice: { filed: false } as never,
      sharePoint: { uploaded: false, error: "Document has no matched job number" },
    }, "doc.pdf filed to Project.");

    expect(uploaded).toBe(false);
    expect(toasterMocks.error).toHaveBeenCalledWith("File to Project failed", {
      description: "SharePoint upload failed. Document remains unfiled. Document has no matched job number",
    });
    expect(toasterMocks.success).not.toHaveBeenCalled();
  });

  it("says an existing Documents filing is unchanged when its SharePoint retry fails", () => {
    const uploaded = showFileToProjectResultToast({
      invoice: { filed: true } as never,
      sharePoint: { uploaded: false, error: "The selected folder is unavailable" },
    }, "doc.pdf filed to Project.");

    expect(uploaded).toBe(false);
    expect(toasterMocks.error).toHaveBeenCalledWith("File to Project failed", {
      description: "SharePoint upload failed. Existing Documents filing is unchanged. The selected folder is unavailable",
    });
    expect(toasterMocks.success).not.toHaveBeenCalled();
  });

  it("shows a warning when SharePoint upload succeeds with metadata warnings", () => {
    const uploaded = showFileToProjectResultToast({
      invoice: {} as never,
      sharePoint: { uploaded: true, warning: "Column update skipped" },
    }, "doc.pdf filed to Project.");

    expect(uploaded).toBe(true);
    expect(toasterMocks.warning).toHaveBeenCalledWith("File to Project warning", {
      description: "doc.pdf filed to Project. Metadata warning: Column update skipped",
    });
    expect(toasterMocks.success).not.toHaveBeenCalled();
  });
});
