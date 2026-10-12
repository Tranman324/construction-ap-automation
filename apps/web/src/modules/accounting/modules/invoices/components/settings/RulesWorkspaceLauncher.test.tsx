import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Rule } from "@/modules/accounting/modules/invoices/types/rules";

const HOOKS = vi.hoisted(() => ({
  rulesData: { rules: [] as Rule[], total: 0 },
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/useRules", () => ({
  useRules: () => ({
    data: HOOKS.rulesData,
    isLoading: false,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceModal", () => ({
  RulesWorkspaceModal: ({ open }: { open: boolean }) => (
    open ? <div role="dialog">Rules workspace opened</div> : null
  ),
}));

import { RulesWorkspaceLauncher } from "@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceLauncher";

describe("RulesWorkspaceLauncher", () => {
  it("shows rule stats and opens the workspace modal", async () => {
    const user = userEvent.setup();
    HOOKS.rulesData = {
      total: 1,
      rules: [{
        id: "rule-a",
        name: "ACME invoices",
        isActive: true,
        order: 0,
        stopOnMatch: false,
        criteria: [],
        actions: [{ type: "hide_from_queue" }],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        createdBy: "Dana",
      }],
    };

    render(<RulesWorkspaceLauncher />);

    expect(screen.getByText("1/1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Rules workspace opened");
  });
});
