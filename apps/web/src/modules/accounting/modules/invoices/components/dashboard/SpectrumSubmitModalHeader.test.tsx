import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SpectrumSubmitModalHeader } from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModalHeader";
import type { SpectrumSubmitConfirmSummary } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import { Dialog, DialogContent } from "@/modules/shared/components/ui/dialog";

const summary: SpectrumSubmitConfirmSummary = {
  count: 2,
  totalAmount: 300,
  jobsAffected: 1,
  title: "Submit 2 invoices to Spectrum",
  sourceLabel: "Selected approved invoices",
  submitLabel: "Submit 2 to Spectrum",
};

describe("SpectrumSubmitModalHeader", () => {
  it("renders confirm and results titles from the phase", () => {
    const { rerender } = render(
      <Dialog open>
        <DialogContent>
          <SpectrumSubmitModalHeader
            phaseModel={{ phase: "confirm", source: { kind: "selected", invoices: [] } }}
            summary={summary}
          />
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByText("Submit 2 invoices to Spectrum")).toBeInTheDocument();

    rerender(
      <Dialog open>
        <DialogContent>
          <SpectrumSubmitModalHeader
            phaseModel={{
              phase: "results",
              candidates: [],
              rows: [],
              submittedCount: 0,
              failedCount: 0,
            }}
            summary={summary}
          />
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByText("Spectrum submission complete")).toBeInTheDocument();
  });
});
