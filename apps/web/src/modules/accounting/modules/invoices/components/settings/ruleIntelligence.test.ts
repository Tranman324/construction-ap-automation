import { describe, expect, it } from "vitest";

import { findOverlappingRules } from "@/modules/accounting/modules/invoices/components/settings/ruleIntelligence";
import { ruleLabelMapsFromOptions } from "@/modules/accounting/modules/invoices/components/settings/ruleLabels";
import { SEEDED_RULE_OPTIONS } from "@/modules/accounting/modules/invoices/components/settings/ruleOptionsFixture";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { Rule, RuleCriterion } from "@/modules/accounting/modules/invoices/types/rules";

const labels = ruleLabelMapsFromOptions(SEEDED_RULE_OPTIONS);

const invoice: Invoice = {
  id: "inv-1",
  classification: "invoice",
  confidence: 0.96,
  file: "invoice.pdf",
  email: { from: "docket@docket.example", subject: "ACME invoice", receivedAt: "2026-01-01T00:00:00.000Z" },
  status: "pending",
  queuedAt: "2026-01-01T00:00:00.000Z",
  extracted: {
    vendorName: "ACME Concrete",
    vendorAddress: null,
    invoiceNumber: "1048",
    invoiceDate: null,
    dueDate: null,
    amount: 2840.12,
    jobNumber: "24-101",
    projectName: null,
    description: null,
    lineItems: [],
  },
  matching: {
    vendor: { vendorCode: "ACME01", vendorName: "ACME Concrete", confidence: 0.98, method: "exact" },
    job: null,
    subcontract: null,
    sourceInvoiceTotal: null,
  },
  overallConfidence: 0.96,
  splitFrom: null,
  duplicateOf: null,
  reason: null,
  error: null,
  reclassifiedFrom: null,
  reclassifiedAt: null,
};

function makeRule(criteria: RuleCriterion[], overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    name: "ACME coding",
    isActive: true,
    order: 1,
    stopOnMatch: true,
    criteria,
    actions: [{ type: "set_gl_account", value: "5500" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "Dana",
    ...overrides,
  };
}

describe("findOverlappingRules", () => {
  it("finds positive sender and vendor matches while ignoring inactive rules", () => {
    const overlaps = findOverlappingRules(invoice, [
      makeRule([{ field: "email_from", operator: "equals", values: ["docket@docket.example"] }]),
      makeRule(
        [{ field: "vendor_name", operator: "contains", values: ["ACME"] }],
        { id: "inactive", isActive: false },
      ),
    ], labels);

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({
      matchedField: "email_from",
      matchedValue: "docket@docket.example",
      actionSummary: "Set GL account 5500",
    });
  });

  it("excludes negative, nullary, numeric, and unrelated-field operators", () => {
    const noisyCriteria: RuleCriterion[] = [
      { field: "vendor_name", operator: "not_contains", values: ["Beta"] },
      { field: "vendor_name", operator: "not_equals", values: ["Beta Supply"] },
      { field: "vendor_name", operator: "gt", values: ["1"] },
      { field: "email_from", operator: "is_empty", values: [] },
      { field: "email_from", operator: "is_not_empty", values: [] },
      { field: "job_number", operator: "equals", values: ["24-101"] },
    ];

    expect(findOverlappingRules(invoice, [makeRule(noisyCriteria)], labels)).toEqual([]);
  });

  it("deduplicates each rule using vendor code before sender email and vendor name", () => {
    const overlaps = findOverlappingRules(invoice, [makeRule([
      { field: "vendor_name", operator: "equals", values: ["ACME Concrete"] },
      { field: "email_from", operator: "ends_with", values: ["@docket.example"] },
      { field: "vendor_code", operator: "starts_with", values: ["ACME"] },
    ])], labels);

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ matchedField: "vendor_code", matchedValue: "ACME" });
  });

  it("reports only the first OR value that actually matches", () => {
    const overlaps = findOverlappingRules(invoice, [makeRule([
      { field: "vendor_name", operator: "contains", values: ["Beta", "ACME"] },
    ])], labels);

    expect(overlaps[0]?.matchedValue).toBe("ACME");
  });

  it("does not flag an active rule with an unrelated sender or vendor", () => {
    const overlaps = findOverlappingRules(invoice, [makeRule([
      { field: "email_from", operator: "equals", values: ["billing@beta.test"] },
      { field: "vendor_name", operator: "equals", values: ["Beta Supply"] },
    ])], labels);

    expect(overlaps).toEqual([]);
  });

  it("uses clear-aware action formatting in concise summaries", () => {
    const rule = makeRule(
      [{ field: "vendor_code", operator: "equals", values: ["ACME01"] }],
      {
        actions: [
          { type: "set_phase_code", clear: true },
          { type: "set_routing_code", value: "PM" },
        ],
      },
    );

    expect(findOverlappingRules(invoice, [rule], labels)[0]?.actionSummary)
      .toBe("Clear phase code, Set routing code PM");
  });
});
