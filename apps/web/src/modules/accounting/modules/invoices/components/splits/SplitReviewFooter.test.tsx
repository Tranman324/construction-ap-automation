import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SplitReviewFooter } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewFooter";

vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("SplitReviewFooter", () => {
  it("shows validation state and wires actions", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onTreatAsSingleDocument = vi.fn();
    const onCancel = vi.fn();

    render(
      <SplitReviewFooter
        valid
        firstError={null}
        unassignedCount={0}
        groupCount={2}
        isMutating={false}
        confirmPending={false}
        confirmError={null}
        onTreatAsSingleDocument={onTreatAsSingleDocument}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Treat as single doc" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Confirm Split (2)" }));
    expect(onTreatAsSingleDocument).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Reject PDF" })).not.toBeInTheDocument();
  });

  it("disables confirm and shows errors", () => {
    render(
      <SplitReviewFooter
        valid={false}
        firstError="Unassigned pages: 2"
        unassignedCount={1}
        groupCount={1}
        isMutating={false}
        confirmPending={false}
        confirmError="Could not confirm"
        onTreatAsSingleDocument={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText("Unassigned pages: 2")).toBeInTheDocument();
    expect(screen.getByText("Could not confirm")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Split (1)" })).toBeDisabled();
  });
});
