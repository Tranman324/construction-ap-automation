import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getSubmitControlMocks,
  makeInvoice,
  renderControl,
  resetSubmitControlMocks,
} from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceQueueSubmitControl.testUtils";
import { SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitFailureWorkflowModel";

const SC = getSubmitControlMocks();

function candidateFromInvoice(invoice: ReturnType<typeof makeInvoice>) {
  return {
    id: invoice.id,
    vendorName: invoice.extracted?.vendorName ?? null,
    invoiceNumber: invoice.extracted?.invoiceNumber ?? null,
    amount: invoice.extracted?.amount ?? null,
    jobNumber: invoice.extracted?.jobNumber ?? null,
    lienWaiverStatus: invoice.lienWaiverStatus ?? null,
    lienWaiverRequired: invoice.lienWaiverRequired === true,
    linkedLienWaiverId: invoice.linkedLienWaiverId ?? null,
  };
}

describe("InvoiceQueueSubmitControl failure workflow", () => {
  beforeEach(() => {
    resetSubmitControlMocks();
  });

  it("opens failed rows with return context and a stored results snapshot", async () => {
    const user = userEvent.setup();
    SC.searchParams = new URLSearchParams("status=approved");
    SC.mutateAsync.mockResolvedValue({
      success: false,
      submitted: 0,
      message: "Spectrum rejected the invoice",
      results: [{ id: "eligible", success: false, error: "Duplicate invoice" }],
    });

    renderControl({
      selectedIds: ["eligible"],
      selectedInvoices: [makeInvoice("eligible")],
    });

    await user.click(screen.getByRole("button", { name: /Submit to Spectrum/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /Submit to Spectrum/ }),
    );
    await screen.findByRole("button", { name: "Open" });
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(SC.routerPush).toHaveBeenCalledWith(
      "/accounting/invoices/eligible?from=%2Faccounting%2Finvoices%3Fstatus%3Dapproved%26spectrumSubmitReturn%3D1&spectrumSubmitReturn=1",
    );
    expect(window.sessionStorage.getItem(SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY)).toContain("eligible");
  });

  it("restores returned workflows after refreshing submitted and discarded rows", async () => {
    SC.searchParams = new URLSearchParams("spectrumSubmitReturn=1");
    SC.fetchInvoice
      .mockResolvedValueOnce({ id: "submitted", status: "submitted", lastSpectrumError: null })
      .mockResolvedValueOnce({ id: "discarded", status: "discarded", lastSpectrumError: null })
      .mockResolvedValueOnce({ id: "still-failing", status: "approved", lastSpectrumError: "Missing phase" });
    window.sessionStorage.setItem(
      SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY,
      JSON.stringify({
        activeInvoiceId: "submitted",
        results: {
          phase: "results",
          candidates: [makeInvoice("submitted"), makeInvoice("discarded"), makeInvoice("still-failing")]
            .map(candidateFromInvoice),
          rows: [
            {
              invoiceId: "submitted",
              invoiceNumber: "submitted",
              vendorName: "Acme Concrete",
              amount: 100,
              submitted: false,
              issue: "Duplicate invoice",
              resolved: false,
              discarded: false,
            },
            {
              invoiceId: "discarded",
              invoiceNumber: "discarded",
              vendorName: "Acme Concrete",
              amount: 100,
              submitted: false,
              issue: "Duplicate invoice",
              resolved: false,
              discarded: false,
            },
            {
              invoiceId: "still-failing",
              invoiceNumber: "still-failing",
              vendorName: "Acme Concrete",
              amount: 100,
              submitted: false,
              issue: "Duplicate invoice",
              resolved: false,
              discarded: false,
            },
          ],
          submittedCount: 0,
          failedCount: 3,
        },
      }),
    );

    renderControl();

    expect(await screen.findByRole("dialog", { name: "Spectrum submission complete" })).toBeInTheDocument();
    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent("Submitted to Spectrum");
    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent("Resolved");
    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent("Missing phase");
    expect(screen.getByRole("button", { name: "Fix 1 failed ->" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current unresolved failure")).toHaveTextContent("1 / 1");
    expect(screen.getByRole("button", { name: "Previous unresolved failure" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next unresolved failure" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resolve 1 first" })).toBeDisabled();
  });

  it("restores stored workflows when browser back returns to the queue without return params", async () => {
    SC.fetchInvoice.mockResolvedValueOnce({ id: "still-failing", status: "approved", lastSpectrumError: "Missing phase" });
    window.sessionStorage.setItem(
      SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY,
      JSON.stringify({
        activeInvoiceId: "still-failing",
        results: {
          phase: "results",
          candidates: [makeInvoice("still-failing")].map(candidateFromInvoice),
          rows: [
            {
              invoiceId: "still-failing",
              invoiceNumber: "still-failing",
              vendorName: "Acme Concrete",
              amount: 100,
              submitted: false,
              issue: "Duplicate invoice",
              resolved: false,
              discarded: false,
            },
          ],
          submittedCount: 0,
          failedCount: 1,
        },
      }),
    );

    renderControl();

    expect(await screen.findByRole("dialog", { name: "Spectrum submission complete" })).toBeInTheDocument();
    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent("Missing phase");
    expect(screen.getByRole("button", { name: "Fix 1 failed ->" })).toBeInTheDocument();
  });

  it("restores returned workflows when StrictMode replays mount effects", async () => {
    SC.searchParams = new URLSearchParams("spectrumSubmitReturn=1");
    SC.fetchInvoice.mockResolvedValue({ id: "still-failing", status: "approved", lastSpectrumError: "Missing phase" });
    window.sessionStorage.setItem(
      SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY,
      JSON.stringify({
        activeInvoiceId: "still-failing",
        results: {
          phase: "results",
          candidates: [makeInvoice("still-failing")].map(candidateFromInvoice),
          rows: [
            {
              invoiceId: "still-failing",
              invoiceNumber: "still-failing",
              vendorName: "Acme Concrete",
              amount: 100,
              submitted: false,
              issue: "Duplicate invoice",
              resolved: false,
              discarded: false,
            },
          ],
          submittedCount: 0,
          failedCount: 1,
        },
      }),
    );

    renderControl({ strictMode: true });

    expect(await screen.findByRole("dialog", { name: "Spectrum submission complete" })).toBeInTheDocument();
    expect(screen.getByLabelText("Spectrum submission results")).toHaveTextContent("Missing phase");
    expect(screen.getByRole("button", { name: "Fix 1 failed ->" })).toBeInTheDocument();
  });
});
