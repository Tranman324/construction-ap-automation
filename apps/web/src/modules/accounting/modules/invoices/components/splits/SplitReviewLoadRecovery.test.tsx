import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SplitReviewLoadRecovery } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewLoadRecovery";

describe("SplitReviewLoadRecovery", () => {
  it("offers retry and back actions for split document load failures", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onBack = vi.fn();

    render(
      <SplitReviewLoadRecovery
        title="Split document could not be loaded"
        detail="Retry the request or return to the invoice queue."
        retrying={false}
        onRetry={onRetry}
        onBack={onBack}
      />,
    );

    expect(screen.getByText("Split document could not be loaded")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "Back to queue" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
