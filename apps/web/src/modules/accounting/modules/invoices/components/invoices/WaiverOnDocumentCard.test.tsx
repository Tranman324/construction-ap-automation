import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WaiverOnDocumentCard } from "@/modules/accounting/modules/invoices/components/invoices/WaiverOnDocumentCard";

describe("WaiverOnDocumentCard", () => {
  it("renders on-document metadata and calls clear", async () => {
    const user = userEvent.setup();
    const onRevert = vi.fn();

    render(
      <WaiverOnDocumentCard
        waiverOverride={{
          active: true,
          at: "2026-07-03T12:00:00.000Z",
          by: "Dana Donnelly",
        }}
        isSubmitted={false}
        revertPending={false}
        onRevert={onRevert}
      />,
    );

    expect(screen.getByText("Waiver exists on this document")).toBeInTheDocument();
    expect(screen.getByText(/Marked by Dana Donnelly/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(onRevert).toHaveBeenCalledTimes(1);
  });
});
