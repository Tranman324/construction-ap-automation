import type { DashboardStats } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type {
  SpectrumSubmitGlobalQueueMode,
  SpectrumSubmitSelectedMode,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import { toSpectrumSubmitCandidate } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";

export interface SelectedSpectrumSubmitModeResult {
  mode: SpectrumSubmitSelectedMode | null;
  skippedCount: number;
}

function isApprovedInvoiceDocument(invoice: Invoice): boolean {
  return invoice.status === "approved" && (
    invoice.classification === "invoice" ||
    invoice.classification === "pay-application"
  );
}

export function buildSelectedSpectrumSubmitMode(
  selectedInvoices: Invoice[],
  selectedIdCount: number,
): SelectedSpectrumSubmitModeResult {
  const candidates = selectedInvoices
    .filter(isApprovedInvoiceDocument)
    .map(toSpectrumSubmitCandidate);

  return {
    mode: candidates.length > 0 ? { kind: "selected", invoices: candidates } : null,
    skippedCount: Math.max(selectedIdCount - candidates.length, 0),
  };
}

export function buildGlobalApprovedQueueSubmitMode(
  stats: DashboardStats | undefined,
): SpectrumSubmitGlobalQueueMode {
  return {
    kind: "global-approved-queue",
    invoiceCount: stats?.approved ?? 0,
    totalAmount: stats?.amounts.approved ?? null,
    jobsAffected: null,
  };
}
