import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
    role: "admin",
    isAdmin: true,
    permissions: ["*"],
  }),
}));

import { BulkRejectDialog } from "@/modules/accounting/modules/invoices/components/invoices/BulkRejectDialog";

describe("BulkRejectDialog", () => {
  it("captures an optional reason and confirms rejection", async () => {
    const user = userEvent.setup();
    const onReasonChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <BulkRejectDialog
        count={2}
        error={null}
        isPending={false}
        onConfirm={onConfirm}
        onOpenChange={vi.fn()}
        onReasonChange={onReasonChange}
        open
        reason=""
      />,
    );

    await user.type(screen.getByPlaceholderText(/reason for rejection/i), "Duplicate");
    await user.click(screen.getByRole("button", { name: /^reject 2$/i }));

    expect(onReasonChange).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
