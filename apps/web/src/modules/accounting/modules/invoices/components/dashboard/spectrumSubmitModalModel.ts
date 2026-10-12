import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type {
  SpectrumSubmitPhaseModel,
  SpectrumSubmitResultsPhase,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";

export interface SpectrumSubmitCandidate {
  id: string;
  vendorName: string | null;
  invoiceNumber: string | null;
  amount: number | null;
  jobNumber: string | null;
  lienWaiverStatus: "attached" | "missing" | null;
  lienWaiverRequired: boolean;
  linkedLienWaiverId: string | null;
  waiverOnDocument?: boolean;
}

export interface SpectrumSubmitSelectedMode {
  kind: "selected";
  invoices: SpectrumSubmitCandidate[];
}

export interface SpectrumSubmitGlobalQueueMode {
  kind: "global-approved-queue";
  invoiceCount: number;
  totalAmount: number | null;
  jobsAffected: number | null;
}

export type SpectrumSubmitMode =
  | SpectrumSubmitSelectedMode
  | SpectrumSubmitGlobalQueueMode;

export interface SpectrumSubmitFailureOpenRequest {
  invoiceId: string;
  results: SpectrumSubmitResultsPhase;
}

export interface SpectrumSubmitConfirmSummary {
  count: number;
  totalAmount: number | null;
  jobsAffected: number | null;
  title: string;
  sourceLabel: string;
  submitLabel: string;
}

export function formatSpectrumSubmitCurrency(value: number | null): string {
  if (value == null) return "--";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toFiniteAmount(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function countDistinctJobs(invoices: SpectrumSubmitCandidate[]): number | null {
  const jobs = invoices
    .map((invoice) => invoice.jobNumber?.trim())
    .filter((job): job is string => Boolean(job));

  return jobs.length > 0 ? new Set(jobs).size : null;
}

export function toSpectrumSubmitCandidate(invoice: Invoice): SpectrumSubmitCandidate {
  return {
    id: invoice.id,
    vendorName:
      cleanText(invoice.extracted?.vendorName) ??
      cleanText(invoice.matching?.vendor?.vendorName),
    invoiceNumber: cleanText(invoice.extracted?.invoiceNumber),
    amount: invoice.extracted?.amount ?? null,
    jobNumber:
      cleanText(invoice.extracted?.jobNumber) ??
      cleanText(invoice.matching?.job?.jobNumber),
    lienWaiverStatus: invoice.lienWaiverStatus ?? null,
    lienWaiverRequired: invoice.lienWaiverRequired === true,
    linkedLienWaiverId: cleanText(invoice.linkedLienWaiverId),
    waiverOnDocument: invoice.waiverOnDocument === true,
  };
}

function summarizeCandidates(
  mode: SpectrumSubmitMode,
  candidates: SpectrumSubmitCandidate[],
): SpectrumSubmitConfirmSummary {
  const count = candidates.length;
  const totalAmount = candidates.reduce(
    (sum, invoice) => sum + toFiniteAmount(invoice.amount),
    0,
  );
  const isGlobal = mode.kind === "global-approved-queue";

  return {
    count,
    totalAmount,
    jobsAffected: countDistinctJobs(candidates),
    title: isGlobal
      ? "Submit approved invoices to Spectrum"
      : count === 1
        ? "Submit invoice to Spectrum"
        : `Submit ${count} invoices to Spectrum`,
    sourceLabel: isGlobal ? "Approved queue" : "Selected approved invoices",
    submitLabel: count === 1 ? "Submit to Spectrum" : `Submit ${count} to Spectrum`,
  };
}

export function summarizeSpectrumSubmitMode(
  mode: SpectrumSubmitMode,
  candidates?: SpectrumSubmitCandidate[],
): SpectrumSubmitConfirmSummary {
  if (candidates) return summarizeCandidates(mode, candidates);

  if (mode.kind === "global-approved-queue") {
    return {
      count: mode.invoiceCount,
      totalAmount: mode.totalAmount,
      jobsAffected: mode.jobsAffected,
      title: "Submit approved invoices to Spectrum",
      sourceLabel: "Approved queue",
      submitLabel: "Submit approved queue",
    };
  }

  const count = mode.invoices.length;
  const totalAmount = mode.invoices.reduce(
    (sum, invoice) => sum + (invoice.amount ?? 0),
    0,
  );

  return {
    count,
    totalAmount,
    jobsAffected: countDistinctJobs(mode.invoices),
    title: count === 1 ? "Submit invoice to Spectrum" : `Submit ${count} invoices to Spectrum`,
    sourceLabel: "Selected approved invoices",
    submitLabel: count === 1 ? "Submit to Spectrum" : `Submit ${count} to Spectrum`,
  };
}

export function getSpectrumSubmitDialogDescription(
  phaseModel: SpectrumSubmitPhaseModel,
): string {
  if (phaseModel.phase === "submitting") {
    return "Posting each document in turn. Failures are captured and listed at the end.";
  }

  if (phaseModel.phase === "results") {
    return `${phaseModel.submittedCount} of ${phaseModel.rows.length} posted to Spectrum.`;
  }

  return "Posts to the Spectrum AP ledger. Submitted invoices lock from further edits.";
}
