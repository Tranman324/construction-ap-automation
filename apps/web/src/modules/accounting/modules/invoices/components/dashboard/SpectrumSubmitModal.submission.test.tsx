import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getModalMocks,
  makeDeferred,
  makeInvoice,
  makeSubmitResponse,
  resetModalMocks,
  selectedMode,
} from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModal.testUtils";
import { SpectrumSubmitModal } from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModal";
import type { SubmitResponse } from "@/modules/accounting/modules/invoices/types/api";

const MODAL_MOCKS = getModalMocks();

describe("SpectrumSubmitModal submission flow", () => {
  beforeEach(() => {
    resetModalMocks();
  });

  it("advances selected candidates into deterministic submitting progress", async () => {
    const user = userEvent.setup();
    const firstSubmit = makeDeferred<SubmitResponse>();
    const secondSubmit = makeDeferred<SubmitResponse>();
    MODAL_MOCKS.mutateAsync
      .mockReturnValueOnce(firstSubmit.promise)
      .mockReturnValueOnce(secondSubmit.promise);

    render(<SpectrumSubmitModal open onOpenChange={vi.fn()} mode={selectedMode} />);

    await user.click(screen.getByRole("button", { name: "Submit 2 to Spectrum" }));

    expect(MODAL_MOCKS.mutateAsync).toHaveBeenCalledWith({ ids: ["inv-1"] });
    expect(screen.getByRole("progressbar", { name: "Spectrum submit progress" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByLabelText("Submit progress count")).toHaveTextContent("0 / 2");
    expect(screen.getByLabelText("Current submit item")).toHaveTextContent("inv-1");

    await act(async () => {
      firstSubmit.resolve(makeSubmitResponse());
    });

    await waitFor(() => expect(MODAL_MOCKS.mutateAsync).toHaveBeenCalledWith({ ids: ["inv-2"] }));
    expect(screen.getByRole("progressbar", { name: "Spectrum submit progress" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByLabelText("Submit progress count")).toHaveTextContent("1 / 2");
    expect(screen.getByLabelText("Current submit item")).toHaveTextContent("B-200");
  });

  it("guards against duplicate submissions from same-render rapid clicks", () => {
    const submit = makeDeferred<SubmitResponse>();
    MODAL_MOCKS.mutateAsync.mockReturnValue(submit.promise);

    render(<SpectrumSubmitModal open onOpenChange={vi.fn()} mode={selectedMode} />);

    const submitButton = screen.getByRole("button", { name: "Submit 2 to Spectrum" });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    expect(MODAL_MOCKS.mutateAsync).toHaveBeenCalledTimes(1);
    expect(MODAL_MOCKS.mutateAsync).toHaveBeenCalledWith({ ids: ["inv-1"] });
  });

  it("submits loaded global approved candidates one ID at a time", async () => {
    const user = userEvent.setup();
    const submit = makeDeferred<SubmitResponse>();
    MODAL_MOCKS.invoices = [makeInvoice("loaded-1")];
    MODAL_MOCKS.mutateAsync.mockReturnValueOnce(submit.promise);

    render(
      <SpectrumSubmitModal
        open
        onOpenChange={vi.fn()}
        mode={{
          kind: "global-approved-queue",
          invoiceCount: 1,
          totalAmount: 100,
          jobsAffected: null,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Submit to Spectrum" }));

    expect(MODAL_MOCKS.mutateAsync).toHaveBeenCalledWith({ ids: ["loaded-1"] });
    expect(screen.getByLabelText("Current submit item")).toHaveTextContent("loaded-1");
  });

  it("normalizes successful responses into one result row per candidate", async () => {
    const user = userEvent.setup();
    MODAL_MOCKS.mutateAsync
      .mockResolvedValueOnce(makeSubmitResponse())
      .mockResolvedValueOnce(makeSubmitResponse({
        results: [{ id: "inv-2", success: true, invoiceNumber: "B-200" }],
      }));

    render(<SpectrumSubmitModal open onOpenChange={vi.fn()} mode={selectedMode} />);

    await user.click(screen.getByRole("button", { name: "Submit 2 to Spectrum" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Spectrum submission complete" })).toBeInTheDocument();
    });
    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent("inv-1");
    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent("B-200");
    expect(MODAL_MOCKS.confetti).toHaveBeenCalledTimes(1);
  });

  it("normalizes failed responses with useful reasons", async () => {
    const user = userEvent.setup();
    MODAL_MOCKS.mutateAsync
      .mockResolvedValueOnce(makeSubmitResponse({
        success: false,
        submitted: 0,
        message: "Spectrum rejected the invoice",
        results: [{ id: "inv-1", success: false, error: "Duplicate invoice" }],
      }))
      .mockRejectedValueOnce(new Error("Network offline"));

    render(<SpectrumSubmitModal open onOpenChange={vi.fn()} mode={selectedMode} />);

    await user.click(screen.getByRole("button", { name: "Submit 2 to Spectrum" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Spectrum submission complete" })).toBeInTheDocument();
    });
    expect(screen.getByText(/0\/2/)).toBeInTheDocument();
    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent("Duplicate invoice");
    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent("Network offline");
    expect(screen.getByRole("button", { name: "Resolve 2 first" })).toBeDisabled();
    expect(MODAL_MOCKS.confetti).not.toHaveBeenCalled();
  });
});
