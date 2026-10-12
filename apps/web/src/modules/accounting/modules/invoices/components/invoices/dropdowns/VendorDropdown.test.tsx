import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VendorDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown";

const M = vi.hoisted(() => ({ vendors: [] as Array<{ code: string; name: string }> }));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useVendorSearch: () => ({ data: M.vendors, isLoading: false }),
}));

beforeEach(() => {
  M.vendors = [];
});

describe("VendorDropdown", () => {
  it("shows a suggestion-only matching vendor name when no vendor code is selected", () => {
    render(<VendorDropdown value={null} vendorName="Suggested Vendor" onChange={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Suggested Vendor" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Select vendor…" })).not.toBeInTheDocument();
  });
});
