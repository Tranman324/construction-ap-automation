import { INVOICE_EVENTS } from "@/modules/accounting/modules/invoices/events";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { emitAuditEvent } from "@/modules/shared/lib/auditEmitter";
import type { AuditEventActor, AuditEventInput } from "@/modules/shared/types/auditEvent";

type InvoiceEventType = keyof typeof INVOICE_EVENTS;

interface AuditAuthUser {
  userId?: string;
  name?: string;
  email?: string;
  role?: string;
}

function resolveAuditActor(user: AuditAuthUser | null): AuditEventActor {
  return {
    userId: user?.userId || "unknown",
    name: user?.name || user?.email || "Unknown user",
    role: user?.role || "unknown",
  };
}

export function getInvoiceLabel(invoice: Invoice | undefined, fallbackId: string): string {
  return invoice?.extracted?.vendorName
    ?? invoice?.matching?.vendor?.vendorName
    ?? invoice?.file
    ?? fallbackId;
}

export function emitInvoiceAuditEvent(
  user: AuditAuthUser | null,
  type: InvoiceEventType,
  targetId: string,
  summary: string,
  label?: string,
): void {
  const definition = INVOICE_EVENTS[type];
  const target: AuditEventInput["target"] = {
    type: definition.targetType,
    id: targetId,
    ...(label ? { label } : {}),
  };

  emitAuditEvent({
    type,
    actor: resolveAuditActor(user),
    target,
    summary,
    module: "invoices",
    severity: definition.severity,
  });
}
