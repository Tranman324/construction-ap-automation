import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SplitReviewHeader } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewHeader";

vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("SplitReviewHeader", () => {
  it("renders document identity and wires header actions", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onAnalyze = vi.fn();

    render(
      <SplitReviewHeader
        fileName="invoice.pdf"
        onBack={onBack}
      />,
    );

    expect(screen.getByText(/invoice.pdf/)).toBeInTheDocument();
    expect(screen.queryByText(/From/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Invoices")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
    expect(onAnalyze).not.toHaveBeenCalled();
  });
});
