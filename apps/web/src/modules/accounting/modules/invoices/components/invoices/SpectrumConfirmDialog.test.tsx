import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Evidence } from "../documents/resolveCardModel";
import { SpectrumConfirmDialog } from "./SpectrumConfirmDialog";

type Compare = Extract<Evidence, { layout: "compare" }>;

/** Literal output of the builder for the content-spec F-SPEC fixture. */
const SPEC_EVIDENCE: Compare = {
  layout: "compare",
  columns: ["This invoice", "In Spectrum · Unpaid (open items)"],
  rows: [
    { label: "Vendor", a: { kind: "mono", value: "ZCON92" }, b: { kind: "mono", value: "ZCON92" } },
    { label: "Invoice #", a: { kind: "mono", value: "25-907", note: "→ 25907" }, b: { kind: "mono", value: "25-907" } },
    { label: "Amount", a: { kind: "money", value: 9642 }, b: { kind: "money", value: 9642 }, differs: false },
  ],
};

/** Literal output of the builder for F-SUB (Submitted from Toolbox, no Spectrum record). */
const SUB_EVIDENCE: Compare = {
  layout: "compare",
  columns: ["This invoice", "In Spectrum · Submitted from Toolbox"],
  rows: [
    { label: "Vendor", a: { kind: "mono", value: "VANT01" }, b: { kind: "mono", value: "VANT01" } },
    { label: "Invoice #", a: { kind: "mono", value: "53477" }, b: { kind: "mono", value: "53477" } },
    { label: "Amount", a: { kind: "money", value: 74877 }, b: { kind: "money", value: 74877 }, differs: false },
  ],
};

function setup(overrides: Partial<Parameters<typeof SpectrumConfirmDialog>[0]> = {}) {
  const onDiscard = vi.fn();
  const onOpenChange = vi.fn();
  render(<SpectrumConfirmDialog open evidence={SPEC_EVIDENCE} onDiscard={onDiscard} onOpenChange={onOpenChange} {...overrides} />);
  return { onDiscard, onOpenChange };
}

describe("SpectrumConfirmDialog", () => {
  it("shows the section 13.4 title and body (DLG-01)", () => {
    setup();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Confirm it's in Spectrum")).toBeInTheDocument();
    expect(within(dialog).getByText("Check these against Spectrum before discarding. The discard reason is written automatically from them.")).toBeInTheDocument();
  });

  it("offers Discard duplicate and Cancel, not the old confirm label (DLG-02)", () => {
    setup();
    expect(screen.getByRole("button", { name: "Discard duplicate" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmed in Spectrum — Discard" })).toBeNull();
  });

  it("renders the compact facts with three rows and no File row (DLG-03)", () => {
    setup();
    const facts = screen.getByTestId("spectrum-confirm-facts");
    expect(facts).toHaveAttribute("data-tone", "blocking");
    const labels = within(facts).getAllByText(/^(Vendor|Invoice #|Amount|File)$/).map((el) => el.textContent);
    expect(labels).toEqual(["Vendor", "Invoice #", "Amount"]);
    expect(within(facts).getByText("This invoice")).toBeInTheDocument();
    expect(within(facts).getByText("In Spectrum · Unpaid (open items)")).toBeInTheDocument();
    expect(within(facts).getAllByText("ZCON92")).toHaveLength(2);
    expect(within(facts).getAllByText("25-907")).toHaveLength(2);
    expect(within(facts).getAllByText("$9,642.00")).toHaveLength(2);
  });

  it("has no input and no reason preview (DLG-04)", () => {
    setup();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByLabelText(/reason/i)).toBeNull();
    expect(screen.queryByText(/Reason:/)).toBeNull();
    expect(screen.queryByText(/Discarded as duplicate/)).toBeNull();
    expect(screen.queryByText("Confirm in Spectrum")).toBeNull();
  });

  it("confirm calls onDiscard once with no arguments (DLG-05)", async () => {
    const { onDiscard } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Discard duplicate" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledWith();
  });

  it("cancel closes without discarding (DLG-05)", async () => {
    const { onDiscard, onOpenChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables the confirm while pending", async () => {
    const { onDiscard } = setup({ pending: true });
    const confirm = screen.getByRole("button", { name: "Discard duplicate" });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("shows the Submitted from Toolbox heading and the vendor on both sides (DLG-06)", () => {
    setup({ evidence: SUB_EVIDENCE });
    const facts = screen.getByTestId("spectrum-confirm-facts");
    expect(within(facts).getByText("In Spectrum · Submitted from Toolbox")).toBeInTheDocument();
    expect(within(facts).getAllByText("VANT01")).toHaveLength(2);
  });

  it("renders nothing when closed (DLG-08)", () => {
    setup({ open: false });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
