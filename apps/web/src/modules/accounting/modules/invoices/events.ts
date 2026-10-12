import type { AuditEventCatalog } from "@/modules/shared/types/auditEvent";

export const INVOICE_EVENTS = {
  "invoice.approved": {
    label: "Invoice approved",
    severity: "info",
    targetType: "invoice",
  },
  "invoice.rejected": {
    label: "Invoice rejected",
    severity: "warning",
    targetType: "invoice",
  },
  "invoice.deleted": {
    label: "Invoice deleted",
    severity: "warning",
    targetType: "invoice",
  },
  "invoice.restored": {
    label: "Invoice restored",
    severity: "info",
    targetType: "invoice",
  },
  "invoice.permanently_deleted": {
    label: "Invoice permanently deleted",
    severity: "critical",
    targetType: "invoice",
  },
  "invoice.submitted_spectrum": {
    label: "Invoice submitted to Spectrum",
    severity: "info",
    targetType: "invoice",
  },
  "invoice.split_created": {
    label: "Invoice split created",
    severity: "info",
    targetType: "invoice",
  },
} as const satisfies AuditEventCatalog;
