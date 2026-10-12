import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OPTIONS = vi.hoisted(() => ({ isError: false, isLoading: false }));
vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useRuleOptions: () => ({ data: { fields: [{ value: "vendor_code", label: "vendor code" }], actions: [], operators: [], statuses: [] }, ...OPTIONS }),
}));

import { RuleOverlapWarning } from "@/modules/accounting/modules/invoices/components/settings/RuleOverlapWarning";
import type { RuleOverlap } from "@/modules/accounting/modules/invoices/components/settings/ruleIntelligence";

const overlap: RuleOverlap = {
  rule: {
    id: "rule-1",
    name: "ACME coding",
    isActive: true,
    order: 1,
    stopOnMatch: true,
    criteria: [{ field: "vendor_code", operator: "equals", values: ["ACME01"] }],
    actions: [{ type: "set_gl_account", value: "5500" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "Dana",
  },
  matchedField: "vendor_code",
  matchedValue: "ACME01",
  actionSummary: "Set GL account 5500",
};

describe("RuleOverlapWarning", () => {
  beforeEach(() => {
    OPTIONS.isError = false;
    OPTIONS.isLoading = false;
  });
  it("renders nothing without overlaps", () => {
    const { container } = render(<RuleOverlapWarning overlaps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a compact advisory with match and action details", () => {
    render(<RuleOverlapWarning overlaps={[overlap]} />);

    expect(screen.getByRole("status")).toHaveTextContent("Similar rules exist");
    expect(screen.getByRole("status")).toHaveTextContent("ACME coding");
    expect(screen.getByRole("status")).toHaveTextContent("vendor code ACME01");
    expect(screen.getByRole("status")).toHaveTextContent("Set GL account 5500");
  });

  it("does not substitute a local field label when served rule options fail", () => {
    OPTIONS.isError = true;
    render(<RuleOverlapWarning overlaps={[overlap]} />);

    expect(screen.getByRole("status")).toHaveTextContent("Rule fields unavailable");
    expect(screen.queryByText(/vendor code ACME01/)).not.toBeInTheDocument();
  });
});
