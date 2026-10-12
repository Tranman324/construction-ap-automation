import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const TM = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: TM.redirect,
}));

import TrashPage from "@/app/(dashboard)/accounting/trash/page";

describe("TrashPage", () => {
  beforeEach(() => {
    TM.redirect.mockReset();
  });

  it("redirects the legacy route to the inline Trash tab", () => {
    render(<TrashPage />);

    expect(TM.redirect).toHaveBeenCalledWith("/accounting/invoices?status=discarded");
    expect(screen.queryByRole("button", { name: "Back to Queue" })).not.toBeInTheDocument();
  });
});
