import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getModalMocks,
  makeSubmitResponse,
  resetModalMocks,
  selectedMode,
} from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModal.testUtils";
import { SpectrumSubmitModal } from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModal";

const MODAL_MOCKS = getModalMocks();

function rejectFirstSubmission(): void {
  MODAL_MOCKS.mutateAsync
    .mockResolvedValueOnce(makeSubmitResponse({
      success: false,
      submitted: 0,
      message: "Spectrum rejected the invoice",
      results: [{ id: "inv-1", success: false, error: "Duplicate invoice" }],
    }))
    .mockResolvedValueOnce(makeSubmitResponse());
}

describe("SpectrumSubmitModal result actions", () => {
  beforeEach(() => {
    resetModalMocks();
  });

  it("opens a failed invoice by closing without reset and requesting the detail route", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onFailureOpenRequest = vi.fn();
    rejectFirstSubmission();

    render(
      <SpectrumSubmitModal
        open
        mode={selectedMode}
        onFailureOpenRequest={onFailureOpenRequest}
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Submit 2 to Spectrum" }));
    await screen.findByRole("button", { name: "Open" });
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(MODAL_MOCKS.routerPush).toHaveBeenCalledWith("/accounting/invoices/inv-1");
    expect(onFailureOpenRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: "inv-1",
        results: expect.objectContaining({ phase: "results" }),
      }),
    );
  });

  it("discards a failed row and removes it from completion-blocking failures", async () => {
    const user = userEvent.setup();
    rejectFirstSubmission();

    render(<SpectrumSubmitModal open onOpenChange={vi.fn()} mode={selectedMode} />);

    await user.click(screen.getByRole("button", { name: "Submit 2 to Spectrum" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Resolve 1 first" })).toBeDisabled();
    });
    await user.click(screen.getByRole("button", { name: "Discard inv-1" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
    });

    expect(MODAL_MOCKS.discardMutateAsync).toHaveBeenCalledWith({
      id: "inv-1",
      reason: "Discarded after Spectrum submission failure: Duplicate invoice",
    });
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("All failures resolved.");
  });

  it("discards the approved duplicate rather than the submitted document", async () => {
    const user = userEvent.setup();
    MODAL_MOCKS.mutateAsync
      .mockRejectedValueOnce({
        status: 400,
        message: "Cannot submit: selected invoices contain duplicate vendor and invoice-number combinations.",
        details: {
          duplicates: [{
            vendorCode: "ACME01",
            invoiceNumber: "A-100",
            documentIds: ["already-submitted", "inv-1"],
            reason: "already_submitted",
            documents: [
              { id: "already-submitted", status: "submitted", jobNumber: "25-500", amount: 100 },
              { id: "inv-1", status: "approved", jobNumber: "25-500", amount: 100 },
            ],
          }],
        },
      })
      .mockResolvedValueOnce(makeSubmitResponse());

    render(<SpectrumSubmitModal open onOpenChange={vi.fn()} mode={selectedMode} />);

    await user.click(screen.getByRole("button", { name: "Submit 2 to Spectrum" }));
    await screen.findByText("Already submitted to Spectrum");
    await user.click(screen.getByRole("button", { name: "Discard inv-1" }));

    expect(MODAL_MOCKS.discardMutateAsync).toHaveBeenCalledWith({
      id: "inv-1",
      reason: "Discarded after Spectrum submission failure: Already submitted to Spectrum",
    });
  });

  it("resubmits only unresolved failures and merges retry results", async () => {
    const user = userEvent.setup();
    rejectFirstSubmission();

    render(<SpectrumSubmitModal open onOpenChange={vi.fn()} mode={selectedMode} />);

    await user.click(screen.getByRole("button", { name: "Submit 2 to Spectrum" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Resubmit 1" })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: "Resubmit 1" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
    });

    expect(MODAL_MOCKS.mutateAsync).toHaveBeenNthCalledWith(3, { ids: ["inv-1"] });
    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent("Submitted to Spectrum");
    expect(screen.queryByRole("button", { name: "Resubmit 1" })).not.toBeInTheDocument();
  });

  it("keeps a failed row actionable and shows feedback when discard fails", async () => {
    const user = userEvent.setup();
    rejectFirstSubmission();
    MODAL_MOCKS.discardMutateAsync.mockRejectedValueOnce(new Error("Discard denied"));

    render(<SpectrumSubmitModal open onOpenChange={vi.fn()} mode={selectedMode} />);

    await user.click(screen.getByRole("button", { name: "Submit 2 to Spectrum" }));
    await screen.findByRole("button", { name: "Resolve 1 first" });
    await user.click(screen.getByRole("button", { name: "Discard inv-1" }));

    await waitFor(() => {
      expect(MODAL_MOCKS.toastError).toHaveBeenCalledWith(
        "Failed to discard invoice",
        { description: "Discard denied" },
      );
    });
    expect(screen.getByRole("button", { name: "Resolve 1 first" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard inv-1" })).toBeEnabled();
  });
});
