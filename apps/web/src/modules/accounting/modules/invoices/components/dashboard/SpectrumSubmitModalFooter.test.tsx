import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SpectrumSubmitModalFooter } from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModalFooter";
import type { SpectrumSubmitConfirmSummary } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import type { SpectrumSubmitPhaseModel } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";

const summary: SpectrumSubmitConfirmSummary = {
  count: 2,
  totalAmount: 300,
  jobsAffected: 1,
  title: "Submit 2 invoices to Spectrum",
  sourceLabel: "Selected approved invoices",
  submitLabel: "Submit 2 to Spectrum",
};

function renderFooter(phaseModel: SpectrumSubmitPhaseModel) {
  return render(
    <SpectrumSubmitModalFooter
      canCompleteResults={false}
      canSubmit
      phaseModel={phaseModel}
      summary={summary}
      unresolvedFailureCount={1}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
      onDone={vi.fn()}
      onResubmitFailures={vi.fn()}
    />,
  );
}

describe("SpectrumSubmitModalFooter", () => {
  it("renders completion gating copy for unresolved failures", () => {
    renderFooter({
      phase: "results",
      candidates: [],
      rows: [],
      submittedCount: 0,
      failedCount: 1,
    });

    expect(screen.getByRole("button", { name: "Resolve 1 first" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resubmit 1" })).toBeEnabled();
  });
});
