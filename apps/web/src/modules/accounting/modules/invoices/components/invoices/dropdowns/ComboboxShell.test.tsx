import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ComboboxShell,
  CommandItem,
} from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/ComboboxShell";

function ControlledLockHarness() {
  const [disabled, setDisabled] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setDisabled(true)}>Lock</button>
      <button type="button" onClick={() => setDisabled(false)}>Unlock</button>
      <ComboboxShell
        value={null}
        onSelect={vi.fn()}
        placeholder="Select vendor…"
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
      >
        <CommandItem value="vendor">Vendor</CommandItem>
      </ComboboxShell>
    </>
  );
}

describe("ComboboxShell", () => {
  it("does not reopen a controlled combobox after a lock and unlock transition", async () => {
    const user = userEvent.setup();
    render(<ControlledLockHarness />);

    const combobox = screen.getByRole("combobox", { name: "Select vendor…" });
    await user.click(combobox);
    expect(combobox).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "Lock" }));
    expect(combobox).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "Unlock" }));
    expect(combobox).toHaveAttribute("aria-expanded", "false");
  });
});
