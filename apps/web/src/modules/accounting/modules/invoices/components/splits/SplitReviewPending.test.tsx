import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SplitReviewPending } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewPending";

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

describe("SplitReviewPending", () => {
  it("shows retry and manual build actions after analysis failure", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <SplitReviewPending
        isAnalyzing={false}
        analyzeError="Timed out"
        onRetry={onRetry}
        onBuildManually={vi.fn()}
      />,
    );

    expect(screen.getByText("Analysis failed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
