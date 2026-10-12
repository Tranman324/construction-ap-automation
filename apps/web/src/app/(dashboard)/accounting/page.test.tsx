import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";

const PM = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: PM.replace }),
}));

import AccountingPage from "@/app/(dashboard)/accounting/page";

describe("AccountingPage", () => {
  beforeEach(() => {
    PM.replace.mockReset();
  });

  it("redirects the accounting root to /accounting/invoices", async () => {
    render(React.createElement(AccountingPage));

    await waitFor(() => {
      expect(PM.replace).toHaveBeenCalledWith("/accounting/invoices");
    });
  });
});
