import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  EmptyWorkspace,
  ErrorWorkspace,
} from "@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceStates";

describe("RulesWorkspaceStates", () => {
  it("calls retry and create callbacks from empty/error states", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onCreate = vi.fn();

    const { rerender } = render(<ErrorWorkspace onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<EmptyWorkspace onCreate={onCreate} />);
    await user.click(screen.getByRole("button", { name: "Create rule" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
