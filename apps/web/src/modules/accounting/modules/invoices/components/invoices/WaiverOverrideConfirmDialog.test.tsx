import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WaiverOverrideConfirmDialog } from "@/modules/accounting/modules/invoices/components/invoices/WaiverOverrideConfirmDialog";

describe("WaiverOverrideConfirmDialog", () => {
  it("confirms marking a waiver on the document", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <WaiverOverrideConfirmDialog
        mode="set"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Mark waiver on this document?");

    await user.click(screen.getByRole("button", { name: "Mark waiver" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("labels the clear confirmation separately", () => {
    render(
      <WaiverOverrideConfirmDialog
        mode="revert"
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Clear waiver on this document?");
    expect(screen.getByRole("button", { name: "Clear waiver" })).toBeInTheDocument();
  });
});
