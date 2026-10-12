import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Rule } from "@/modules/accounting/modules/invoices/types/rules";

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown", () => ({
  JobDropdown: ({ value }: { value: string | null }) => <div>{value}</div>,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", async () => {
  const { SEEDED_RULE_OPTIONS } = await import("@/modules/accounting/modules/invoices/components/settings/ruleOptionsFixture");
  return {
    useRuleOptions: () => ({ data: SEEDED_RULE_OPTIONS, isError: false, isLoading: false }),
    useClassifications: () => ({
      classifications: [
        { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
        { name: "receipt", label: "Receipt", opensAs: "receipt", action: "extract-match", builtIn: true, status: "active" },
      ],
      isLoading: false,
    }),
  };
});

import { RulesInlineEditorPane } from "@/modules/accounting/modules/invoices/components/settings/RulesInlineEditorPane";

const rule: Rule = {
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
};

describe("RulesInlineEditorPane", () => {
  it("saves an edited draft as a rule update payload", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <RulesInlineEditorPane
        rule={rule}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );

    const nameInput = screen.getByRole("textbox", { name: "Rule name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Updated ACME invoices");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSave).toHaveBeenCalledWith(rule, expect.objectContaining({
      name: "Updated ACME invoices",
      isActive: true,
      criteria: rule.criteria,
      actions: rule.actions,
    }));
  });

  it("requires confirmation before deleting", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(
      <RulesInlineEditorPane
        rule={rule}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onDelete).toHaveBeenCalledWith(rule);
  });
});
