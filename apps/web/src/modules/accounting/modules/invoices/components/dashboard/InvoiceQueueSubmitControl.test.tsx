import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getSubmitControlMocks,
  makeInvoice,
  makeStats,
  renderControl,
  resetSubmitControlMocks,
} from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceQueueSubmitControl.testUtils";

const SC = getSubmitControlMocks();

describe("InvoiceQueueSubmitControl", () => {
  beforeEach(() => {
    resetSubmitControlMocks();
  });

  it("opens selected mode with selected approved invoice candidates", async () => {
    const user = userEvent.setup();

    renderControl({
      stats: makeStats({ approved: 0 }),
      selectedIds: ["eligible"],
      selectedInvoices: [makeInvoice("eligible")],
    });

    await user.click(screen.getByRole("button", { name: /Submit to Spectrum/ }));

    expect(
      screen.getByRole("dialog", { name: "Submit invoice to Spectrum" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Selected approved invoices")).toBeInTheDocument();
    expect(screen.getByText("$100.00")).toBeInTheDocument();
  });

  it("warns and skips selected rows that are not approved invoice documents", async () => {
    const user = userEvent.setup();

    renderControl({
      selectedIds: ["eligible", "pending", "coi"],
      selectedInvoices: [
        makeInvoice("eligible"),
        makeInvoice("pending", { status: "pending" }),
        makeInvoice("coi", { classification: "coi" }),
      ],
    });

    await user.click(screen.getByRole("button", { name: /Submit to Spectrum/ }));

    expect(SC.toastWarning).toHaveBeenCalledWith(
      "Submitting eligible selected invoices",
      expect.objectContaining({ description: "1 eligible, 2 skipped." }),
    );
    expect(
      screen.getByRole("dialog", { name: "Submit invoice to Spectrum" }),
    ).toBeInTheDocument();
  });

  it("warns without opening when selected rows have no eligible invoices", async () => {
    const user = userEvent.setup();

    renderControl({
      selectedIds: ["pending"],
      selectedInvoices: [makeInvoice("pending", { status: "pending" })],
    });

    await user.click(screen.getByRole("button", { name: /Submit to Spectrum/ }));

    expect(SC.toastWarning).toHaveBeenCalledWith(
      "No selected invoices can be submitted",
      expect.objectContaining({
        description: "Select approved invoice documents before submitting to Spectrum.",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dashboard to one header-level submit entry point", () => {
    renderControl({
      selectedIds: ["eligible"],
      selectedInvoices: [makeInvoice("eligible")],
    });

    expect(screen.getAllByRole("button", { name: /Submit to Spectrum/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
  });
});
