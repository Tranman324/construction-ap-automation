import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StatusPanel } from "@/modules/shared/components/patterns/StatusPanel";

describe("StatusPanel", () => {
  it("renders an error alert with retry action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <StatusPanel
        tone="error"
        title="Invoices unavailable"
        message="Refresh the queue and try again."
        onAction={onAction}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Invoices unavailable");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(onAction).toHaveBeenCalledOnce();
  });

  it("uses status role for non-error tones", () => {
    render(<StatusPanel tone="success" title="Saved" message="The update completed." />);

    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});
