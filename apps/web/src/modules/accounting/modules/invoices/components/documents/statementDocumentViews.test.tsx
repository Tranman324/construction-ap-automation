import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StatementDetailsFields } from "@/modules/accounting/modules/invoices/components/documents/statementDocumentViews";
import { PanelNoticeOutlet, PanelNoticeProvider } from "./PanelNotice";

vi.mock("@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown", () => ({
  VendorDropdown: ({ value, vendorName, onChange }: { value: string | null; vendorName?: string | null; onChange: (value: string | null) => void }) => (
    <button type="button" onClick={() => onChange("V200")}>Vendor {value ?? "none"} {vendorName ?? ""}</button>
  ),
}));

describe("statement document detail views", () => {
  it("moves attribute-save errors to the tray and clears them without moving editing controls", () => {
    const fields = (error: string | null) => <StatementDetailsFields
      vendorCode="V100" vendorName="Synthetic Vendor" vendorManual={false}
      statementPeriod="June 2026" statementBalance="100" statementPeriodSource="manual"
      statementBalanceSource="manual" canEditStatementAttributes
      statementAttributeError={error} onVendorCodeChange={vi.fn()}
      onStatementPeriodChange={vi.fn()} onStatementBalanceChange={vi.fn()} />;
    const view = (error: string | null) => <PanelNoticeProvider documentId="statement-1">
      <div data-testid="inline-details">{fields(error)}</div><PanelNoticeOutlet />
    </PanelNoticeProvider>;
    const { rerender } = render(<div data-testid="inline-details">{fields("Synthetic save error")}</div>);
    expect(screen.getByTestId("inline-details")).toContainElement(screen.getByText("Synthetic save error"));
    rerender(view("Synthetic save error"));
    expect(screen.getByTestId("panel-notice-outlet")).toContainElement(screen.getByRole("alert"));
    expect(screen.getAllByText("Synthetic save error")).toHaveLength(1);
    expect(screen.getByTestId("inline-details")).toContainElement(screen.getByLabelText("Statement period"));
    rerender(view(null));
    expect(screen.getByTestId("panel-notice-outlet")).toBeEmptyDOMElement();
  });
  it("renders editable detail fields and vendor context", () => {
    const onVendorCodeChange = vi.fn();
    const onStatementPeriodChange = vi.fn();
    const onStatementBalanceChange = vi.fn();
    const onStatementBalanceBlur = vi.fn();

    const { rerender } = render(
      <StatementDetailsFields
        vendorCode="V100"
        vendorName="Document Vendor"
        vendorManual={false}
        statementPeriod="June 2026"
        statementBalance="1200.50"
        statementPeriodSource="extracted"
        statementBalanceSource="computed"
        canEditStatementAttributes
        onVendorCodeChange={onVendorCodeChange}
        onStatementPeriodChange={onStatementPeriodChange}
        onStatementPeriodBlur={onStatementPeriodChange}
        onStatementBalanceChange={onStatementBalanceChange}
        onStatementBalanceBlur={onStatementBalanceBlur}
      />,
    );

    expect(screen.queryByText("Selected vendor code: V100")).not.toBeInTheDocument();
    expect(screen.queryByText("Document vendor: Document Vendor")).not.toBeInTheDocument();
    expect(screen.queryByText("Extracted")).not.toBeInTheDocument();
    const vendorPicker = screen.getAllByRole("button")
      .find((button) => button.textContent?.trim() === "Vendor V100 Document Vendor");
    expect(vendorPicker).toBeDefined();
    if (!vendorPicker) throw new Error("Expected mocked vendor picker.");
    fireEvent.click(vendorPicker);
    fireEvent.change(screen.getByLabelText("Statement period"), { target: { value: "July 2026" } });
    fireEvent.change(screen.getByLabelText("Statement balance"), { target: { value: "1300" } });
    rerender(
      <StatementDetailsFields
        vendorCode="V100"
        vendorName="Document Vendor"
        vendorManual={false}
        statementPeriod="July 2026"
        statementBalance="1300"
        statementPeriodSource="extracted"
        statementBalanceSource="computed"
        canEditStatementAttributes
        onVendorCodeChange={onVendorCodeChange}
        onStatementPeriodChange={onStatementPeriodChange}
        onStatementPeriodBlur={onStatementPeriodChange}
        onStatementBalanceChange={onStatementBalanceChange}
        onStatementBalanceBlur={onStatementBalanceBlur}
      />,
    );
    fireEvent.blur(screen.getByLabelText("Statement balance"));

    expect(onVendorCodeChange).toHaveBeenCalledWith("V200");
    expect(onStatementPeriodChange).toHaveBeenCalledWith("July 2026");
    expect(onStatementBalanceChange).toHaveBeenCalledWith("1300");
    expect(onStatementBalanceBlur).toHaveBeenCalledWith("1300");
  });

  it("keeps manual controls visible but non-interactive without approve permission", () => {
    render(
      <StatementDetailsFields
        vendorCode="V100"
        vendorName="Document Vendor"
        vendorManual={false}
        statementPeriod="July 2026"
        statementBalance="1300.00"
        statementPeriodSource="manual"
        statementBalanceSource="manual"
        canEditStatementAttributes={false}
        onVendorCodeChange={vi.fn()}
        onStatementPeriodChange={vi.fn()}
        onStatementBalanceChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Statement period")).toBeDisabled();
    expect(screen.getByLabelText("Statement balance")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Clear manual period" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear manual balance" })).not.toBeInTheDocument();
    expect(screen.getByText("You do not have permission to edit statement attributes.")).toBeInTheDocument();
  });

  it("does not fabricate a zero balance when the server provides no balance", () => {
    render(
      <StatementDetailsFields
        vendorCode="V100"
        vendorName="Document Vendor"
        vendorManual={false}
        statementPeriod="June 2026"
        statementBalance=""
        statementPeriodSource="extracted"
        statementBalanceSource="computed"
        canEditStatementAttributes
        onVendorCodeChange={vi.fn()}
        onStatementPeriodChange={vi.fn()}
        onStatementBalanceChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Statement balance")).toHaveValue("");
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });
});
