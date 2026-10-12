import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RuleBuilderDraft } from "@/modules/accounting/modules/invoices/components/settings/ruleBuilderModel";
import { RuleBuilderRunOptions } from "@/modules/accounting/modules/invoices/components/settings/RuleBuilderRunOptions";

const initialDraft: RuleBuilderDraft = {
  name: "Rule",
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
      <RuleBuilderRunOptions draft={draft} onDraftChange={setDraft} />
      <output data-testid="apply-existing">{String(draft.applyExisting)}</output>
    </>
  );
}

describe("RuleBuilderRunOptions", () => {
  it("updates the apply-to-existing option", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("switch", { name: "Apply to existing invoices" }));

    expect(screen.getByTestId("apply-existing")).toHaveTextContent("false");
  });
});
