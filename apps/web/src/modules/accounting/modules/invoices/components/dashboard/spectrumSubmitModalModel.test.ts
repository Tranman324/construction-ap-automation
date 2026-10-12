import { describe, expect, it } from "vitest";

import {
  getSpectrumSubmitDialogDescription,
  summarizeSpectrumSubmitMode,
  type SpectrumSubmitCandidate,
  type SpectrumSubmitMode,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";

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

describe("spectrumSubmitModalModel", () => {
  it("summarizes selected invoice candidates for confirm phase copy", () => {
    const mode: SpectrumSubmitMode = {
      kind: "selected",
      invoices: [
        makeCandidate("inv-1"),
        makeCandidate("inv-2", { amount: 200, jobNumber: "24-002" }),
      ],
    };

    expect(summarizeSpectrumSubmitMode(mode)).toMatchObject({
      count: 2,
      totalAmount: 300,
      jobsAffected: 2,
      title: "Submit 2 invoices to Spectrum",
    });
  });

  it("uses loaded global candidates instead of aggregate descriptor stats", () => {
    const mode: SpectrumSubmitMode = {
      kind: "global-approved-queue",
      invoiceCount: 7,
      totalAmount: 9999,
      jobsAffected: null,
    };

    expect(
      summarizeSpectrumSubmitMode(mode, [
        makeCandidate("loaded-1", { amount: 50, jobNumber: "25-401" }),
        makeCandidate("loaded-2", { amount: 75, jobNumber: "25-401" }),
      ]),
    ).toMatchObject({
      count: 2,
      totalAmount: 125,
      jobsAffected: 1,
      title: "Submit approved invoices to Spectrum",
    });
  });

  it("describes the results phase with submitted counts", () => {
    expect(
      getSpectrumSubmitDialogDescription({
        phase: "results",
        candidates: [],
        rows: [
          {
            invoiceId: "inv-1",
            invoiceNumber: "inv-1",
            vendorName: "Acme Concrete",
            amount: 100,
            submitted: true,
            issue: null,
            resolved: true,
            discarded: false,
          },
        ],
        submittedCount: 1,
        failedCount: 0,
      }),
    ).toBe("1 of 1 posted to Spectrum.");
  });
});
