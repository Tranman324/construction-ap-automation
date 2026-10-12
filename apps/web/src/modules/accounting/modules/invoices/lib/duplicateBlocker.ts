import type { ApprovalBlockerDetail, BulkActionSkip } from "@/modules/accounting/modules/invoices/types/api";

/** Server approval-blocker code for an unresolved duplicate flag. */
export const DUPLICATE_UNRESOLVED_CODE = "DUPLICATE_UNRESOLVED";
export const DUPLICATE_UNRESOLVED_COPY = "Resolve the duplicate flag first.";

export function isDuplicateUnresolvedCode(code: unknown): boolean {
  return code === DUPLICATE_UNRESOLVED_CODE;
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}

/** Approve/bulk mutation error → distinct duplicate copy when the server code says so. */
export function isDuplicateUnresolvedError(error: unknown): boolean {
  return isDuplicateUnresolvedCode(errorCode(error));
}

/**
 * Served blockers and blockerDetails are index-aligned (approvalStateService).
 * Swap the duplicate blocker's server prose for the distinct resolve copy by code.
 */
export function presentApprovalBlockers(
  blockers: readonly string[],
  details?: readonly ApprovalBlockerDetail[] | null,
): string[] {
  return blockers.map((blocker, index) => (
    isDuplicateUnresolvedCode(details?.[index]?.code) ? DUPLICATE_UNRESOLVED_COPY : blocker
  ));
}

/** Count of bulk-approve skips caused by an unresolved duplicate flag. */
export function countDuplicateSkips(skipped: readonly BulkActionSkip[] | undefined): number {
  return (skipped ?? []).filter((skip) => isDuplicateUnresolvedCode(skip.code)).length;
}
