import { INVOICE_PERMISSIONS } from "@/modules/accounting/modules/invoices/permissions";
import type { PermissionManifest } from "@/modules/shared/types/permissions";

export const ACCOUNTING_PERMISSIONS: PermissionManifest = {
  ...INVOICE_PERMISSIONS,
} as const;
