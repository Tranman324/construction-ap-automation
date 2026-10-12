import { describe, expect, it } from "vitest";
import { ACCOUNTING_EVENTS } from "@/modules/accounting/events";
import { INVOICE_EVENTS } from "@/modules/accounting/modules/invoices/events";

describe("ACCOUNTING_EVENTS", () => {
  it("re-exports child invoice audit events", () => {
    expect(ACCOUNTING_EVENTS).toEqual(INVOICE_EVENTS);
  });
});
