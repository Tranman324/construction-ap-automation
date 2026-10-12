import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InvoiceDashboardErrorState } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceDashboardErrorState";

describe("InvoiceDashboardErrorState", () => {
  it("renders an accessible dashboard error with optional retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <InvoiceDashboardErrorState
        title="Invoices unavailable"
        message="Refresh the queue and try again."
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Invoices unavailable");

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
