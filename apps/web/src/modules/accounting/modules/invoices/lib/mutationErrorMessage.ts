import { isApiError, type ApiError } from "@/modules/shared/lib/api";

export const APPROVED_INVOICE_LINKAGE_REASON =
  "Approved invoices are locked — unapprove first to change waiver linkage.";

export function isWaiverParentStatusProtectedError(error: unknown): error is ApiError {
  return isApiError(error)
    && error.status === 409
    && error.code === "WAIVER_PARENT_STATUS_PROTECTED";
}

export function mutationErrorMessage(error: unknown, fallback: string): string {
  if (isApiError(error) && error.message.trim()) return error.message;
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
