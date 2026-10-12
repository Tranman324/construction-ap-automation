import { describe, expect, it } from "vitest";
import { INVOICE_EVENTS } from "@/modules/accounting/modules/invoices/events";

describe("INVOICE_EVENTS", () => {
  it("defines the expected invoice audit event types", () => {
    expect(Object.keys(INVOICE_EVENTS).sort()).toEqual(
      [
        "invoice.approved",
        "invoice.deleted",
        "invoice.permanently_deleted",
        "invoice.rejected",
        "invoice.restored",
        "invoice.split_created",
        "invoice.submitted_spectrum",
      ].sort(),
    );
  });

  it("uses invoice targets and appropriate severity levels", () => {
    expect(INVOICE_EVENTS["invoice.approved"]).toMatchObject({
      severity: "info",
      targetType: "invoice",
    });
    expect(INVOICE_EVENTS["invoice.permanently_deleted"]).toMatchObject({
      severity: "critical",
      targetType: "invoice",
    });
  });
});
