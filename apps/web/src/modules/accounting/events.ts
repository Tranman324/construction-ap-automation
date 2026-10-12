import { INVOICE_EVENTS } from "@/modules/accounting/modules/invoices/events";
import type { AuditEventCatalog } from "@/modules/shared/types/auditEvent";

export const ACCOUNTING_EVENTS = {
  ...INVOICE_EVENTS,
} as const satisfies AuditEventCatalog;
