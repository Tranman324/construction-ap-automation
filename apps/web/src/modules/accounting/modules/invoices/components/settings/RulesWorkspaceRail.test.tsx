import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Rule } from "@/modules/accounting/modules/invoices/types/rules";

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", async () => {
  const { SEEDED_RULE_OPTIONS } = await import("@/modules/accounting/modules/invoices/components/settings/ruleOptionsFixture");
  return {
    useRuleOptions: () => ({ data: SEEDED_RULE_OPTIONS, isError: false, isLoading: false }),
  };
});

import { RulesWorkspaceRail } from "@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceRail";

const rules: Rule[] = [
  {
    id: "rule-a",
    name: "ACME invoices",
    isActive: true,
    order: 0,
    stopOnMatch: false,
    criteria: [{ field: "vendor_name", operator: "contains", values: ["ACME"] }],
    actions: [{ type: "set_job", value: "24-001" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    createdBy: "Dana",
  },
  {
    id: "rule-b",
    name: "File waivers",
    isActive: false,
    order: 1,
    stopOnMatch: true,
    criteria: [{ field: "classification", operator: "equals", values: ["lien-waiver"] }],
    actions: [{ type: "auto_file" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    createdBy: "Dana",
  },
];

describe("RulesWorkspaceRail", () => {
  it("selects, toggles, and requests priority moves", async () => {
    const user = userEvent.setup();
    const onSelectRule = vi.fn();
    const onToggleRule = vi.fn();
    const onMoveRule = vi.fn();

    render(
      <RulesWorkspaceRail
        rules={rules}
        selectedRuleId="rule-a"
        searchTerm=""
        onSearchTermChange={vi.fn()}
        onSelectRule={onSelectRule}
        onToggleRule={onToggleRule}
        onMoveRule={onMoveRule}
        onDeleteRule={vi.fn()}
        onCreateRule={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select File waivers" }));
    await user.click(screen.getByRole("switch", { name: "File waivers active" }));
    await user.click(screen.getByRole("button", { name: "Move ACME invoices down" }));

    expect(onSelectRule).toHaveBeenCalledWith("rule-b");
    expect(onToggleRule).toHaveBeenCalledWith(rules[1], true);
    expect(onMoveRule).toHaveBeenCalledWith("rule-a", "down");
  });

  it("filters rules by search text", async () => {
    const user = userEvent.setup();

    render(
      <RulesWorkspaceRail
        rules={rules}
        selectedRuleId="rule-a"
        searchTerm="waiver"
        onSearchTermChange={vi.fn()}
        onSelectRule={vi.fn()}
        onToggleRule={vi.fn()}
        onMoveRule={vi.fn()}
        onDeleteRule={vi.fn()}
        onCreateRule={vi.fn()}
      />,
    );

    expect(screen.getByText("File waivers")).toBeInTheDocument();
    expect(screen.queryByText("ACME invoices")).not.toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText("Search rules..."));
  });
});
