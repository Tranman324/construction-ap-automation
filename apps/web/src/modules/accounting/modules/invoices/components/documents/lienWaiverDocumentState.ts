import {
  getLienWaiverDocumentData,
  getLienWaiverInitialSnapshot,
  isLienWaiverSnapshotDirty,
  type LienWaiverEditableSnapshot,
  type LienWaiverWorkflowState,
} from "@/modules/accounting/modules/invoices/components/documents/lienWaiverDocumentModel";
import type { DocumentFormState } from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

export interface LienWaiverDocumentFormState extends DocumentFormState {
  vendorCode: string | null;
  jobNumber: string | null;
  amountInput: string;
  throughDate: string;
  savedVendorCode: string | null;
  savedJobNumber: string | null;
  savedAmountInput: string;
  savedThroughDate: string;
  waiverType: string;
  savedWaiverType: string;
  linkedInvoiceId: string | null;
  destination: string;
  filename: string;
  destinationAbsolute?: string;
  held: boolean;
  holding: boolean;
  holdReason: string;
  released: boolean;
  filing: boolean;
  saveError: string | null;
}

export interface LienWaiverSnapshotPair {
  currentSnapshot: LienWaiverEditableSnapshot;
  savedSnapshot: LienWaiverEditableSnapshot;
}

export interface LienWaiverWorkflowSummary extends LienWaiverSnapshotPair {
  dirty: boolean;
  paired: boolean;
  held: boolean;
  workflowState: LienWaiverWorkflowState;
}

export function getLienWaiverInitialForm(
  record: Invoice,
  defaultDestination: string,
): LienWaiverDocumentFormState {
  const data = getLienWaiverDocumentData(record);
  const snapshot = getLienWaiverInitialSnapshot(record);
  return {
    vendorCode: snapshot.vendorCode,
    jobNumber: snapshot.jobNumber,
    amountInput: snapshot.amountInput,
    throughDate: snapshot.throughDate,
    savedVendorCode: snapshot.vendorCode,
    savedJobNumber: snapshot.jobNumber,
    savedAmountInput: snapshot.amountInput,
    savedThroughDate: snapshot.throughDate,
    waiverType: snapshot.waiverType,
    savedWaiverType: snapshot.waiverType,
    linkedInvoiceId: data.linkedInvoiceId,
    destination: defaultDestination,
    filename: record.filing?.fileName?.value ?? "",
    destinationAbsolute: undefined,
    // Explicit server-derived state (CONTRACTS.md §waiver state) — not inferred
    // from raw filed/sp_file_url/status columns.
    held: data.shelved,
    holding: false,
    holdReason: "",
    released: data.released,
    filing: false,
    saveError: null,
  };
}

export function getLienWaiverSnapshots(
  form: LienWaiverDocumentFormState,
): LienWaiverSnapshotPair {
  return {
    currentSnapshot: {
      vendorCode: form.vendorCode,
      jobNumber: form.jobNumber,
      amountInput: form.amountInput,
      throughDate: form.throughDate,
      waiverType: form.waiverType,
    },
    savedSnapshot: {
      vendorCode: form.savedVendorCode,
      jobNumber: form.savedJobNumber,
      amountInput: form.savedAmountInput,
      throughDate: form.savedThroughDate,
      waiverType: form.savedWaiverType,
    },
  };
}

export function getLienWaiverWorkflowSummary(
  form: LienWaiverDocumentFormState,
): LienWaiverWorkflowSummary {
  const snapshots = getLienWaiverSnapshots(form);
  const dirty = isLienWaiverSnapshotDirty(snapshots.currentSnapshot, snapshots.savedSnapshot);
  const paired = Boolean(form.linkedInvoiceId);
  const held = form.held && !paired && !form.released;
  const workflowState: LienWaiverWorkflowState = {
    vendorCode: form.vendorCode,
    jobNumber: form.jobNumber,
    amountInput: form.amountInput,
    linkedInvoiceId: form.linkedInvoiceId,
    dirty,
    paired,
    held,
    released: form.released,
  };

  return {
    ...snapshots,
    dirty,
    paired,
    held,
    workflowState,
  };
}
