import { describe, expect, it, vi } from "vitest";

import { runSpectrumSubmitSubmission } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitSubmissionRunner";
import type { SpectrumSubmitCandidate } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";

function makeCandidate(id: string): SpectrumSubmitCandidate {
  return {
    id,
    vendorName: "Acme Concrete",
    invoiceNumber: id,
    amount: 100,
    jobNumber: "25-401",
    lienWaiverStatus: "attached",
    lienWaiverRequired: false,
    linkedLienWaiverId: "waiver-1",
  };
}

describe("spectrumSubmitSubmissionRunner", () => {
  it("submits one invoice ID at a time and reports progress", async () => {
    const onProgress = vi.fn();
    const mutateAsync = vi.fn()
      .mockResolvedValueOnce({ success: true, submitted: 1, message: "Submitted" })
      .mockRejectedValueOnce(new Error("Network offline"));

    const result = await runSpectrumSubmitSubmission(
      [makeCandidate("inv-1"), makeCandidate("inv-2")],
      { mutateAsync },
      onProgress,
    );

    expect(mutateAsync).toHaveBeenNthCalledWith(1, { ids: ["inv-1"] });
    expect(mutateAsync).toHaveBeenNthCalledWith(2, { ids: ["inv-2"] });
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      phase: "results",
      submittedCount: 1,
      failedCount: 1,
      rows: [
        { invoiceId: "inv-1", submitted: true },
        { invoiceId: "inv-2", submitted: false, issue: "Network offline" },
      ],
    });
  });
});
