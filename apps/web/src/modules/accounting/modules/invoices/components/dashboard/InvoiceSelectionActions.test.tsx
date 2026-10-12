import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/accounting/modules/invoices/components/invoices/BulkActionBar", () => ({
  BulkActionBar: ({
    mode,
    selectedIds,
    showTrash,
    submitAction,
  }: {
    mode?: string;
    selectedIds: string[];
    showTrash?: boolean;
    submitAction?: React.ReactNode;
  }) => (
    <div>
      <span>{mode}</span>
      <span>{showTrash ? "trash enabled" : "trash disabled"}</span>
      <span>{selectedIds.join(",")}</span>
      {submitAction}
    </div>
  ),
}));

import { InvoiceSelectionActions } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceSelectionActions";

describe("InvoiceSelectionActions", () => {
  it("configures selected invoice actions for the dashboard selection bar", () => {
    render(
      <InvoiceSelectionActions
        selectedIds={["inv-1"]}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText("inline-actions")).toBeInTheDocument();
    expect(screen.getByText("trash enabled")).toBeInTheDocument();
    expect(screen.getByText("inv-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
  });
});
