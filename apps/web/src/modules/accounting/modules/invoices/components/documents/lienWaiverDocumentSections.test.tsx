import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  getLienWaiverDocumentSections,
  type LienWaiverSectionFormState,
} from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentSections";
import type { LienWaiverDocumentData } from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentModel";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

vi.mock("@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentViews", () => ({
  LienWaiverDetailsEditor: ({ onVendorCodeChange, onJobNumberChange, onAmountInputChange, onThroughDateChange, onWaiverTypeChange }: {
    onVendorCodeChange: (value: string | null) => void;
    onJobNumberChange: (value: string | null) => void;
    onAmountInputChange: (value: string) => void;
    onThroughDateChange: (value: string) => void;
    onWaiverTypeChange: (value: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onVendorCodeChange("V200")}>change claimant</button>
      <button type="button" onClick={() => onJobNumberChange("24-020")}>change job</button>
      <button type="button" onClick={() => onAmountInputChange("2750")}>change amount</button>
      <button type="button" onClick={() => onThroughDateChange("2026-06-30")}>change through date</button>
      <button type="button" onClick={() => onWaiverTypeChange("Unconditional final waiver")}>change waiver type</button>
    </div>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/LienWaiverPairingPanel", () => ({
  LienWaiverPairingPanel: ({ onLinkedInvoiceChange, onLinkComplete }: { onLinkedInvoiceChange: (value: string | null) => void; onLinkComplete?: () => void }) => (
    <button type="button" onClick={() => { onLinkedInvoiceChange("invoice-2"); onLinkComplete?.(); }}>pair invoice</button>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/DestinationPicker", () => ({
  DestinationPicker: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange("04 Closeout / Warranties")}>change destination</button>
  ),
}));

const record = {
  id: "waiver-1", classification: "lien-waiver", confidence: 0.9, file: "waiver.pdf",
  email: { from: "apex@example.com", subject: "Waiver", receivedAt: "2026-06-14T12:00:00.000Z" },
  status: "pending", queuedAt: "2026-06-14T12:00:00.000Z", extracted: null, matching: null,
  overallConfidence: 0.9, splitFrom: null, duplicateOf: null, reason: null, error: null,
  reclassifiedFrom: null, reclassifiedAt: null,
} satisfies Invoice;

const data: LienWaiverDocumentData = {
  claimant: "Apex Concrete", vendorCode: "V100", vendorName: "Apex Concrete",
  jobNumber: "24-017", jobName: "North Tower", jobLabel: "24-017 / North Tower",
  amount: 2400, amountInput: "2400", throughDate: "2026-05-31", fileName: "waiver.pdf",
  waiverNumber: "LW-100", waiverType: "Conditional progress waiver", linkedInvoiceId: null,
  paired: false, shelved: false, released: false,
};

const form: LienWaiverSectionFormState = {
  filename: "",
  vendorCode: "V100", jobNumber: "24-017", amountInput: "2400", throughDate: "2026-05-31", waiverType: "Conditional progress waiver",
  savedVendorCode: "V100", savedJobNumber: "24-017", savedAmountInput: "2400", savedThroughDate: "2026-05-31", savedWaiverType: "Conditional progress waiver",
  linkedInvoiceId: null, destination: "02 Financials / Lien Waivers", holdReason: "",
  released: false, filing: false, holding: false,
};

describe("getLienWaiverDocumentSections", () => {
  it("builds one continuous reference-aligned flow and forwards pair-owned patches", async () => {
    const user = userEvent.setup();
    const patchForm = vi.fn();
    const onLinkComplete = vi.fn();
    const sections = getLienWaiverDocumentSections({ record, data, form, dirty: true, paired: false, patchForm, onLinkComplete });

    expect(sections.map((section) => section.title)).toEqual(["Waiver Details", "Pair to Invoice", "File To"]);
    expect(sections.every((section) => section.tabId === undefined)).toBe(true);
    expect(sections.filter((section) => section.flagged).map((section) => section.id)).toEqual(["details", "pairing"]);

    render(<>{sections.map((section) => <div key={section.id}>{section.children}</div>)}</>);
    expect(screen.getByText(/Suggested invoices this waiver releases/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "change claimant" }));
    await user.click(screen.getByRole("button", { name: "change job" }));
    await user.click(screen.getByRole("button", { name: "change amount" }));
    await user.click(screen.getByRole("button", { name: "change through date" }));
    await user.click(screen.getByRole("button", { name: "change waiver type" }));
    await user.click(screen.getByRole("button", { name: "pair invoice" }));
    await user.click(screen.getByRole("button", { name: "change destination" }));

    expect(patchForm).toHaveBeenCalledWith({ vendorCode: "V200" });
    expect(patchForm).toHaveBeenCalledWith({ jobNumber: "24-020" });
    expect(patchForm).toHaveBeenCalledWith({ amountInput: "2750" });
    expect(patchForm).toHaveBeenCalledWith({ throughDate: "2026-06-30" });
    expect(patchForm).toHaveBeenCalledWith({ waiverType: "Unconditional final waiver" });
    expect(patchForm).toHaveBeenCalledWith({ linkedInvoiceId: "invoice-2" });
    expect(onLinkComplete).toHaveBeenCalledTimes(1);
    expect(patchForm).toHaveBeenCalledWith({ destination: "04 Closeout / Warranties" });
  });
});
