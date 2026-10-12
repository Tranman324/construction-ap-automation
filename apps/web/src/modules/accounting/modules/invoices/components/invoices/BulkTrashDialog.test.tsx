import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BulkTrashDialog } from "@/modules/accounting/modules/invoices/components/invoices/BulkTrashDialog";

describe("BulkTrashDialog", () => {
  it("confirms before discarding selected invoices", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <BulkTrashDialog
        count={2}
        isPending={false}
        onConfirm={onConfirm}
        onOpenChange={vi.fn()}
        open
      />,
    );

    expect(screen.getByRole("dialog")).toHaveTextContent("Discard 2 invoices?");
    expect(screen.getByRole("dialog")).toHaveTextContent("move to the Discarded status");

    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
