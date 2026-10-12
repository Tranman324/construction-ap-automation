import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { expectDomOrder, expectNoPositiveTabIndex } from "../tabOrderAssertions";

const invoice = {
  id: "waiver-1",
  file: "waiver.pdf",
  status: "pending",
  queuedAt: "2026-09-01T12:00:00.000Z",
  email: { from: "vendor@example.com", subject: "Waiver", receivedAt: "2026-09-01T12:00:00.000Z" },
  matching: { vendor: { vendorCode: "V-1", vendorName: "Vendor" }, job: { jobNumber: "25-401", jobDescription: "Job" } },
  extracted: { amount: 125 },
} as never;

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useInvoice: () => ({ data: invoice, isLoading: false }),
  useVendorSearch: () => ({ data: [{ code: "V-1", name: "Vendor" }], isLoading: false }),
  useJobSearch: () => ({ data: [{ number: "25-401", description: "Job", address: "" }], isLoading: false }),
  useJobByNumber: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useUpdateInvoice: () => ({ mutate: vi.fn(), isPending: false }),
  useFileDocument: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { LienWaiverEditPanel } from "./LienWaiverEditPanel";

describe("LienWaiverEditPanel", () => {
  describe("edit panel tab order", () => {
    it("keeps close, form fields, and save actions in visual order", () => {
      render(<LienWaiverEditPanel id="waiver-1" onClose={vi.fn()} />);
      const sheet = document.body.querySelector<HTMLElement>('[data-slot="sheet-content"]');
      expect(sheet).not.toBeNull();
      const close = sheet?.querySelector<HTMLButtonElement>('button[data-slot="button"] svg.lucide-x')?.closest("button");
      expect(close).not.toBeNull();
      const clearSelections = screen.getAllByRole("button", { name: "Clear selection" });
      expect(clearSelections).toHaveLength(2);
      const order = [
        close as HTMLButtonElement,
        screen.getByRole("combobox", { name: /V-1/ }),
        clearSelections[0],
        screen.getByRole("combobox", { name: /25-401/ }),
        clearSelections[1],
        screen.getByRole("spinbutton"),
        screen.getByRole("button", { name: "Save & Shelve" }),
        screen.getByRole("button", { name: "Save" }),
      ];
      expectDomOrder(order);
      expectNoPositiveTabIndex(document.body);
    });
  });
});
