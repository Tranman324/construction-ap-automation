import { Loader2, RefreshCw, UploadCloud } from "lucide-react";

import type { SpectrumSubmitConfirmSummary } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import type { SpectrumSubmitPhaseModel } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";
import { Button } from "@/modules/shared/components/ui/button";
import { DialogFooter } from "@/modules/shared/components/ui/dialog";

interface SpectrumSubmitModalFooterProps {
  canCompleteResults: boolean;
  canSubmit: boolean;
  phaseModel: SpectrumSubmitPhaseModel;
  summary: SpectrumSubmitConfirmSummary;
  unresolvedFailureCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  onDone: () => void;
  onResubmitFailures: () => void;
}

export function SpectrumSubmitModalFooter({
  canCompleteResults,
  canSubmit,
  phaseModel,
  summary,
  unresolvedFailureCount,
  onCancel,
  onConfirm,
  onDone,
  onResubmitFailures,
}: SpectrumSubmitModalFooterProps) {
  return (
    <DialogFooter className="px-5 pb-5 pt-4 sm:px-6">
      {phaseModel.phase === "confirm" && (
        <>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!canSubmit}>
            <UploadCloud className="h-4 w-4" aria-hidden="true" />
            {summary.submitLabel}
          </Button>
        </>
      )}
      {phaseModel.phase === "submitting" && (
        <Button variant="outline" disabled>
          <Loader2 className="h-4 w-4 animate-spin duration-spin" aria-hidden="true" />
          Submitting...
        </Button>
      )}
      {phaseModel.phase === "results" && (
        <>
          {unresolvedFailureCount > 0 && (
            <Button variant="outline" onClick={onResubmitFailures}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Resubmit {unresolvedFailureCount}
            </Button>
          )}
          <Button disabled={!canCompleteResults} onClick={onDone}>
            {canCompleteResults ? "Done" : `Resolve ${unresolvedFailureCount} first`}
          </Button>
        </>
      )}
    </DialogFooter>
  );
}
