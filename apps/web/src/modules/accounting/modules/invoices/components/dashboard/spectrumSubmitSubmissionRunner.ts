import type {
  SubmitPayload,
  SubmitResponse,
} from "@/modules/accounting/modules/invoices/types/api";
import type { SpectrumSubmitCandidate } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import {
  completeSpectrumSubmitProgress,
  normalizeSpectrumSubmitError,
  normalizeSpectrumSubmitResponse,
  recordSpectrumSubmitResult,
  startSpectrumSubmitProgress,
  type SpectrumSubmitResultsPhase,
  type SpectrumSubmitSubmittingPhase,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";

export interface SpectrumSubmitSubmissionClient {
  mutateAsync: (payload: SubmitPayload) => Promise<SubmitResponse>;
}

export async function runSpectrumSubmitSubmission(
  candidates: SpectrumSubmitCandidate[],
  submit: SpectrumSubmitSubmissionClient,
  onProgress: (phase: SpectrumSubmitSubmittingPhase) => void,
): Promise<SpectrumSubmitResultsPhase> {
  let progress: SpectrumSubmitSubmittingPhase = startSpectrumSubmitProgress(candidates);
  onProgress(progress);

  for (const candidate of candidates) {
    const result = await submit
      .mutateAsync({ ids: [candidate.id] })
      .then((response) => normalizeSpectrumSubmitResponse(candidate, response))
      .catch((error: unknown) => normalizeSpectrumSubmitError(candidate, error));
    progress = recordSpectrumSubmitResult(progress, result);
    onProgress(progress);
  }

  return completeSpectrumSubmitProgress(progress);
}
