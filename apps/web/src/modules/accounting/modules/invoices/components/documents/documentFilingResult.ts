import type { DocumentFilingResult } from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { isApiError } from "@/modules/shared/lib/api";
import { toast } from "@/modules/shared/components/ui/toaster";

/**
 * The API client exposes structured errors as plain objects, so `instanceof
 * Error` is not reliable for filing failures. Keep the literal server message
 * for the persistent panel alert and toast fallback.
 */
export function getFilingErrorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Filing failed.";
}

function readFileNameValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "object" && value !== null && "value" in value) {
    const candidate = (value as { value?: unknown }).value;
    return typeof candidate === "string" && candidate.trim() ? candidate : null;
  }
  return null;
}

/** Return the actual historical upload name before any current candidate. */
export function getServerFilingFileName(record: Invoice): string {
  return record.sharePointFilename ?? readFileNameValue(record.filing?.fileName) ?? record.file;
}

export function showFileToProjectResultToast(
  result: DocumentFilingResult,
  successDescription: string,
): boolean {
  const response = result && typeof result === "object" ? result : undefined;
  const sharePoint = response?.sharePoint;

  if (sharePoint?.uploaded === false) {
    const persistedFiling = response?.invoice?.filed === true;
    const filingState = persistedFiling
      ? "Existing Documents filing is unchanged."
      : "Document remains unfiled.";
    toast.error("File to Project failed", {
      description: `SharePoint upload failed. ${filingState} ${sharePoint.error ?? "Upload did not complete."}`,
    });
    return false;
  }

  if (sharePoint?.warning) {
    toast.warning("File to Project warning", {
      description: `${successDescription} Metadata warning: ${sharePoint.warning}`,
    });
    return true;
  }

  toast.success("File to Project", {
    description: successDescription,
  });
  return true;
}
