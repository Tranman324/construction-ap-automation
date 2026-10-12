import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SpectrumSubmitReturnButton } from "@/modules/accounting/modules/invoices/components/invoices/SpectrumSubmitReturnButton";
import {
  clearSpectrumSubmitFailureWorkflowSnapshot,
  writeSpectrumSubmitFailureWorkflowSnapshot,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitFailureWorkflowModel";

describe("SpectrumSubmitReturnButton", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("appears only when a submit-results detail visit has stored workflow state", async () => {
    const onReturn = vi.fn();
    const { rerender } = render(
      <SpectrumSubmitReturnButton
        returnHref="/accounting/invoices"
        visible={false}
        onReturn={onReturn}
      />,
    );

    expect(screen.queryByRole("button", { name: "Back to results" })).not.toBeInTheDocument();

    rerender(
      <SpectrumSubmitReturnButton
        returnHref="/accounting/invoices"
        visible
        onReturn={onReturn}
      />,
    );
    expect(screen.queryByRole("button", { name: "Back to results" })).not.toBeInTheDocument();

    writeSpectrumSubmitFailureWorkflowSnapshot({
      activeInvoiceId: "failed",
      results: {
        phase: "results",
        candidates: [],
        rows: [],
        submittedCount: 0,
        failedCount: 0,
      },
    });
    rerender(
      <SpectrumSubmitReturnButton
        returnHref="/accounting/invoices?spectrumSubmitReturn=1"
        visible
        onReturn={onReturn}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Back to results" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Back to results" }));

    expect(onReturn).toHaveBeenCalledWith("/accounting/invoices?spectrumSubmitReturn=1");
  });

  it("reacts when workflow storage is written or cleared", async () => {
    render(
      <SpectrumSubmitReturnButton
        returnHref="/accounting/invoices?spectrumSubmitReturn=1"
        visible
        onReturn={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Back to results" })).not.toBeInTheDocument();

    writeSpectrumSubmitFailureWorkflowSnapshot({
      activeInvoiceId: "failed",
      results: {
        phase: "results",
        candidates: [],
        rows: [],
        submittedCount: 0,
        failedCount: 0,
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Back to results" })).toBeInTheDocument();
    });

    clearSpectrumSubmitFailureWorkflowSnapshot();

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Back to results" })).not.toBeInTheDocument();
    });
  });
});
