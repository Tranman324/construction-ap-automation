import { describe, expect, it } from "vitest";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { Rule } from "@/modules/accounting/modules/invoices/types/rules";
import {
  buildInvoiceContextFields,
  createInvoiceRuleBuilderDraft,
  toRuleCreatePayload,
  validateRuleBuilderDraft,
} from "@/modules/accounting/modules/invoices/components/settings/ruleBuilderModel";
import { ruleLabelMapsFromOptions } from "@/modules/accounting/modules/invoices/components/settings/ruleLabels";
import { SEEDED_RULE_OPTIONS } from "@/modules/accounting/modules/invoices/components/settings/ruleOptionsFixture";

const labels = ruleLabelMapsFromOptions(SEEDED_RULE_OPTIONS);

const invoice: Invoice = {
  id: "inv-1",
  classification: "invoice",
  confidence: 0.96,
  file: "invoice.pdf",
  email: { from: "ap@acme.test", subject: "ACME invoice 1048", receivedAt: "2026-01-01T00:00:00.000Z" },
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
    description: "Concrete delivery",
    lineItems: [],
  },
  matching: {
    vendor: { vendorCode: "ACME01", vendorName: "ACME Concrete", confidence: 0.98, method: "exact" },
    job: { jobNumber: "24-101", confidence: 0.95, method: "exact" },
    subcontract: null,
    sourceInvoiceTotal: null,
  },
  overallConfidence: 0.94,
  splitFrom: null,
  duplicateOf: null,
  reason: null,
  error: null,
  reclassifiedFrom: null,
  reclassifiedAt: null,
};

const existingRules: Rule[] = [
  {
    id: "rule-a",
    name: "Existing",
    isActive: true,
    order: 4,
    stopOnMatch: true,
    criteria: [{ field: "vendor_name", operator: "contains", values: ["Existing"] }],
    actions: [{ type: "flag" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "Dana",
  },
];

describe("ruleBuilderModel", () => {
  it("seeds invoice rules with compatible criteria and actions", () => {
    const draft = createInvoiceRuleBuilderDraft(invoice);

    expect(draft.name).toBe("ACME Concrete rule");
    expect(draft.criteria).toEqual([
      { field: "vendor_name", operator: "equals", values: ["ACME Concrete"] },
      { field: "classification", operator: "equals", values: ["invoice"] },
    ]);
    expect(draft.actions).toEqual([
      { type: "set_vendor", value: "ACME01" },
      { type: "set_job", value: "24-101" },
      { type: "set_classification", value: "invoice" },
    ]);
  });

  it("builds context fields and validates incomplete drafts before save", () => {
    const fields = buildInvoiceContextFields(invoice, labels);
    expect(fields.find((field) => field.field === "amount")).toMatchObject({
      label: "Amount ($)",
      display: "$2,840.12",
    });
    expect(fields.find((field) => field.field === "job_number")?.defaultOn).toBe(false);

    const draft = createInvoiceRuleBuilderDraft(invoice);
    draft.name = "";
    draft.actions = [{ type: "set_job", value: "" }];

    expect(validateRuleBuilderDraft(draft, labels).errors).toEqual([
      "Rule name is required.",
      "Every selected action needs its required value.",
    ]);
  });

  it("creates payloads with bottom priority after existing rules", () => {
    const draft = createInvoiceRuleBuilderDraft(invoice);

    expect(toRuleCreatePayload(draft, existingRules)).toMatchObject({
      name: "ACME Concrete rule",
      order: 5,
      isActive: true,
      stopOnMatch: true,
    });
  });

  it("uses the matched vendor name or Invoice fallback without job or invoice numbers", () => {
    const matchedVendorOnly: Invoice = {
      ...invoice,
      extracted: { ...invoice.extracted!, vendorName: null },
    };
    expect(createInvoiceRuleBuilderDraft(matchedVendorOnly).name).toBe("ACME Concrete rule");

    const noVendor: Invoice = { ...matchedVendorOnly, matching: null };
    expect(createInvoiceRuleBuilderDraft(noVendor).name).toBe("Invoice rule");
  });

  it("accepts clear state only for clearable setter actions", () => {
    const draft = createInvoiceRuleBuilderDraft(invoice);
    draft.actions = [{ type: "set_phase_code", clear: true }];
    expect(validateRuleBuilderDraft(draft, labels).errors).toEqual([]);
    expect(toRuleCreatePayload(draft, existingRules).actions).toEqual([
      { type: "set_phase_code", clear: true },
    ]);

    draft.actions = [{ type: "set_classification", clear: true }];
    expect(validateRuleBuilderDraft(draft, labels).errors).toContain("The selected action cannot clear its value.");

    draft.actions = [{ type: "set_phase_code" }];
    expect(validateRuleBuilderDraft(draft, labels).errors).toContain("Every selected action needs its required value.");
  });
});
