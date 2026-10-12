import { describe, expect, it } from "vitest";

import { retentionStatusOptions } from "@/modules/accounting/modules/invoices/components/settings/retentionPolicyModel";
import { SERVED_CLASSIFICATIONS, SERVED_COST_TYPES, SERVED_RULE_OPTIONS } from "@/modules/accounting/modules/invoices/components/settings/__fixtures__/servedCatalogFixture";

describe("served catalog fixture parity", () => {
  it("pins the classification, rule-field, cost-type, and retention-status values consumed by the rewired surfaces", () => {
    expect(SERVED_CLASSIFICATIONS.find((item) => item.name === "coi")?.label).toBe("COI");
    expect(SERVED_RULE_OPTIONS.fields.map((item) => item.label)).toEqual(["vendor code", "sender email", "vendor name"]);
    expect(SERVED_COST_TYPES.costTypes.find((item) => item.value === "M")?.label).toBe("M - Material");
    expect(retentionStatusOptions(SERVED_RULE_OPTIONS)).toEqual(SERVED_RULE_OPTIONS.statuses);
  });
});
