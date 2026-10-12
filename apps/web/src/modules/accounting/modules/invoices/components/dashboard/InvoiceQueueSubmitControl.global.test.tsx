import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getSubmitControlMocks,
  makeExtracted,
  makeInvoice,
  makeStats,
  renderControl,
  resetSubmitControlMocks,
} from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceQueueSubmitControl.testUtils";
import { InvoiceQueueSubmitControl } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceQueueSubmitControl";

const SC = getSubmitControlMocks();

describe("InvoiceQueueSubmitControl global mode", () => {
  beforeEach(() => {
    resetSubmitControlMocks();
  });

  it("opens global approved queue mode when no rows are selected", async () => {
    const user = userEvent.setup();
    SC.invoices = [
      makeInvoice("global-1", { extracted: makeExtracted("global-1", 75) }),
      makeInvoice("global-2", { extracted: makeExtracted("global-2", 125, "25-401", "Beacon Electric") }),
    ];

    renderControl();

    await user.click(screen.getByRole("button", { name: /Submit to Spectrum/ }));

    expect(
      screen.getByRole("dialog", { name: "Submit approved invoices to Spectrum" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Approved queue")).toBeInTheDocument();
    expect(screen.getByLabelText("Documents count")).toHaveTextContent("2");
    expect(screen.getByLabelText("Total value")).toHaveTextContent("$200.00");
    expect(screen.getByLabelText("Affected jobs")).toHaveTextContent("1");
  });

  it("preserves no-approved disabled affordance and permission gating", () => {
    const emptyStats = makeStats({
      approved: 0,
      amounts: { pending: 0, approved: 0, submitted: 0, total: 0 },
    });
    const { rerender } = renderControl({ stats: emptyStats });

    expect(screen.getByRole("button", { name: /Submit to Spectrum/ })).toBeDisabled();

    SC.allowed = false;
    rerender(
      <InvoiceQueueSubmitControl
        stats={makeStats()}
        statsLoading={false}
        selectedIds={[]}
        selectedInvoices={[]}
      />,
    );

    expect(screen.queryByRole("button", { name: /Submit to Spectrum/ })).not.toBeInTheDocument();
  });
});
