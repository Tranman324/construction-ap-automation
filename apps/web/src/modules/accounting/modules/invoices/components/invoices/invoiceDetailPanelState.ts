import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { isWaiverGateBlocked } from "@/modules/accounting/modules/invoices/lib/waiverGate";
import type { ApprovalOverrideValues } from "@/modules/accounting/modules/invoices/components/invoices/SpectrumSubmitSection";

export interface WaiverOverrideState {
  active: boolean;
  at: string | null;
  by: string | null;
}

export function getWaiverOverrideState(invoice: Invoice): WaiverOverrideState {
  return {
    active: invoice.waiverOnDocument === true,
    at: invoice.waiverOnDocumentAt ?? null,
    by: invoice.waiverOnDocumentBy ?? null,
  };
}

export function hasMissingWaiverAttention(invoice: Invoice): boolean {
  return isWaiverGateBlocked(invoice);
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

export function hasAllocationAttention(overrides: ApprovalOverrideValues | null | undefined): boolean {
  if (!overrides) return false;

  return (
    isBlank(overrides.routingCode) ||
    isBlank(overrides.phaseCode) ||
    isBlank(overrides.glAccount) ||
    isBlank(overrides.costType)
  );
}
