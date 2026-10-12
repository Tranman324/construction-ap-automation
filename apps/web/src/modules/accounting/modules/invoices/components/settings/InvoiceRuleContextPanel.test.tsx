import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", async () => {
  const { SEEDED_RULE_OPTIONS } = await import("@/modules/accounting/modules/invoices/components/settings/ruleOptionsFixture");
  return {
    useRuleOptions: () => ({ data: SEEDED_RULE_OPTIONS, isError: false, isLoading: false }),
  };
});

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import {
  createInvoiceRuleBuilderDraft,
  type RuleBuilderDraft,
} from "@/modules/accounting/modules/invoices/components/settings/ruleBuilderModel";
import { InvoiceRuleContextPanel } from "@/modules/accounting/modules/invoices/components/settings/InvoiceRuleContextPanel";

const invoice: Invoice = {
  id: "inv-1",
  classification: "invoice",
  confidence: 0.94,
  file: "invoice.pdf",
  email: { from: "ap@acme.test", subject: "ACME invoice", receivedAt: "2026-01-01T00:00:00.000Z" },
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
  matching: null,
  overallConfidence: 0.94,
  splitFrom: null,
  duplicateOf: null,
  reason: null,
  error: null,
  reclassifiedFrom: null,
  reclassifiedAt: null,
};

function Harness({ currentInvoice = invoice }: { currentInvoice?: Invoice }) {
  const [draft, setDraft] = useState<RuleBuilderDraft>(() => createInvoiceRuleBuilderDraft(currentInvoice));
  return (
    <>
      <InvoiceRuleContextPanel invoice={currentInvoice} draft={draft} onDraftChange={setDraft} />
      <output data-testid="fields">{draft.criteria.map((criterion) => criterion.field).join(",")}</output>
    </>
  );
}

describe("InvoiceRuleContextPanel", () => {
  it("adds and removes invoice fields as rule criteria", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole("button", { name: /Add Job Number/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Vendor Name" }));
    await user.click(screen.getByRole("button", { name: /Add Amount/ }));

    expect(screen.getByTestId("fields")).toHaveTextContent("classification,amount");
  });

  it("wraps complete sender and subject values instead of truncating them", () => {
    const sender = "accounts-payable-and-contract-administration@very-long-vendor.example";
    const subject = "Invoice 1048 — concrete delivery and approved change order documentation";
    render(
      <Harness
        currentInvoice={{
          ...invoice,
          email: { ...invoice.email, from: sender, subject },
        }}
      />,
    );

    for (const value of [sender, subject]) {
      const element = screen.getByText(value);
      expect(element).toHaveClass("break-words");
      expect(element).not.toHaveClass("truncate");
    }
  });
});
