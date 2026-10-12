import type { ResolveTrayRow } from "@/modules/shared/components/patterns/ResolveTray";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { ClosedPeriodApprovalRecovery } from "../../lib/approvalRecovery";

export interface ClosedPeriodTrayAction {
  invoiceId: string;
  recovery: ClosedPeriodApprovalRecovery;
  disabled: boolean;
  onUseSuggestedDate: () => void;
}
import { hasMissingWaiverAttention } from "@/modules/accounting/modules/invoices/components/invoices/invoiceDetailPanelState";
import { DUPLICATE_TITLE, duplicateContext } from "./duplicateCardCopy";

export type InvoiceResolveRow = ResolveTrayRow & {
  kind: "duplicate" | "waiver" | "closed-period";
  recoveryAction?: ClosedPeriodTrayAction;
};

/**
 * Single frontend presentation model for invoice attention rows.
 *
 * The row set is intentionally derived from served invoice state only. It is
 * presentation/counting state; it never replaces the approval verdict or
 * authorizes a mutation.
 *
 * Duplicate membership: the live server evaluation wins once it has loaded.
 * Until then (or when it errors) fall back to the served flag so the card never
 * flickers out. Spectrum-only matches have no `duplicateOf` and appear only
 * once the live status loads.
 */
export function hasUnresolvedDuplicate(invoice: Invoice, duplicateStatus?: DuplicateStatusResponse | null): boolean {
  if (invoice.status !== "pending") return false;
  if (duplicateStatus) return duplicateStatus.state !== "none";
  return Boolean(invoice.duplicateOf) && !invoice.duplicateBypassed;
}

export function getInvoiceResolveRows(
  invoice: Invoice,
  recoveryAction?: ClosedPeriodTrayAction | null,
  duplicateStatus?: DuplicateStatusResponse | null,
): InvoiceResolveRow[] {
  const rows: InvoiceResolveRow[] = [];

  // Keep the transient action accessible ahead of a waiting waiver card.
  if (recoveryAction?.invoiceId === invoice.id) {
    const { recovery } = recoveryAction;
    rows.push({
      id: `closed-period:${invoice.id}`,
      kind: "closed-period",
      label: "Invoice date in a closed period",
      description: `Invoice date falls in ${recovery.invoiceDateMonth} — a closed period. Only ${recovery.currentMonth} is open.`,
      recoveryAction,
    });
  }

  if (hasUnresolvedDuplicate(invoice, duplicateStatus)) {
    rows.push({
      id: `duplicate:${invoice.id}`,
      kind: "duplicate",
      label: DUPLICATE_TITLE,
      description: duplicateContext(duplicateStatus),
    });
  }

  if (invoice.status !== "duplicate" && hasMissingWaiverAttention(invoice)) {
    rows.push({
      id: `waiver:${invoice.id}`,
      kind: "waiver",
      label: "Lien waiver",
      description: "Waiver required before approval",
      waiting: true,
    });
  }

  return rows;
}
