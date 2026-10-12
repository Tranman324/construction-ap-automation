import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  StatementLineRollup,
  StatementLinesPanel,
} from "@/modules/accounting/modules/invoices/components/documents/statementLineViews";
import type { StatementLineState } from "@/modules/accounting/modules/invoices/components/documents/documentSpecLocalModels";
import { PanelNoticeOutlet, PanelNoticeProvider } from "./PanelNotice";

const lines: StatementLineState[] = [
  {
    id: "line-1",
    invoiceNumber: "INV-100",
    date: "2026-06-01",
    statementAmount: 100,
    apAmount: 100,
    matchState: "matched",
    resolved: false,
    source: "extracted",
  },
  {
    id: "line-2",
    invoiceNumber: "INV-101",
    date: "2026-06-08",
    statementAmount: 200,
    apAmount: 180,
    matchState: "amount_differs",
    resolved: false,
    source: "extracted",
  },
];

const allStatusLines: StatementLineState[] = [
  ...lines,
  {
    id: "line-3",
    invoiceNumber: "INV-102",
    date: "2026-06-15",
    statementAmount: 300,
    apAmount: null,
    matchState: "not_received",
    resolved: false,
    source: "extracted",
  },
  {
    id: "line-4",
    invoiceNumber: "INV-103",
    date: "2026-06-22",
    statementAmount: 400,
    apAmount: 400,
    matchState: "in_toolbox_not_spectrum",
    resolved: false,
    source: "extracted",
  },
];

