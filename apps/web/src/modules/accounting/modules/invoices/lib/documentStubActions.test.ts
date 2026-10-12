import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  notifyDocumentStubAction,
  runDocumentStubAction,
  runDocumentStubActionWithToast,
} from "@/modules/accounting/modules/invoices/lib/documentStubActions";
import { toast } from "@/modules/shared/components/ui/toaster";

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("documentStubActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns deterministic success results without network calls", async () => {
    await expect(
      runDocumentStubAction({
        id: "file",
        label: "File to Project",
        successMessage: "Saved locally.",
      }),
    ).resolves.toEqual({
      actionId: "file",
      label: "File to Project",
      status: "success",
      message: "Saved locally.",
    });
  });

  it("throws a typed error for deterministic failure paths", async () => {
    await expect(
      runDocumentStubAction({
        id: "review",
        label: "Retry Upload",
        fail: true,
        errorMessage: "Upload failed.",
      }),
    ).rejects.toMatchObject({
      name: "DocumentStubActionError",
      result: {
        actionId: "review",
        status: "error",
        message: "Upload failed.",
      },
    });
  });

  it("emits Sonner feedback for success and error wrapper results", async () => {
    const result = await runDocumentStubActionWithToast({
      id: "file",
      label: "File document",
    });
    notifyDocumentStubAction({ ...result, status: "error", message: "No folder selected." });

    expect(toast.success).toHaveBeenCalledWith("File document", {
      description: "File document completed.",
    });
    expect(toast.error).toHaveBeenCalledWith("File document", {
      description: "No folder selected.",
    });
  });
});
