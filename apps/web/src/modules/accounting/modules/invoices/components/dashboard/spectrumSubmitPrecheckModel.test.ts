import { describe, expect, it } from "vitest";

import { deriveSpectrumSubmitPrechecks } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitPrecheckModel";
import type { SpectrumSubmitCandidate } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";

function makeCandidate(
  id: string,
  overrides: Partial<SpectrumSubmitCandidate> = {},
): SpectrumSubmitCandidate {
  return {
    id,
    vendorName: "Acme Concrete",
    invoiceNumber: id,
    amount: 100,
    jobNumber: "24-001",
    lienWaiverStatus: "attached",
    lienWaiverRequired: false,
    linkedLienWaiverId: "waiver-1",
    ...overrides,
  };
}

describe("spectrumSubmitPrecheckModel", () => {
  it("derives the allowed warning families from loaded candidates", () => {
    const precheck = deriveSpectrumSubmitPrechecks([
      makeCandidate("waiver", {
        lienWaiverRequired: true,
        lienWaiverStatus: "missing",
        linkedLienWaiverId: null,
      }),
      makeCandidate("job", { jobNumber: null }),
      makeCandidate("vendor", { vendorName: null }),
      makeCandidate("amount", { amount: Number.NaN }),
      makeCandidate("clear"),
    ]);

    expect(precheck.affectedCount).toBe(4);
    expect(precheck.blockingWaiverCount).toBe(1);
    expect(precheck.warnings).toEqual([
      { code: "missing-waiver", label: "Missing lien waiver", count: 1 },
      { code: "missing-job", label: "Missing job", count: 1 },
      { code: "missing-vendor", label: "Missing vendor", count: 1 },
      { code: "missing-amount", label: "Missing amount", count: 1 },
    ]);
    expect(precheck.warnings.map((warning) => warning.label).join(" ")).not.toMatch(/subcontract/i);
  });

  it("does not warn for a required waiver that is already linked", () => {
    expect(
      deriveSpectrumSubmitPrechecks([
        makeCandidate("linked", {
          lienWaiverRequired: true,
          lienWaiverStatus: "missing",
          linkedLienWaiverId: "waiver-linked",
        }),
      ]).warnings,
    ).toEqual([]);
  });

  it("does not block a required waiver marked on the document", () => {
    const precheck = deriveSpectrumSubmitPrechecks([
      makeCandidate("override", {
        lienWaiverRequired: true,
        linkedLienWaiverId: null,
        waiverOnDocument: true,
      }),
    ]);

    expect(precheck.blockingWaiverCount).toBe(0);
    expect(precheck.warnings).toEqual([]);
  });
});