describe("statement line views", () => {
  it("moves missing-vendor and extraction notices while retaining editable data and local validation", () => {
    const view = (hasLines: boolean) => <PanelNoticeProvider documentId="statement-1">
      <div data-testid="inline-lines"><StatementLinesPanel
        lines={hasLines ? lines : []} vendorCode={hasLines ? "V1" : ""} extractionFailed
        draft={{ invoiceNumber: "", date: "", amount: "", error: "Enter a valid amount.", pending: false }}
        onResolveLine={vi.fn()} onDraftChange={vi.fn()} canManageLines onAddLine={vi.fn()}
      /></div><PanelNoticeOutlet />
    </PanelNoticeProvider>;
    const { rerender } = render(view(false));
    const inline = screen.getByTestId("inline-lines");
    const outlet = screen.getByTestId("panel-notice-outlet");
    expect(outlet).toContainElement(screen.getByText(/Assign a vendor to check/));
    expect(outlet).toContainElement(screen.getByText(/Statement extraction failed/));
    expect(inline).toContainElement(screen.getByRole("button", { name: "Add Line" }));
    expect(inline).toContainElement(screen.getByText("Enter a valid amount."));
    rerender(view(true));
    expect(outlet).toBeEmptyDOMElement();
    expect(inline).toContainElement(screen.getByText("INV-100"));
  });
  it("renders explicit empty and extraction-failure states without fabricated rows", () => {
    const { rerender } = render(
      <StatementLinesPanel
        lines={[]}
        draft={{ invoiceNumber: "", date: "", amount: "", error: null, pending: false }}
        onResolveLine={vi.fn()}
        onDraftChange={vi.fn()}
      />,
    );
    expect(screen.getByText("No statement lines extracted")).toBeInTheDocument();
    expect(screen.getByText(/Extraction found no invoice lines/)).toBeInTheDocument();

    rerender(
      <StatementLinesPanel
        lines={[]}
        draft={{ invoiceNumber: "", date: "", amount: "", error: null, pending: false }}
        onResolveLine={vi.fn()}
        onDraftChange={vi.fn()}
        extractionFailed
      />,
    );
    expect(screen.getByText(/Statement extraction failed/)).toBeInTheDocument();
  });

  it("renders rollup metrics, line actions, and add-line draft controls", async () => {
    const user = userEvent.setup();
    const onResolveLine = vi.fn();
    const onDraftChange = vi.fn();
    const onAddLine = vi.fn();

    render(
      <>
        <StatementLineRollup stats={{ total: 2, cleared: 1, openDiffs: 1, openMissing: 0, unresolved: 1, balance: 300 }} />
        <StatementLinesPanel
          lines={lines}
          draft={{ invoiceNumber: "", date: "", amount: "", error: "Invoice number is required.", pending: false }}
          onResolveLine={onResolveLine}
          onDraftChange={onDraftChange}
          onAddLine={onAddLine}
          canManageLines
          onEditLine={vi.fn()}
          onDeleteLine={vi.fn()}
        />
      </>,
    );

    expect(screen.getByText("INV-101")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept AP $180.00" })).toBeInTheDocument();
    expect(screen.getByText("Invoice number is required.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept AP $180.00" }));
    fireEvent.change(screen.getByLabelText("Invoice number"), { target: { value: "INV-200" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-06-30" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "125.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Line" }));

    expect(onResolveLine).toHaveBeenCalledWith(lines[1], "use_ap_amount");
    expect(onDraftChange).toHaveBeenCalledWith({ invoiceNumber: "INV-200" });
    expect(onDraftChange).toHaveBeenCalledWith({ date: "2026-06-30" });
    expect(onDraftChange).toHaveBeenCalledWith({ amount: "125.50" });
    expect(onAddLine).toHaveBeenCalledTimes(1);
  });

  it("renders badges for every statement status and explains amount differences", () => {
    render(
      <StatementLinesPanel
        lines={allStatusLines}
        draft={{ invoiceNumber: "", date: "", amount: "", error: null, pending: false }}
        onResolveLine={vi.fn()}
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Spectrum")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept AP $180.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to AP" })).toBeInTheDocument();
    expect(screen.getByText("Toolbox")).toBeInTheDocument();
    expect(screen.getByTitle("Statement shows $200.00 - Spectrum/Toolbox has a different amount.")).toBeInTheDocument();
  });

  it("shows the vendor nudge and disables re-check until a vendor is assigned", () => {
    const onRecheckLines = vi.fn();
    const { rerender } = render(
      <StatementLinesPanel
        lines={lines}
        draft={{ invoiceNumber: "", date: "", amount: "", error: null, pending: false }}
        onResolveLine={vi.fn()}
        onDraftChange={vi.fn()}
        onAddLine={vi.fn()}
        canManageLines
        onRecheckLines={onRecheckLines}
      />,
    );

    expect(screen.getByText("Assign a vendor to check these invoices against Spectrum.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-check Lines" })).toBeDisabled();

    rerender(
      <StatementLinesPanel
        lines={lines}
        draft={{ invoiceNumber: "", date: "", amount: "", error: null, pending: false }}
        onResolveLine={vi.fn()}
        onDraftChange={vi.fn()}
        onAddLine={vi.fn()}
        canManageLines
        vendorCode="V100"
        onRecheckLines={onRecheckLines}
      />,
    );

    expect(screen.queryByText("Assign a vendor to check these invoices against Spectrum.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-check Lines" }));
    expect(onRecheckLines).toHaveBeenCalledTimes(1);
  });

  it("hides statement line mutation actions when management is not allowed", () => {
    render(
      <StatementLinesPanel
        lines={lines}
        draft={{ invoiceNumber: "", date: "", amount: "", error: null, pending: false }}
        onResolveLine={vi.fn()}
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Edit INV-101" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove INV-101" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Line" })).not.toBeInTheDocument();
  });

  it("disables protected line edit and delete actions with the protected tooltip", () => {
    render(
      <StatementLinesPanel
        lines={lines}
        draft={{ invoiceNumber: "", date: "", amount: "", error: null, pending: false }}
        onResolveLine={vi.fn()}
        onDraftChange={vi.fn()}
        onAddLine={vi.fn()}
        canManageLines
        onEditLine={vi.fn()}
        onDeleteLine={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Edit INV-100" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove INV-100" })).toBeDisabled();
    expect(screen.getAllByTitle("Unmatch this line before editing")).toHaveLength(2);
  });

  it("edits a statement line with only changed fields and blocks empty edits", async () => {
    const user = userEvent.setup();
    const onEditLine = vi.fn().mockResolvedValue(undefined);

    render(
      <StatementLinesPanel
        lines={lines}
        draft={{ invoiceNumber: "", date: "", amount: "", error: null, pending: false }}
        onResolveLine={vi.fn()}
        onDraftChange={vi.fn()}
        onAddLine={vi.fn()}
        canManageLines
        onEditLine={onEditLine}
        onDeleteLine={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit INV-101" }));
    await user.click(screen.getByRole("button", { name: "Save changes for INV-101" }));
    expect(await screen.findByText("Change at least one field before saving.")).toBeInTheDocument();
    expect(onEditLine).not.toHaveBeenCalled();

    await user.clear(screen.getAllByLabelText("Invoice number")[0]);
    await user.type(screen.getAllByLabelText("Invoice number")[0], "INV-202");
    await user.click(screen.getByRole("button", { name: "Save changes for INV-101" }));

    expect(onEditLine).toHaveBeenCalledWith(
      "line-2",
      { invoiceNumber: "INV-202" },
      expect.objectContaining({ id: "line-2" }),
    );
  });

  it("confirms delete with the line identity before removing", async () => {
    const user = userEvent.setup();
    const onDeleteLine = vi.fn().mockResolvedValue(undefined);

    render(
      <StatementLinesPanel
        lines={lines}
        draft={{ invoiceNumber: "", date: "", amount: "", error: null, pending: false }}
        onResolveLine={vi.fn()}
        onDraftChange={vi.fn()}
        onAddLine={vi.fn()}
        canManageLines
        onEditLine={vi.fn()}
        onDeleteLine={onDeleteLine}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove INV-101" }));
    expect(screen.getByText("Remove INV-101 ($200.00)?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onDeleteLine).toHaveBeenCalledWith(expect.objectContaining({ id: "line-2" }));
  });
});
