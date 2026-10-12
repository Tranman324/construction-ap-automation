import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  SpectrumSubmitSubmittingView,
  SpectrumSubmitResultsView,
} from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitPhaseViews";
import {
  completeSpectrumSubmitProgress,
  normalizeSpectrumSubmitResponse,
  recordSpectrumSubmitResult,
  startSpectrumSubmitProgress,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";
import type { SpectrumSubmitCandidate } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";

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

describe("SpectrumSubmitPhaseViews", () => {
  it("renders submitting progress and active row state", () => {
    const phase = startSpectrumSubmitProgress([makeCandidate("inv-1"), makeCandidate("inv-2")]);

    render(<SpectrumSubmitSubmittingView phase={phase} />);

    expect(screen.getByRole("progressbar", { name: "Spectrum submit progress" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByLabelText("Submit progress count")).toHaveTextContent("0 / 2");
    expect(screen.getByLabelText("inv-1 active")).toBeInTheDocument();
    expect(screen.getByRole("progressbar").querySelector("span")).toHaveClass(motionStyles.progressBar);
    expect(screen.getByLabelText("inv-1 active").querySelector("svg")).toHaveClass(motionStyles.spinner);
  });

  it("renders the minimal results preview", () => {
    const first = makeCandidate("inv-1");
    const phase = recordSpectrumSubmitResult(
      startSpectrumSubmitProgress([first]),
      normalizeSpectrumSubmitResponse(first, { success: true, submitted: 1, message: "Submitted" }),
    );

    render(<SpectrumSubmitResultsView phase={completeSpectrumSubmitProgress(phase)} />);

    expect(screen.getByText(/1\/1/)).toBeInTheDocument();
    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent("Submitted");
  });
});
