import {
  SpectrumSubmitConfirmView,
  SpectrumSubmitResultsView,
  SpectrumSubmitSubmittingView,
} from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitPhaseViews";
import type {
  SpectrumSubmitCandidate,
  SpectrumSubmitConfirmSummary,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import type { SpectrumSubmitPrecheckSummary } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitPrecheckModel";
import type {
  SpectrumSubmitPhaseModel,
  SpectrumSubmitResultRow,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";
import type { SpectrumSubmitFailureNavigation } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitResultsModel";

interface SpectrumSubmitModalPhaseContentProps {
  activeFailureInvoiceId: string | null;
  confirmCandidates: SpectrumSubmitCandidate[] | undefined;
  discardingInvoiceId: string | null;
  failureNavigation: SpectrumSubmitFailureNavigation | null;
  phaseModel: SpectrumSubmitPhaseModel;
  precheck: SpectrumSubmitPrecheckSummary;
  summary: SpectrumSubmitConfirmSummary;
  onDiscardInvoice: (row: SpectrumSubmitResultRow) => void;
  onFailureNavigationChange: (invoiceId: string | null) => void;
  onOpenInvoice: (invoiceId: string) => void;
}

export function SpectrumSubmitModalPhaseContent({
  activeFailureInvoiceId,
  confirmCandidates,
  discardingInvoiceId,
  failureNavigation,
  phaseModel,
  precheck,
  summary,
  onDiscardInvoice,
  onFailureNavigationChange,
  onOpenInvoice,
}: SpectrumSubmitModalPhaseContentProps) {
  if (phaseModel.phase === "confirm") {
    return (
      <SpectrumSubmitConfirmView
        candidatesLoaded={confirmCandidates !== undefined}
        precheck={precheck}
        summary={summary}
      />
    );
  }

  if (phaseModel.phase === "submitting") {
    return <SpectrumSubmitSubmittingView phase={phaseModel} />;
  }

  return (
    <SpectrumSubmitResultsView
      activeFailureInvoiceId={activeFailureInvoiceId}
      discardingInvoiceId={discardingInvoiceId}
      failureNavigation={failureNavigation}
      phase={phaseModel}
      onDiscardInvoice={onDiscardInvoice}
      onFailureNavigationChange={onFailureNavigationChange}
      onOpenInvoice={onOpenInvoice}
    />
  );
}
