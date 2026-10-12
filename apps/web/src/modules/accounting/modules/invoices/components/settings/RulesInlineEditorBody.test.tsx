import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RuleDraft } from "@/modules/accounting/modules/invoices/components/settings/ruleWorkspaceModel";

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

import { RulesInlineEditorBody } from "@/modules/accounting/modules/invoices/components/settings/RulesInlineEditorBody";

const initialDraft: RuleDraft = {
  name: "ACME invoices",
  isActive: true,
  stopOnMatch: false,
  criteria: [{ field: "vendor_name", operator: "contains", values: ["ACME"] }],
  actions: [{ type: "set_job", value: "24-001" }],
};

function BodyHarness() {
  const [draft, setDraft] = useState<RuleDraft>(initialDraft);
  return (
    <div>
      <RulesInlineEditorBody draft={draft} isSaving={false} setDraft={setDraft} />
      <output data-testid="stop-state">{String(draft.stopOnMatch)}</output>
      <output data-testid="criteria-count">{draft.criteria.length}</output>
    </div>
  );
}

describe("RulesInlineEditorBody", () => {
  it("updates draft state for run behavior and added criteria", async () => {
    const user = userEvent.setup();
    render(<BodyHarness />);

    await user.click(screen.getByRole("switch", { name: "Stop processing further rules" }));
    await user.click(screen.getByRole("button", { name: "Add criterion" }));

    expect(screen.getByTestId("stop-state")).toHaveTextContent("true");
    expect(screen.getByTestId("criteria-count")).toHaveTextContent("2");
  });
});
