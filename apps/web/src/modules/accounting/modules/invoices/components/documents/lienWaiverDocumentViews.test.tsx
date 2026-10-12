import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LienWaiverDetailsEditor } from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentViews";
import type { LienWaiverDocumentData } from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentModel";

vi.mock("@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown", () => ({
  VendorDropdown: ({ value, onChange, disabled, isManual }: { value: string | null; onChange: (value: string | null) => void; disabled?: boolean; isManual?: boolean }) => (
    <button type="button" data-manual={String(Boolean(isManual))} disabled={disabled} onClick={() => onChange("V200")}>Vendor {value ?? "none"}</button>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown", () => ({
  JobDropdown: ({ value, onChange, disabled, isManual }: { value: string | null; onChange: (value: string | null) => void; disabled?: boolean; isManual?: boolean }) => (
    <button type="button" data-manual={String(Boolean(isManual))} disabled={disabled} onClick={() => onChange("24-200")}>Job {value ?? "none"}</button>
  ),
}));

const data: LienWaiverDocumentData = {
  claimant: "Lakeside Glass & Mirror",
  vendorCode: "ATL100",
  vendorName: "Lakeside Glass & Mirror",
  jobNumber: "23-1147",
  jobName: "Pemberton Tower TI",
  jobLabel: "23-1147 / Pemberton Tower TI",
  amount: 42180,
  amountInput: "42180",
  throughDate: "2026-05-31",
  fileName: "WVR-48571.pdf",
  waiverNumber: "WVR-48571",
  waiverType: "Conditional progress waiver",
  linkedInvoiceId: null,
  paired: false,
  shelved: false,
  released: false,
};

const savedSnapshot = {
  vendorCode: "ATL100",
  jobNumber: "23-1147",
  amountInput: "42180",
  throughDate: "2026-05-31",
  waiverType: "Conditional progress waiver",
};

describe("LienWaiverDetailsEditor", () => {
  it("renders invoice-style editable waiver controls", async () => {
    const user = userEvent.setup();
    const onWaiverTypeChange = vi.fn();
    const onVendorCodeChange = vi.fn();
    const onJobNumberChange = vi.fn();
    const onAmountInputChange = vi.fn();
    const onThroughDateChange = vi.fn();

    render(
      <LienWaiverDetailsEditor
        data={data}
        vendorCode="ATL100"
        jobNumber="23-1147"
        amountInput="42180"
        throughDate="2026-05-31"
        waiverType="Conditional progress waiver"
        savedSnapshot={savedSnapshot}
        onVendorCodeChange={onVendorCodeChange}
        onJobNumberChange={onJobNumberChange}
        onAmountInputChange={onAmountInputChange}
        onThroughDateChange={onThroughDateChange}
        onWaiverTypeChange={onWaiverTypeChange}
      />,
    );

    expect(screen.queryByText("Edited")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claimant" })).toHaveTextContent("Vendor ATL100");
    expect(screen.getByRole("button", { name: "Job" })).toHaveTextContent("Job 23-1147");
    expect(screen.getByLabelText("Through date")).toHaveValue("2026-05-31");
    expect(screen.getByLabelText("Amount")).toHaveValue("42180");

    const waiverTypeSelect = screen.getByRole("combobox", { name: /Waiver type/i });
    const throughDateField = screen.getByLabelText("Through date").closest("label");
    const amountField = screen.getByLabelText("Amount").closest("label");
    expect(waiverTypeSelect.closest("label")).toHaveClass("flex", "gap-[7px]");
    expect(waiverTypeSelect).toHaveClass("h-9", "bg-transparent", "text-foreground");
    expect(throughDateField?.parentElement).toHaveClass("grid", "gap-3", "sm:grid-cols-2");
    expect(amountField?.parentElement).toBe(throughDateField?.parentElement);
    await user.click(screen.getByRole("button", { name: "Claimant" }));
    await user.click(screen.getByRole("button", { name: "Job" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "43000" } });
    fireEvent.change(screen.getByLabelText("Through date"), { target: { value: "2026-06-30" } });
    await user.selectOptions(waiverTypeSelect, "Unconditional final waiver");
    expect(onVendorCodeChange).toHaveBeenCalledWith("V200");
    expect(onJobNumberChange).toHaveBeenCalledWith("24-200");
    expect(onAmountInputChange).toHaveBeenLastCalledWith("43000");
    expect(onThroughDateChange).toHaveBeenLastCalledWith("2026-06-30");
    expect(onWaiverTypeChange).toHaveBeenCalledWith("Unconditional final waiver");
  });

  it("marks only the field whose draft differs from its saved value", () => {
    render(
      <LienWaiverDetailsEditor
        data={data}
        vendorCode="ATL100"
        jobNumber="23-1147"
        amountInput="43000"
        throughDate="2026-05-31"
        waiverType="Conditional progress waiver"
        savedSnapshot={savedSnapshot}
        onVendorCodeChange={vi.fn()}
        onJobNumberChange={vi.fn()}
        onAmountInputChange={vi.fn()}
        onThroughDateChange={vi.fn()}
        onWaiverTypeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Claimant" })).toHaveAttribute("data-manual", "false");
    expect(screen.getByRole("button", { name: "Job" })).toHaveAttribute("data-manual", "false");
    expect(screen.queryByText("Edited")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toHaveValue("43000");
  });

  it("keeps an emptied changed amount visibly pending", () => {
    render(
      <LienWaiverDetailsEditor
        data={data} vendorCode="ATL100" jobNumber="23-1147" amountInput="" throughDate="2026-05-31"
        waiverType="Conditional progress waiver" savedSnapshot={savedSnapshot} onVendorCodeChange={vi.fn()} onJobNumberChange={vi.fn()}
        onAmountInputChange={vi.fn()} onThroughDateChange={vi.fn()} onWaiverTypeChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid numeric amount");
    expect(screen.getByLabelText("Amount")).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps every detail control visible but disabled without edit authority", () => {
    render(
      <LienWaiverDetailsEditor
        data={data} vendorCode="ATL100" jobNumber="23-1147" amountInput="42180" throughDate="2026-05-31"
        waiverType="Conditional progress waiver" savedSnapshot={savedSnapshot} disabled onVendorCodeChange={vi.fn()} onJobNumberChange={vi.fn()}
        onAmountInputChange={vi.fn()} onThroughDateChange={vi.fn()} onWaiverTypeChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Claimant" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Job" })).toBeDisabled();
    expect(screen.getByLabelText("Through date")).toBeDisabled();
    expect(screen.getByLabelText("Amount")).toBeDisabled();
    expect(screen.getByLabelText("Waiver type")).toBeDisabled();
  });
});
