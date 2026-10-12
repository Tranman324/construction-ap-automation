import { describe, expect, it } from "vitest";

import {
  getClosedPeriodRecovery,
  getClosedPeriodRecoveryFromDetails,
  getClosedPeriodRecoveryFromError,
} from "@/modules/accounting/modules/invoices/lib/approvalRecovery";

describe("approval recovery", () => {
  const detail = {
    code: "CLOSED_PERIOD_DATE",
    invoiceDateMonth: "July 2026",
    currentMonth: "August 2026",
    suggestedInvoiceDate: "2026-08-01",
    nextAction: "Use the open period date.",
  };
  const recovery = {
    invoiceDateMonth: "July 2026",
    currentMonth: "August 2026",
    suggestedInvoiceDate: "2026-08-01",
    nextAction: "Use the open period date.",
  };

  it("accepts only the structured closed-period code", () => {
    expect(getClosedPeriodRecovery(detail)).toEqual(recovery);
    expect(getClosedPeriodRecovery({ ...detail, code: "OTHER_BLOCKER" })).toBeNull();
    expect(getClosedPeriodRecovery({ ...detail, invoiceDateMonth: undefined })).toBeNull();
  });

  it("uses canonical fields first and only falls back to legacy fields when needed", () => {
    expect(getClosedPeriodRecovery({
      ...detail,
      glDateMonth: "June 2026",
      suggestedGlDate: "2026-07-01",
    })).toEqual(recovery);
    expect(getClosedPeriodRecovery({
      code: "CLOSED_PERIOD_DATE",
      glDateMonth: "July 2026",
      currentMonth: "August 2026",
      suggestedGlDate: "2026-08-01",
    })).toEqual({
      invoiceDateMonth: "July 2026",
      currentMonth: "August 2026",
      suggestedInvoiceDate: "2026-08-01",
    });
  });

  it("selects the W7 detail without parsing blocker copy", () => {
    expect(getClosedPeriodRecoveryFromDetails([
      { code: "OTHER_BLOCKER", glDateMonth: "July 2026" },
      detail,
    ])).toEqual(recovery);
    expect(getClosedPeriodRecoveryFromDetails([
      { code: "OTHER_BLOCKER", glDateMonth: "August 2026", currentMonth: "August 2026", suggestedGlDate: "2026-08-01" },
    ])).toBeNull();
  });

  it("accepts structured approve errors and rejects plain errors", () => {
    expect(getClosedPeriodRecoveryFromError({ message: "closed", status: 422, ...detail })).toEqual(recovery);
    expect(getClosedPeriodRecoveryFromError(new Error("GL date falls in July 2026"))).toBeNull();
  });

  it("does not manufacture recovery from malformed or incomplete metadata", () => {
    expect(getClosedPeriodRecovery({ ...detail, invoiceDateMonth: "" })).toBeNull();
    expect(getClosedPeriodRecovery({ ...detail, suggestedInvoiceDate: undefined, suggestedGlDate: 42 as unknown as string })).toBeNull();
  });
});
