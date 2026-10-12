import { describe, expect, it } from "vitest";

import {
  completeW9Progress,
  deriveW9Progress,
  deriveW9VendorCodePreview,
  failW9Progress,
  maskW9Phone,
  maskW9TaxId,
  maskW9Zip,
  retryW9Progress,
  setW9ActiveStep,
  shouldSimulateW9UploadFailure,
  startW9Progress,
  validateW9Identity,
} from "@/modules/accounting/modules/invoices/components/documents/w9DocumentModel";

describe("W-9 document model", () => {
  it("masks tax IDs, phone numbers, and ZIP codes predictably", () => {
    expect(maskW9TaxId("123456789", "ssn")).toBe("123-45-6789");
    expect(maskW9TaxId("1234", "ssn")).toBe("123-4");
    expect(maskW9TaxId("123456789", "feid")).toBe("12-3456789");
    expect(maskW9Phone("4045550100")).toBe("(404) 555-0100");
    expect(maskW9Zip("303361234")).toBe("30336-1234");
  });

  it("derives vendor codes and validation state", () => {
    expect(deriveW9VendorCodePreview("Acme")).toBe("ACME03");

    expect(validateW9Identity({
      vendorName: "Acme",
      vendorType: "material",
      taxClass: "llc-s",
      taxId: "12-3456789",
    })).toEqual({
      valid: true,
      nameOk: true,
      typeOk: true,
      taxClassOk: true,
      taxIdOk: true,
    });

    expect(validateW9Identity({
      vendorName: "",
      vendorType: "material",
      taxClass: "llc-s",
      taxId: "12",
    }).valid).toBe(false);
  });

  it("derives staged progress, error, and retry states", () => {
    expect(deriveW9Progress(startW9Progress()).lines[0].status).toBe("active");

    const tracking = deriveW9Progress(setW9ActiveStep("tracking"));
    expect(tracking.percent).toBe(50);
    expect(tracking.lines.map((line) => line.status)).toEqual(["done", "done", "active", "todo"]);

    const failed = failW9Progress("upload");
    expect(deriveW9Progress(failed).lines.map((line) => line.status)).toEqual(["done", "done", "done", "error"]);
    expect(retryW9Progress(failed)).toEqual({
      phase: "submitting",
      activeStepId: "upload",
      failedStepId: null,
    });

    expect(deriveW9Progress(completeW9Progress()).percent).toBe(100);
    expect(shouldSimulateW9UploadFailure("12-3456787")).toBe(true);
  });
});
