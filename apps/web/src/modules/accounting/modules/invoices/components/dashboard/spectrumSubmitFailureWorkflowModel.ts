import type { InvoiceStatus } from "@/modules/accounting/modules/invoices/types/invoice";
import type { SpectrumSubmitCandidate } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import type { SpectrumSubmitResultRow, SpectrumSubmitResultsPhase } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";
import { getSpectrumSubmitFailureNavigation, isSpectrumSubmitResultActionable } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitResultsModel";

export const SPECTRUM_SUBMIT_RETURN_PARAM = "spectrumSubmitReturn";
export const SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY = "spectrum-submit-workflow-v1";
const SPECTRUM_SUBMIT_WORKFLOW_CHANGE_EVENT = "spectrum-submit-workflow-change";

export interface SpectrumSubmitFailureWorkflowSnapshot {
  results: SpectrumSubmitResultsPhase;
  activeInvoiceId: string | null;
}

export interface SpectrumSubmitWorkflowInvoiceStatus {
  id: string;
  status: InvoiceStatus;
  lastSpectrumError?: string | null;
}

export type SpectrumSubmitWorkflowInvoiceFetcher = (invoiceId: string) => Promise<SpectrumSubmitWorkflowInvoiceStatus>;

interface RouteIntentParams { get(name: string): string | null; }

export function createSpectrumSubmitReturnHref(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set(SPECTRUM_SUBMIT_RETURN_PARAM, "1");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function createSpectrumSubmitFailureDetailHref(invoiceId: string, returnHref: string): string {
  const params = new URLSearchParams();
  params.set("from", returnHref);
  params.set(SPECTRUM_SUBMIT_RETURN_PARAM, "1");
  return `/accounting/invoices/${encodeURIComponent(invoiceId)}?${params.toString()}`;
}

export function isSpectrumSubmitReturnVisit(params: RouteIntentParams): boolean {
  return params.get(SPECTRUM_SUBMIT_RETURN_PARAM) === "1";
}

export function createSpectrumSubmitFailureWorkflowSnapshot(
  results: SpectrumSubmitResultsPhase,
  activeInvoiceId: string | null,
): SpectrumSubmitFailureWorkflowSnapshot {
  const navigation = getSpectrumSubmitFailureNavigation(results, activeInvoiceId);
  return { results, activeInvoiceId: navigation.activeInvoiceId };
}

export function writeSpectrumSubmitFailureWorkflowSnapshot(snapshot: SpectrumSubmitFailureWorkflowSnapshot): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY, JSON.stringify(snapshot));
  notifySpectrumSubmitFailureWorkflowChange();
}

export function clearSpectrumSubmitFailureWorkflowSnapshot(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY);
  notifySpectrumSubmitFailureWorkflowChange();
}

export function hasSpectrumSubmitFailureWorkflowSnapshot(): boolean {
  return readSpectrumSubmitFailureWorkflowSnapshot() !== null;
}

export function subscribeSpectrumSubmitFailureWorkflowSnapshot(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.storageArea === window.sessionStorage && event.key === SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY) {
      listener();
    }
  };
  window.addEventListener(SPECTRUM_SUBMIT_WORKFLOW_CHANGE_EVENT, listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(SPECTRUM_SUBMIT_WORKFLOW_CHANGE_EVENT, listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function readSpectrumSubmitFailureWorkflowSnapshot(): SpectrumSubmitFailureWorkflowSnapshot | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isWorkflowSnapshot(parsed) ? parsed : null;
  } catch (error) {
    if (error instanceof SyntaxError) {
      window.sessionStorage.removeItem(SPECTRUM_SUBMIT_WORKFLOW_STORAGE_KEY);
      return null;
    }
    throw error;
  }
}

export async function refreshSpectrumSubmitFailureWorkflow(
  snapshot: SpectrumSubmitFailureWorkflowSnapshot,
  fetchInvoice: SpectrumSubmitWorkflowInvoiceFetcher,
): Promise<SpectrumSubmitFailureWorkflowSnapshot> {
  const actionableRows = snapshot.results.rows.filter(isSpectrumSubmitResultActionable);
  const refreshedEntries = await Promise.all(
    actionableRows.map(async (row) => {
      try {
        return await fetchInvoice(row.invoiceId);
      } catch {
        return null;
      }
    }),
  );
  const refreshedById = new Map(
    refreshedEntries.flatMap((invoice) => invoice ? [[invoice.id, invoice]] : []),
  );
  const rows = snapshot.results.rows.map((row) =>
    refreshSpectrumSubmitResultRow(row, refreshedById.get(row.invoiceId)),
  );
  const results = recalculateSpectrumSubmitResults({
    ...snapshot.results,
    rows,
  });

  return createSpectrumSubmitFailureWorkflowSnapshot(results, snapshot.activeInvoiceId);
}

