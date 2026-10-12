import { describe, expect, it } from "vitest";

import type { Rule } from "@/modules/accounting/modules/invoices/types/rules";
import {
  buildRuleWorkspaceStats,
  createRuleDraft,
  formatCriterion,
  formatAction,
  formatRuleSummary,
  moveRuleIds,
  sortRulesByOrder,
  toRuleUpdatePayload,
} from "@/modules/accounting/modules/invoices/components/settings/ruleWorkspaceModel";
import { ruleLabelMapsFromOptions } from "@/modules/accounting/modules/invoices/components/settings/ruleLabels";
import { SEEDED_RULE_OPTIONS } from "@/modules/accounting/modules/invoices/components/settings/ruleOptionsFixture";

const labels = ruleLabelMapsFromOptions(SEEDED_RULE_OPTIONS);

const rules: Rule[] = [
  {
    id: "rule-b",
    name: "Route waivers",
    isActive: false,
    order: 2,
    stopOnMatch: true,
    criteria: [{ field: "classification", operator: "equals", values: ["lien-waiver"] }],
    actions: [{ type: "auto_file" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    createdBy: "Dana",
  },
  {
    id: "rule-a",
    name: "ACME invoices",
    isActive: true,
    order: 1,
    stopOnMatch: false,
    criteria: [{ field: "vendor_name", operator: "contains", values: ["ACME"] }],
    actions: [{ type: "set_job", value: "24-001" }, { type: "flag" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    createdBy: "the product owner",
  },
];

describe("ruleWorkspaceModel", () => {
  it("sorts rules, computes stats, and produces reorder ids", () => {
    expect(sortRulesByOrder(rules).map((rule) => rule.id)).toEqual(["rule-a", "rule-b"]);
    expect(moveRuleIds(rules, "rule-a", "down")).toEqual(["rule-b", "rule-a"]);
    expect(buildRuleWorkspaceStats(rules)).toMatchObject({
      total: 2,
      active: 1,
      disabled: 1,
      stopOnMatch: 1,
      actionCount: 3,
      latestUpdatedAt: "2026-01-03T00:00:00.000Z",
    });
  });

  it("formats criteria and clones editable drafts without mutating source rules", () => {
    const draft = createRuleDraft(rules[1]);
    draft.criteria[0].values[0] = "Changed";

    expect(rules[1].criteria[0].values[0]).toBe("ACME");
    expect(formatCriterion(rules[1].criteria[0], labels)).toEqual({
      lead: "Vendor Name contains",
      value: "ACME",
      isMono: false,
    });
    expect(formatRuleSummary(rules[1], labels)).toContain("Vendor Name contains ACME");
    expect(toRuleUpdatePayload(draft)).toMatchObject({
      name: "ACME invoices",
      isActive: true,
      criteria: [{ field: "vendor_name", operator: "contains", values: ["Changed"] }],
    });
  });

  it("formats cleared setters as explicit clear actions", () => {
    const action = { type: "set_phase_code" as const, clear: true };
    expect(formatAction(action, labels)).toMatchObject({
      label: "Clear phase code",
      value: null,
      tone: "muted",
    });
    expect(formatRuleSummary({ ...rules[1], actions: [action] }, labels)).toContain("Clear phase code");
  });
});
