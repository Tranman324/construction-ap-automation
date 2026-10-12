import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const BM = vi.hoisted(() => ({
  permissions: [] as string[],
  bulkActionReturn: {
    mutate: vi.fn(),
    isPending: false,
  },
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: (keys: string[]) =>
      keys.some((key) => BM.permissions.includes("*") || BM.permissions.includes(key)),
    hasAllPermissions: (keys: string[]) =>
      keys.every((key) => BM.permissions.includes("*") || BM.permissions.includes(key)),
    role: null,
    isAdmin: BM.permissions.includes("*"),
    permissions: BM.permissions,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useBulkAction: () => BM.bulkActionReturn,
}));

import { BulkActionBar } from "@/modules/accounting/modules/invoices/components/invoices/BulkActionBar";

describe("BulkActionBar permission gating", () => {
  beforeEach(() => {
    BM.permissions = [];
    BM.bulkActionReturn.isPending = false;
    BM.bulkActionReturn.mutate.mockReset();
  });

  it("does not expose bulk approve or reject actions", () => {
    BM.permissions = ["accounting.invoices.approve", "accounting.invoices.reject"];

    render(<BulkActionBar selectedIds={["inv-1"]} onClear={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /approve all/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject all/i })).not.toBeInTheDocument();
  });

  it("gates Shelve on accounting.invoices.view_details", () => {
    BM.permissions = ["accounting.invoices.view_details"];

    const { rerender } = render(
      <BulkActionBar selectedIds={["inv-1"]} onClear={vi.fn()} />
    );

    expect(screen.getByRole("button", { name: /shelve/i })).toBeInTheDocument();

    BM.permissions = [];
    rerender(
      <BulkActionBar selectedIds={["inv-1"]} onClear={vi.fn()} showTrash />
    );

    expect(screen.queryByRole("button", { name: /file to documents/i })).not.toBeInTheDocument();
  });
});
