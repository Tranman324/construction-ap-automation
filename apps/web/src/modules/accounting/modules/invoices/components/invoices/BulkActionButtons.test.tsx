import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BulkActionButtons } from "@/modules/accounting/modules/invoices/components/invoices/BulkActionButtons";

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
    role: "admin",
    isAdmin: true,
    permissions: ["*"],
  }),
}));

describe("BulkActionButtons", () => {
  it("renders the invoice batch action set", () => {
    render(
      <BulkActionButtons
        isPending={false}
        onFileToDocuments={vi.fn()}
        onTrash={vi.fn()}
        onUnapprove={vi.fn()}
        showTrash
        submitAction={<button type="button">Submit</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toHaveAttribute("title", expect.stringContaining("Discard •"));
    expect(screen.queryByRole("button", { name: "Trash" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /shelve/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject all/i })).not.toBeInTheDocument();
  });
});
