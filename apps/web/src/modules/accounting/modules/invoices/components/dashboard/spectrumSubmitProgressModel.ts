import type { DuplicateSubmitIdentity, SubmitResponse } from "@/modules/accounting/modules/invoices/types/api";
import { isApiError } from "@/modules/shared/lib/api";
import type {
  SpectrumSubmitCandidate,
  SpectrumSubmitMode,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";

export type SpectrumSubmitProgressRowState =
  | "waiting"
  | "active"
  | "success"
  | "failure";

export interface SpectrumSubmitConfirmPhase {
  phase: "confirm";
  source: SpectrumSubmitMode;
}

export interface SpectrumSubmitResultRow {
  invoiceId: string;
  invoiceNumber: string | null;
  vendorName: string | null;
  amount: number | null;
  submitted: boolean;
  issue: string | null;
  /** Server-provided pre-flight validation lines from the canonical API error envelope. */
  preflightErrors?: string[];
  resolved: boolean;
  discarded: boolean;
  /** Duplicate-identity data returned by the submit preflight, when present. */
  duplicate?: DuplicateSubmitIdentity;
  /** The duplicate document the discard affordance acts on. */
  discardInvoiceId?: string;
}

export const SPECTRUM_SUBMIT_ERROR_DETAIL_LIMIT = 10;

export interface SpectrumSubmitErrorDetailDisplay {
  errors: string[];
  remainingCount: number;
}

export interface SpectrumSubmitProgressRow extends SpectrumSubmitResultRow {
  state: SpectrumSubmitProgressRowState;
}

export interface SpectrumSubmitSubmittingPhase {
  phase: "submitting";
  candidates: SpectrumSubmitCandidate[];
  rows: SpectrumSubmitProgressRow[];
  results: SpectrumSubmitResultRow[];
  activeInvoiceId: string | null;
  completedCount: number;
  totalCount: number;
  percentage: number;
}

export interface SpectrumSubmitResultsPhase {
  phase: "results";
  candidates: SpectrumSubmitCandidate[];
  rows: SpectrumSubmitResultRow[];
  submittedCount: number;
  failedCount: number;
}

export type SpectrumSubmitPhaseModel =
  | SpectrumSubmitConfirmPhase
  | SpectrumSubmitSubmittingPhase
  | SpectrumSubmitResultsPhase;

export function getSpectrumSubmitCandidateLabel(
  candidate: SpectrumSubmitCandidate,
): string {
  return candidate.invoiceNumber ?? candidate.vendorName ?? candidate.id;
}

function getPercentage(completedCount: number, totalCount: number): number {
  if (totalCount === 0) return 0;
  return Math.round((completedCount / totalCount) * 100);
}

function toBaseResultRow(
  candidate: SpectrumSubmitCandidate,
  submitted: boolean,
  issue: string | null,
  duplicate?: DuplicateSubmitIdentity,
): SpectrumSubmitResultRow {
  return {
    invoiceId: candidate.id,
    invoiceNumber: candidate.invoiceNumber,
    vendorName: candidate.vendorName,
    amount: candidate.amount,
    submitted,
    issue,
    resolved: submitted,
    discarded: false,
    duplicate,
    discardInvoiceId: duplicate
      ? duplicate.documents?.find((document) => document.status === "approved")?.id ?? candidate.id
      : candidate.id,
  };
}

function isDuplicateSubmitIdentity(value: unknown): value is DuplicateSubmitIdentity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.vendorCode === "string"
    && typeof candidate.invoiceNumber === "string"
    && Array.isArray(candidate.documentIds)
    && candidate.documentIds.every((id) => typeof id === "string");
}

function getDuplicateForCandidate(
  candidate: SpectrumSubmitCandidate,
  error: unknown,
): DuplicateSubmitIdentity | undefined {
  if (!isApiError(error) || !error.details || typeof error.details !== "object") return undefined;
  const details = error.details as Record<string, unknown>;
  if (!Array.isArray(details.duplicates)) return undefined;

  return details.duplicates.find((duplicate): duplicate is DuplicateSubmitIdentity => (
    isDuplicateSubmitIdentity(duplicate) && duplicate.documentIds.includes(candidate.id)
  ));
}

/**
 * Extracts the API's optional pre-flight validation lines once for all Spectrum
 * submit surfaces. Errors without this exact envelope retain their prior UI.
 */