export function markSpectrumSubmitFailureWorkflowInvoiceSubmitted(
  snapshot: SpectrumSubmitFailureWorkflowSnapshot,
  invoiceId: string,
): SpectrumSubmitFailureWorkflowSnapshot {
  return updateSpectrumSubmitFailureWorkflowRows(snapshot, invoiceId, {
    submitted: true,
    resolved: true,
    discarded: false,
    issue: null,
  });
}

export function markSpectrumSubmitFailureWorkflowInvoiceFailed(
  snapshot: SpectrumSubmitFailureWorkflowSnapshot,
  invoiceId: string,
  issue: string,
): SpectrumSubmitFailureWorkflowSnapshot {
  return updateSpectrumSubmitFailureWorkflowRows(snapshot, invoiceId, {
    submitted: false,
    resolved: false,
    discarded: false,
    issue,
  }, invoiceId);
}

function refreshSpectrumSubmitResultRow(
  row: SpectrumSubmitResultRow,
  invoice: SpectrumSubmitWorkflowInvoiceStatus | undefined,
): SpectrumSubmitResultRow {
  if (!invoice || !isSpectrumSubmitResultActionable(row)) return row;

  if (invoice.status === "submitted") {
    return { ...row, submitted: true, resolved: true, discarded: false, issue: null };
  }

  if (invoice.status === "discarded") {
    return { ...row, submitted: false, resolved: true, discarded: true };
  }

  if (invoice.status !== "approved") {
    return { ...row, submitted: false, resolved: true, discarded: false };
  }

  const refreshedIssue = invoice.lastSpectrumError?.trim();
  return refreshedIssue ? { ...row, issue: refreshedIssue } : row;
}

function recalculateSpectrumSubmitResults(phase: SpectrumSubmitResultsPhase): SpectrumSubmitResultsPhase {
  const submittedCount = phase.rows.filter((row) => row.submitted).length;
  return { ...phase, submittedCount, failedCount: phase.rows.length - submittedCount };
}

function updateSpectrumSubmitFailureWorkflowRows(
  snapshot: SpectrumSubmitFailureWorkflowSnapshot,
  invoiceId: string,
  patch: Pick<SpectrumSubmitResultRow, "submitted" | "resolved" | "discarded" | "issue">,
  activeInvoiceId: string | null = snapshot.activeInvoiceId,
): SpectrumSubmitFailureWorkflowSnapshot {
  const rows = snapshot.results.rows.map((row) =>
    row.invoiceId === invoiceId ? { ...row, ...patch } : row,
  );
  const results = recalculateSpectrumSubmitResults({
    ...snapshot.results,
    rows,
  });

  return createSpectrumSubmitFailureWorkflowSnapshot(results, activeInvoiceId);
}

function isWorkflowSnapshot(value: unknown): value is SpectrumSubmitFailureWorkflowSnapshot {
  const record = asRecord(value);
  if (!record) return false;
  return (
    isResultsPhase(record.results) &&
    (typeof record.activeInvoiceId === "string" || record.activeInvoiceId === null)
  );
}

function isResultsPhase(value: unknown): value is SpectrumSubmitResultsPhase {
  const record = asRecord(value);
  return Boolean(
    record &&
      record.phase === "results" &&
      Array.isArray(record.candidates) &&
      record.candidates.every(isCandidate) &&
      Array.isArray(record.rows) &&
      record.rows.every(isResultRow) &&
      typeof record.submittedCount === "number" &&
      typeof record.failedCount === "number",
  );
}

function isCandidate(value: unknown): value is SpectrumSubmitCandidate {
  const record = asRecord(value);
  return Boolean(
    record &&
      typeof record.id === "string" &&
      (typeof record.vendorName === "string" || record.vendorName === null) &&
      (typeof record.invoiceNumber === "string" || record.invoiceNumber === null),
  );
}

function isResultRow(value: unknown): value is SpectrumSubmitResultRow {
  const record = asRecord(value);
  return Boolean(
    record &&
      typeof record.invoiceId === "string" &&
      typeof record.submitted === "boolean" &&
      typeof record.resolved === "boolean" &&
      typeof record.discarded === "boolean",
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function notifySpectrumSubmitFailureWorkflowChange(): void {
  window.dispatchEvent(new Event(SPECTRUM_SUBMIT_WORKFLOW_CHANGE_EVENT));
}
