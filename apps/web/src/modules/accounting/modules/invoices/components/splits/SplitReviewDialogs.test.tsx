import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SplitReviewDialogs } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewDialogs";

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

describe("SplitReviewDialogs", () => {
  it("confirms treating the PDF as a single document", async () => {
    const user = userEvent.setup();
    const onConfirmSingleDocument = vi.fn();

    render(
      <SplitReviewDialogs
        singleDocumentOpen
        singleDocumentPending={false}
        onSingleDocumentOpenChange={vi.fn()}
        onConfirmSingleDocument={onConfirmSingleDocument}
      />,
    );

    expect(screen.getByText("Treat as single document?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onConfirmSingleDocument).toHaveBeenCalledTimes(1);
  });
});
