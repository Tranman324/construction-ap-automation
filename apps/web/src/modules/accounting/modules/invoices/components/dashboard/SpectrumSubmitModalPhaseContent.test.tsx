import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SpectrumSubmitModalPhaseContent } from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModalPhaseContent";
import type { SpectrumSubmitConfirmSummary } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";

const summary: SpectrumSubmitConfirmSummary = {
  count: 1,
  totalAmount: 100,
  jobsAffected: 1,
  title: "Submit invoice to Spectrum",
  sourceLabel: "Selected approved invoices",
  submitLabel: "Submit to Spectrum",
};

describe("SpectrumSubmitModalPhaseContent", () => {
  it("renders the confirm phase summary", () => {
    render(
      <SpectrumSubmitModalPhaseContent
        activeFailureInvoiceId={null}
        confirmCandidates={[]}
        discardingInvoiceId={null}
        failureNavigation={null}
        phaseModel={{ phase: "confirm", source: { kind: "selected", invoices: [] } }}
        precheck={{ affectedCount: 0, blockingWaiverCount: 0, warnings: [] }}
        summary={summary}
        onDiscardInvoice={vi.fn()}
        onFailureNavigationChange={vi.fn()}
        onOpenInvoice={vi.fn()}
      />,
    );

    expect(screen.getByText("Selected approved invoices")).toBeInTheDocument();
    expect(screen.getByText("All pre-checks passed.")).toBeInTheDocument();
  });
});
