import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type {
  DocumentAlert,
  DocumentChecklistItem,
  DocumentAction,
  DocumentPanelHeader,
} from "@/modules/accounting/modules/invoices/types/documentSpec";

const UNKNOWN_JOB_NUMBER = "Unassigned";
const UNKNOWN_JOB_NAME = "Unassigned job";

export interface LienWaiverEditableSnapshot {
  vendorCode: string | null;
  jobNumber: string | null;
  amountInput: string;
  throughDate: string;
  waiverType: string;
}

export interface LienWaiverDocumentSavePayload {
  vendorCode?: string;
  jobNumber?: string;
  amount?: number;
  invoiceDate?: string;
  waiverType?: string;
}

export interface LienWaiverDocumentData {
  claimant: string;
  vendorCode: string | null;
  vendorName: string | null;
  jobNumber: string;
  jobName: string;
  jobLabel: string;
  amount: number | null;
  amountInput: string;
  throughDate: string;
  fileName: string;
  waiverNumber: string;
  waiverType: string;
  linkedInvoiceId: string | null;
  /** Explicit server-derived waiver state (CONTRACTS.md §waiver state). */
  paired: boolean;
  shelved: boolean;
  released: boolean;
}

export interface LienWaiverWorkflowState {
  vendorCode: string | null;
  jobNumber: string | null;
  amountInput: string;
  linkedInvoiceId: string | null;
  dirty: boolean;
  paired: boolean;
  held: boolean;
  released: boolean;
}

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function amountInput(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function parseLienWaiverAmount(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getLienWaiverDocumentData(record: Invoice): LienWaiverDocumentData {
  const vendorCode = present(record.matching?.vendor?.vendorCode);
  const vendorName = present(record.matching?.vendor?.vendorName)
    ?? present(record.extracted?.vendorName);
  const claimant = vendorName ?? present(record.email.from) ?? "Unknown claimant";
  const jobNumber = present(record.matching?.job?.jobNumber)
    ?? present(record.extracted?.jobNumber)
    ?? UNKNOWN_JOB_NUMBER;
  const jobName = present(record.matching?.job?.jobDescription)
    ?? present(record.extracted?.projectName)
    ?? UNKNOWN_JOB_NAME;
  const amount = record.extracted?.amount ?? record.matching?.sourceInvoiceTotal ?? null;
  // waiverType is the PERSISTED value only — never inferred from filename/subject
  // (CONTRACTS.md §waiver state). Empty string = no type selected yet.
  const waiverType = present(record.waiverType) ?? "";

  return {
    claimant,
    vendorCode,
    vendorName,
    jobNumber,
    jobName,
    jobLabel: jobNumber === UNKNOWN_JOB_NUMBER ? jobName : `${jobNumber} / ${jobName}`,
    amount,
    amountInput: amountInput(amount),
    throughDate: record.extracted?.invoiceDate ?? record.email.receivedAt,
    fileName: present(record.file) ?? present(record.email.subject) ?? "Lien waiver",
    waiverNumber: present(record.extracted?.invoiceNumber) ?? record.id,
    waiverType,
    linkedInvoiceId: record.linkedLienWaiverId ?? null,
    // Explicit server-derived state — consumed, not inferred (CONTRACTS.md §waiver state).
    paired: record.pairingStatus === "paired",
    shelved: record.filingStatus === "shelved",
    released: record.releaseStatus === "released",
  };
}

export function getLienWaiverInitialSnapshot(record: Invoice): LienWaiverEditableSnapshot {
  const data = getLienWaiverDocumentData(record);
  return {
    vendorCode: data.vendorCode,
    jobNumber: data.jobNumber === UNKNOWN_JOB_NUMBER ? null : data.jobNumber,
    amountInput: data.amountInput,
    throughDate: data.throughDate,
    waiverType: data.waiverType,
  };
}

export function isLienWaiverSnapshotDirty(
  current: LienWaiverEditableSnapshot,
  saved: LienWaiverEditableSnapshot,
): boolean {
  return current.vendorCode !== saved.vendorCode
    || current.jobNumber !== saved.jobNumber
    || parseLienWaiverAmount(current.amountInput) !== parseLienWaiverAmount(saved.amountInput)
    || current.throughDate !== saved.throughDate
    || current.waiverType !== saved.waiverType;
}

export function getLienWaiverAmountError(
  current: LienWaiverEditableSnapshot,
  saved: LienWaiverEditableSnapshot,
): string | null {
  if (current.amountInput === saved.amountInput) return null;
  const amount = parseLienWaiverAmount(current.amountInput);
  return amount !== null && amount >= 0 ? null : "Enter a valid numeric amount before leaving this waiver.";
}

export function buildLienWaiverSavePayload(
  current: LienWaiverEditableSnapshot,
  saved: LienWaiverEditableSnapshot,
): LienWaiverDocumentSavePayload | null {
  const payload: LienWaiverDocumentSavePayload = {};
  if (current.vendorCode !== saved.vendorCode) payload.vendorCode = current.vendorCode ?? "";
  if (current.jobNumber !== saved.jobNumber) payload.jobNumber = current.jobNumber ?? "";
  const currentAmount = parseLienWaiverAmount(current.amountInput);
  const savedAmount = parseLienWaiverAmount(saved.amountInput);
  if (currentAmount !== null && currentAmount >= 0 && currentAmount !== savedAmount) payload.amount = currentAmount;
  if (current.throughDate !== saved.throughDate && current.throughDate) payload.invoiceDate = current.throughDate;
  if (current.waiverType !== saved.waiverType) payload.waiverType = current.waiverType;
  return Object.keys(payload).length > 0 ? payload : null;
}

export function getLienWaiverPanelHeader(
  data: LienWaiverDocumentData,
  state: Pick<LienWaiverWorkflowState, "paired" | "held" | "released">,
): DocumentPanelHeader {
  if (state.released) {
    return { kindLabel: "Lien Waiver", title: data.claimant, subtitle: data.fileName, statusLabel: "Filed / Released", statusTone: "ok", readyLabel: "Released" };
  }
  if (state.held) {
    return { kindLabel: "Lien Waiver", title: data.claimant, subtitle: data.fileName, statusLabel: "Held", statusTone: "neutral", readyLabel: "Held" };
  }
  if (state.paired) {
    return { kindLabel: "Lien Waiver", title: data.claimant, subtitle: data.fileName, statusLabel: "Paired", statusTone: "ok", readyLabel: "Ready" };
  }
  return { kindLabel: "Lien Waiver", title: data.claimant, subtitle: data.fileName, statusLabel: "Unpaired", statusTone: "warn", statusPulse: true };
}

export function getLienWaiverChecklist(
  state: LienWaiverWorkflowState,
): DocumentChecklistItem[] {
  const amount = parseLienWaiverAmount(state.amountInput);
  return [
    { id: "vendor", label: "Vendor matched", hint: state.vendorCode ?? "Choose a Spectrum vendor", sectionId: "details", state: state.vendorCode ? "done" : "todo" },
    { id: "job", label: "Job assigned", hint: state.jobNumber ?? "Choose a job", sectionId: "details", state: state.jobNumber ? "done" : "todo" },
    { id: "amount", label: "Amount verified", hint: amount != null ? "Waiver amount captured" : "Enter the waived amount", sectionId: "details", state: amount != null && amount > 0 ? "done" : "todo" },
    {
      id: "paired",
      label: "Invoice pair",
      hint: state.paired ? `Invoice ${state.linkedInvoiceId}` : state.held ? "Shelved without invoice pairing" : "Pair now or shelve for later",
      sectionId: "pairing",
      state: state.paired ? "done" : state.held ? "warning" : "todo",
    },
  ];
}

export function getLienWaiverAlerts(
  state: Pick<LienWaiverWorkflowState, "dirty" | "paired" | "held" | "released">,
  waiverAutoLinkSkipReason?: Invoice["waiverAutoLinkSkipReason"],
  splitDocumentAction?: DocumentAction,
): DocumentAlert[] {
  const alerts: DocumentAlert[] = [];
  if (waiverAutoLinkSkipReason === "multi-waiver-bundle") {
    alerts.push({
      id: "multi-waiver-bundle",
      tone: "info",
      label: "This PDF looks like a bundle of multiple waivers (>2 pages), so auto-link was skipped. Split it first, then link each waiver.",
      action: splitDocumentAction,
    });
  }
  if (state.dirty) {
    alerts.push({ id: "dirty", sectionId: "details", tone: "warn", label: "Unsaved details", detail: "Claimant, job, through date, amount, or waiver type changes are pending save." });
  }
  if (!state.paired && !state.held && !state.released) {
    alerts.push({ id: "unpaired", sectionId: "pairing", tone: "warn", label: "No invoice paired", detail: "Pair the invoice it releases below, or hold it on the shelf to pair later." });
  }
  return alerts;
}
