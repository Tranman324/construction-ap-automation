import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

export interface CollaborationStateOptions {
  /** Inspection-only routes may be read-only without representing a trash record. */
  readOnly?: boolean;
  /** Global-search Trash navigation is authoritative when the record status is stale. */
  trashOverride?: boolean;
}

export interface CollaborationState {
  isTrash: boolean;
  readOnly: boolean;
  lockedReason?: string;
}

/**
 * Keeps Activity capabilities identical across invoice and document-panel entrypoints.
 * Server permission props remain authoritative; this only derives client-side lifecycle locks.
 */
export function getCollaborationState(
  record: Pick<Invoice, "status" | "isTrash">,
  options: CollaborationStateOptions = {},
): CollaborationState {
  const isTrash = options.trashOverride === true || record.isTrash === true || record.status === "discarded";
  const readOnly = options.readOnly === true || isTrash || record.status === "approved" || record.status === "submitted";
  const lockedReason = isTrash
    ? "Activity is locked — document is in Trash."
    : record.status === "submitted"
      ? "Activity is locked — submitted to Spectrum."
      : record.status === "approved"
        ? "Activity is locked — document is approved."
        : undefined;

  return { isTrash, readOnly, lockedReason };
}
