import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";

const PM = vi.hoisted(() => ({
  replace: vi.fn(),
  user: {
    isAdmin: false,
    permissions: ["accounting.invoices.view"],
  } as { isAdmin: boolean; permissions: string[] } | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: PM.replace }),
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => ({ user: PM.user }),
}));

import DashboardPage from "@/app/(dashboard)/page";

describe("DashboardPage", () => {
  beforeEach(() => {
    PM.replace.mockReset();
    PM.user = { isAdmin: false, permissions: ["accounting.invoices.view"] };
  });

  it("redirects the dashboard root to the user's permitted default route", async () => {
    render(React.createElement(DashboardPage));

    await waitFor(() => {
      expect(PM.replace).toHaveBeenCalledWith("/accounting/invoices");
    });
  });

  it("redirects zero-permission users to feature requests", async () => {
    PM.user = { isAdmin: false, permissions: [] };
    render(React.createElement(DashboardPage));

    await waitFor(() => {
      expect(PM.replace).toHaveBeenCalledWith("/feature-requests");
    });
  });

  it("waits for the authenticated user before redirecting", async () => {
    PM.user = null;
    render(React.createElement(DashboardPage));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(PM.replace).not.toHaveBeenCalled();
  });
});
