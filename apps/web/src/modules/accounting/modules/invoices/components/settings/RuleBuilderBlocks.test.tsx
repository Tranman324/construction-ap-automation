import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RuleBuilderDraft } from "@/modules/accounting/modules/invoices/components/settings/ruleBuilderModel";

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
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

import { RuleBuilderBlocks } from "@/modules/accounting/modules/invoices/components/settings/RuleBuilderBlocks";

const initialDraft: RuleBuilderDraft = {
  name: "ACME rule",
  isActive: true,
  stopOnMatch: true,
  applyExisting: true,
  applyScope: "pending",
  placement: "bottom",
  criteria: [{ field: "vendor_name", operator: "contains", values: ["ACME"] }],
  actions: [{ type: "flag" }],
};

function Harness() {
  const [draft, setDraft] = useState(initialDraft);
  return (
    <>
      <RuleBuilderBlocks draft={draft} onDraftChange={setDraft} />
      <output data-testid="criteria-count">{draft.criteria.length}</output>
      <output data-testid="rule-name">{draft.name}</output>
    </>
  );
}

describe("RuleBuilderBlocks", () => {
  it("updates name and adds criteria through the builder controls", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const nameInput = screen.getByLabelText("Rule name");
    await user.clear(nameInput);
    await user.type(nameInput, "Concrete rentals");
    await user.click(screen.getByRole("button", { name: "Add criterion" }));

    expect(screen.getByTestId("rule-name")).toHaveTextContent("Concrete rentals");
    expect(screen.getByTestId("criteria-count")).toHaveTextContent("2");
  });
});
