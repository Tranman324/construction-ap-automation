import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { RulePreviewResult } from "@/modules/accounting/modules/invoices/components/settings/rulePreviewModel";
import { RulePreviewPane } from "@/modules/accounting/modules/invoices/components/settings/RulePreviewPane";

const preview: RulePreviewResult = {
  kind: "real",
  message: "Matched against invoices currently loaded in the queue.",
  matchCount: 1,
  rows: [
    {
      id: "inv-1",
      vendorName: "ACME Concrete",
      invoiceNumber: "1048",
      jobNumber: "24-101",
      amount: 2840.12,
    },
  ],
};

describe("RulePreviewPane", () => {
  it("renders the live match count and invoice rows", () => {
    render(<RulePreviewPane preview={preview} applyExisting />);

    expect(screen.getByText(/invoices match/)).toBeInTheDocument();
    expect(screen.getByText("ACME Concrete")).toBeInTheDocument();
    expect(screen.getByText("$2,840.12")).toBeInTheDocument();
  });
});
