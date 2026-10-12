import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useClassifications: () => ({
    classifications: [
      { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
      { name: "receipt", label: "Receipt", opensAs: "receipt", action: "extract-match", builtIn: true, status: "active" },
      { name: "coi", label: "Certificate of Insurance", opensAs: "coi", action: "view-only", builtIn: true, status: "active" },
      { name: "w9", label: "W-9", opensAs: "w9", action: "view-only", builtIn: true, status: "active" },
    ],
    isLoading: false,
  }),
}));

import { StaleCleanupSection } from "@/modules/accounting/modules/invoices/components/settings/StaleCleanupSection";

describe("StaleCleanupSection", () => {
  it("toggles wildcard cleanup state without allowing wildcard delete", async () => {
    const user = userEvent.setup();
    render(<StaleCleanupSection />);

    expect(screen.getByTitle("Default cleanup rule cannot be deleted")).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "* stale cleanup enabled" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("blocks duplicate stale cleanup rows by classification", async () => {
    const user = userEvent.setup();
    render(<StaleCleanupSection />);

    await user.click(screen.getByRole("button", { name: "Add Rule" }));
    await user.selectOptions(screen.getByLabelText("Classification"), "coi");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("A stale cleanup rule for this classification already exists.")).toBeInTheDocument();
  });

  it("clamps locally added stale cleanup days to one", async () => {
    const user = userEvent.setup();
    render(<StaleCleanupSection />);

    await user.click(screen.getByRole("button", { name: "Add Rule" }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Receipt")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });
});