export function getSpectrumSubmitPreflightErrors(error: unknown): string[] {
  if (!isApiError(error) || !error.details || typeof error.details !== "object") return [];
  const details = error.details as Record<string, unknown>;
  if (!Array.isArray(details.errors)) return [];
  return details.errors.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

export function getSpectrumSubmitErrorDetailDisplay(
  errors: readonly string[] | null | undefined,
): SpectrumSubmitErrorDetailDisplay {
  const allErrors = errors ?? [];
  return {
    errors: allErrors.slice(0, SPECTRUM_SUBMIT_ERROR_DETAIL_LIMIT),
    remainingCount: Math.max(0, allErrors.length - SPECTRUM_SUBMIT_ERROR_DETAIL_LIMIT),
  };
}

export function startSpectrumSubmitProgress(
  candidates: SpectrumSubmitCandidate[],
): SpectrumSubmitSubmittingPhase {
  const activeInvoiceId = candidates[0]?.id ?? null;

  return {
    phase: "submitting",
    candidates,
    rows: candidates.map((candidate) => ({
      ...toBaseResultRow(candidate, false, null),
      state: candidate.id === activeInvoiceId ? "active" : "waiting",
    })),
    results: [],
    activeInvoiceId,
    completedCount: 0,
    totalCount: candidates.length,
    percentage: 0,
  };
}

export function normalizeSpectrumSubmitResponse(
  candidate: SpectrumSubmitCandidate,
  response: SubmitResponse,
): SpectrumSubmitResultRow {
  const rowResult = response.results?.find((result) => result.id === candidate.id);
  const submitted = rowResult ? rowResult.success : response.success && response.submitted > 0;
  const issue = submitted
    ? null
    : rowResult?.error?.trim() || response.message?.trim() || "Spectrum submission failed.";

  return toBaseResultRow(candidate, submitted, issue);
}

export function normalizeSpectrumSubmitError(
  candidate: SpectrumSubmitCandidate,
  error: unknown,
): SpectrumSubmitResultRow {
  const duplicate = getDuplicateForCandidate(candidate, error);
  const message = error instanceof Error
    ? error.message
    : isApiError(error)
      ? error.message
      : "";
  const preflightErrors = getSpectrumSubmitPreflightErrors(error);

  return {
    ...toBaseResultRow(
      candidate,
      false,
      message.trim() || "Spectrum submission failed.",
      duplicate,
    ),
    ...(preflightErrors.length > 0 ? { preflightErrors } : {}),
  };
}

export function recordSpectrumSubmitResult(
  phase: SpectrumSubmitSubmittingPhase,
  result: SpectrumSubmitResultRow,
): SpectrumSubmitSubmittingPhase {
  const completedCount = phase.completedCount + 1;
  const activeInvoiceId = phase.candidates[completedCount]?.id ?? null;
  const results = [...phase.results, result];

  return {
    ...phase,
    rows: phase.rows.map((row) => {
      if (row.invoiceId === result.invoiceId) {
        return { ...row, ...result, state: result.submitted ? "success" : "failure" };
      }

      if (row.invoiceId === activeInvoiceId) {
        return { ...row, state: "active" };
      }

      return row.state === "active" ? { ...row, state: "waiting" } : row;
    }),
    results,
    activeInvoiceId,
    completedCount,
    percentage: getPercentage(completedCount, phase.totalCount),
  };
}

export function completeSpectrumSubmitProgress(
  phase: SpectrumSubmitSubmittingPhase,
): SpectrumSubmitResultsPhase {
  const submittedCount = phase.results.filter((row) => row.submitted).length;

  return {
    phase: "results",
    candidates: phase.candidates,
    rows: phase.results,
    submittedCount,
    failedCount: phase.results.length - submittedCount,
  };
}

export function mergeSpectrumSubmitResults(
  previous: SpectrumSubmitResultsPhase,
  retry: SpectrumSubmitResultsPhase,
): SpectrumSubmitResultsPhase {
  const retryRowsById = new Map(retry.rows.map((row) => [row.invoiceId, row]));
  const previousRowIds = new Set(previous.rows.map((row) => row.invoiceId));
  const rows = [
    ...previous.rows.map((row) => retryRowsById.get(row.invoiceId) ?? row),
    ...retry.rows.filter((row) => !previousRowIds.has(row.invoiceId)),
  ];
  const previousCandidateIds = new Set(previous.candidates.map((candidate) => candidate.id));
  const candidates = [
    ...previous.candidates,
    ...retry.candidates.filter((candidate) => !previousCandidateIds.has(candidate.id)),
  ];
  const submittedCount = rows.filter((row) => row.submitted).length;

  return {
    phase: "results",
    candidates,
    rows,
    submittedCount,
    failedCount: rows.length - submittedCount,
  };
}
