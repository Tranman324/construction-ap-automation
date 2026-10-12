import { describe, expect, it } from "vitest";
import { ACCOUNTING_PERMISSIONS } from "@/modules/accounting/permissions";
import { INVOICE_PERMISSIONS } from "@/modules/accounting/modules/invoices/permissions";

describe("ACCOUNTING_PERMISSIONS", () => {
  it("re-exports the invoice permission manifest without parent-level permissions", () => {
    expect(ACCOUNTING_PERMISSIONS).toEqual(INVOICE_PERMISSIONS);
    expect(Object.keys(ACCOUNTING_PERMISSIONS)).not.toContain("accounting.view");
  });
});
