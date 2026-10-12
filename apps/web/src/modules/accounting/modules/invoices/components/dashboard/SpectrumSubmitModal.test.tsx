import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getModalMocks,
  makeCandidate,
  makeInvoice,
  resetModalMocks,
  selectedMode,
} from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModal.testUtils";
import { SpectrumSubmitModal } from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitModal";

const MODAL_MOCKS = getModalMocks();

describe("SpectrumSubmitModal", () => {
  beforeEach(() => {
    resetModalMocks();
  });

  it("stays inert while closed and opens into the confirm shell", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <SpectrumSubmitModal
        open={false}
        onOpenChange={onOpenChange}
        mode={selectedMode}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <SpectrumSubmitModal
        open
        onOpenChange={onOpenChange}
        mode={selectedMode}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Submit 2 invoices to Spectrum" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Selected approved invoices")).toBeInTheDocument();
    expect(screen.getByLabelText("Documents count")).toHaveTextContent("2");
    expect(screen.getByLabelText("Total value")).toHaveTextContent("$2,050.00");
    expect(screen.getByLabelText("Affected jobs")).toHaveTextContent("2");
    expect(screen.getByText("All pre-checks passed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit 2 to Spectrum" })).toBeEnabled();
  });

  it("uses controlled props for close actions", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<SpectrumSubmitModal open onOpenChange={onOpenChange} mode={selectedMode} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps non-blocking validation prechecks out of the confirmation UI", () => {
    render(
      <SpectrumSubmitModal
        open
        onOpenChange={vi.fn()}
        mode={{
          kind: "selected",
          invoices: [
            makeCandidate("clean"),
            makeCandidate("amount", { amount: Number.NaN }),
          ],
        }}
      />,
    );

    expect(screen.queryByText(/may fail validation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/They will be skipped and listed/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit 2 to Spectrum" })).toBeEnabled();
  });

  it("blocks submission when a selected invoice requires a waiver", () => {
    render(
      <SpectrumSubmitModal
        open
        onOpenChange={vi.fn()}
        mode={{
          kind: "selected",
          invoices: [
            makeCandidate("waiver", {
              lienWaiverRequired: true,
              linkedLienWaiverId: null,
              // makeCandidate defaults to "attached"; the gate now honors a
              // pipeline-detected embedded waiver, so the fixture must say the
              // waiver is genuinely missing for this case to block.
              lienWaiverStatus: "missing",
            }),
          ],
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Lien waiver required before submission.");
    expect(screen.getByRole("button", { name: "Submit to Spectrum" })).toBeDisabled();
  });

  it("uses loaded global approved rows for stats without a validation warning card", () => {
    MODAL_MOCKS.invoices = [
      makeInvoice("loaded-1", { overallConfidence: 0.4 }),
      makeInvoice("loaded-2", {
        extracted: {
          vendorName: "Beacon Electric",
          vendorAddress: null,
          invoiceNumber: "loaded-2",
          invoiceDate: null,
          dueDate: null,
          amount: 200,
          jobNumber: "24-010",
          projectName: null,
          description: null,
          lineItems: [],
        },
      }),
    ];

    render(
      <SpectrumSubmitModal
        open
        onOpenChange={vi.fn()}
        mode={{
          kind: "global-approved-queue",
          invoiceCount: 7,
          totalAmount: 4321,
          jobsAffected: 3,
        }}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Submit approved invoices to Spectrum" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Documents count")).toHaveTextContent("2");
    expect(screen.getByLabelText("Total value")).toHaveTextContent("$300.00");
    expect(screen.getByLabelText("Affected jobs")).toHaveTextContent("1");
    expect(screen.queryByText(/may fail validation/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit 2 to Spectrum" })).toBeEnabled();
  });
});
