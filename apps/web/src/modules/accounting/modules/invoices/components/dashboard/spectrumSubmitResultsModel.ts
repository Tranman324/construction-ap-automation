import type { SpectrumSubmitCandidate } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import { formatSpectrumSubmitCurrency } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import type {
  SpectrumSubmitResultRow,
  SpectrumSubmitResultsPhase,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";

const FALLBACK_FAILURE_REASON = "Spectrum submission failed.";
const SPECTRUM_SUBMIT_FRIENDLY_ERRORS: Record<string, string> = {
  confidence_below_threshold: "Low extraction confidence. Verify the extracted fields.",
  job_match_required: "Job code is missing. Assign a job before submitting.",
  lien_waiver_required: "Missing lien waiver. Link a signed waiver before submitting.",
};

export function getSpectrumSubmitFailureReason(row: SpectrumSubmitResultRow): string {
  if (row.duplicate?.reason === "already_submitted") {
    return "Already submitted to Spectrum";
  }
  if (row.duplicate?.reason === "batch_duplicate") {
    return "Duplicate of another invoice in this batch";
  }

  const issue = row.issue?.trim();
  if (!issue) return FALLBACK_FAILURE_REASON;

  return SPECTRUM_SUBMIT_FRIENDLY_ERRORS[issue] ?? issue;
}

export function getSpectrumSubmitFailureContext(row: SpectrumSubmitResultRow): string | null {
  if (row.duplicate?.reason === "already_submitted") {
    const submittedDocument = row.duplicate.documents?.find((document) => document.status === "submitted");
    if (!submittedDocument) return null;
    const context = [
      submittedDocument.jobNumber ? `Job ${submittedDocument.jobNumber}` : null,
      submittedDocument.amount == null ? null : formatSpectrumSubmitCurrency(submittedDocument.amount),
    ].filter((value): value is string => value !== null);
    return `Existing submitted document: ${context.join(" · ") || submittedDocument.id}`;
  }

  if (row.duplicate?.reason === "batch_duplicate") {
    return "Both documents are approved; discard one before resubmitting.";
  }

  return null;
}

export function isSpectrumSubmitResultActionable(row: SpectrumSubmitResultRow): boolean {
  return !row.submitted && !row.resolved && !row.discarded;
}

export function getUnresolvedSpectrumSubmitFailures(
  phase: SpectrumSubmitResultsPhase,
): SpectrumSubmitResultRow[] {
  return phase.rows.filter(isSpectrumSubmitResultActionable);
}

export function getSpectrumSubmitRetryCandidates(
  phase: SpectrumSubmitResultsPhase,
): SpectrumSubmitCandidate[] {
  const invoiceIds = new Set(getUnresolvedSpectrumSubmitFailures(phase).map((row) => row.invoiceId));
  return phase.candidates.filter((candidate) => invoiceIds.has(candidate.id));
}

export interface SpectrumSubmitFailureNavigation {
  activeInvoiceId: string | null;
  activeRow: SpectrumSubmitResultRow | null;
  position: number;
  total: number;
  previousInvoiceId: string | null;
  nextInvoiceId: string | null;
}

export function getSpectrumSubmitFailureNavigation(
  phase: SpectrumSubmitResultsPhase,
  requestedInvoiceId: string | null,
): SpectrumSubmitFailureNavigation {
  const failures = getUnresolvedSpectrumSubmitFailures(phase);
  const total = failures.length;

  if (total === 0) {
    return {
      activeInvoiceId: null,
      activeRow: null,
      position: 0,
      total: 0,
      previousInvoiceId: null,
      nextInvoiceId: null,
    };
  }

  const requestedIndex = requestedInvoiceId
    ? failures.findIndex((row) => row.invoiceId === requestedInvoiceId)
    : -1;
  const activeIndex = requestedIndex >= 0 ? requestedIndex : 0;
  const activeRow = failures[activeIndex] ?? failures[0];
  const previousRow = failures[(activeIndex - 1 + total) % total] ?? activeRow;
  const nextRow = failures[(activeIndex + 1) % total] ?? activeRow;

  return {
    activeInvoiceId: activeRow.invoiceId,
    activeRow,
    position: activeIndex + 1,
    total,
    previousInvoiceId: previousRow.invoiceId,
    nextInvoiceId: nextRow.invoiceId,
  };
}

export function canCompleteSpectrumSubmitResults(
  phase: SpectrumSubmitResultsPhase,
): boolean {
  return getUnresolvedSpectrumSubmitFailures(phase).length === 0;
}

export function createSpectrumSubmitDiscardReason(row: SpectrumSubmitResultRow): string {
  return `Discarded after Spectrum submission failure: ${getSpectrumSubmitFailureReason(row)}`;
}

export function markSpectrumSubmitResultDiscarded(
  phase: SpectrumSubmitResultsPhase,
  invoiceId: string,
): SpectrumSubmitResultsPhase {
  return {
    ...phase,
    rows: phase.rows.map((row) =>
      row.invoiceId === invoiceId && !row.submitted
        ? { ...row, resolved: true, discarded: true }
        : row,
    ),
  };
}
