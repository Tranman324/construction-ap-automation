import { describe, expect, it } from "vitest";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { RuleBuilderDraft } from "@/modules/accounting/modules/invoices/components/settings/ruleBuilderModel";
import { buildRulePreview } from "@/modules/accounting/modules/invoices/components/settings/rulePreviewModel";

function makeInvoice(id: string, vendorName: string): Invoice {
  return {
    id,
    classification: "invoice",
    confidence: 0.9,
    file: `${id}.pdf`,
    email: { from: "ap@test.invalid", subject: "Invoice", receivedAt: "2026-01-01T00:00:00.000Z" },
    status: "pending",
    queuedAt: "2026-01-01T00:00:00.000Z",
    extracted: {
      vendorName,
      vendorAddress: null,
      invoiceNumber: id.toUpperCase(),
      invoiceDate: null,
      dueDate: null,
      amount: 100,
      jobNumber: "24-101",
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: null,
    overallConfidence: 0.9,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

const draft: RuleBuilderDraft = {
  name: "ACME rule",
  isActive: true,
  stopOnMatch: true,
  applyExisting: true,
  applyScope: "pending",
  placement: "bottom",
  criteria: [{ field: "vendor_name", operator: "equals", values: ["ACME Concrete"] }],
  actions: [{ type: "flag" }],
};

describe("rulePreviewModel", () => {
  it("matches real invoice data when criteria are evaluable", () => {
    const preview = buildRulePreview(draft, [
      makeInvoice("inv-1", "ACME Concrete"),
      makeInvoice("inv-2", "Beta Supply"),
    ]);

    expect(preview.kind).toBe("real");
    expect(preview.matchCount).toBe(1);
    expect(preview.rows[0]).toMatchObject({ vendorName: "ACME Concrete", invoiceNumber: "INV-1" });
  });

  it("uses examples only when data or criteria are unavailable", () => {
    expect(buildRulePreview(draft, [])).toMatchObject({ kind: "placeholder", matchCount: 3 });
    expect(buildRulePreview({ ...draft, criteria: [{ field: "vendor_name", operator: "contains", values: [""] }] }, [makeInvoice("inv-1", "ACME Concrete")])).toMatchObject({
      kind: "placeholder",
      matchCount: 3,
    });
  });

  it("returns a real empty state when loaded invoices do not match", () => {
    const preview = buildRulePreview(draft, [makeInvoice("inv-2", "Beta Supply")]);

    expect(preview.kind).toBe("empty");
    expect(preview.matchCount).toBe(0);
    expect(preview.rows).toEqual([]);
  });
});
