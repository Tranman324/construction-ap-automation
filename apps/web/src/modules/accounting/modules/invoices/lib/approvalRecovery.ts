import type { ApprovalBlockerDetail } from "@/modules/accounting/modules/invoices/types/api";
import { isApiError, type ApiError } from "@/modules/shared/lib/api";

export interface ClosedPeriodApprovalRecovery {
  invoiceDateMonth: string;
  currentMonth: string;
  suggestedInvoiceDate: string;
  nextAction?: string;
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

export function getClosedPeriodRecovery(
  detail: ApprovalBlockerDetail | null | undefined,
): ClosedPeriodApprovalRecovery | null {
  if (detail?.code !== "CLOSED_PERIOD_DATE") return null;
  const invoiceDateMonth = hasText(detail.invoiceDateMonth)
    ? detail.invoiceDateMonth
    : detail.glDateMonth;
  const suggestedInvoiceDate = hasText(detail.suggestedInvoiceDate)
    ? detail.suggestedInvoiceDate
    : detail.suggestedGlDate;
  if (!hasText(invoiceDateMonth) || !hasText(detail.currentMonth) || !hasText(suggestedInvoiceDate)) {
    return null;
  }

  return {
    invoiceDateMonth,
    currentMonth: detail.currentMonth,
    suggestedInvoiceDate,
    ...(hasText(detail.nextAction) ? { nextAction: detail.nextAction } : {}),
  };
}

export function getClosedPeriodRecoveryFromDetails(
  details: readonly ApprovalBlockerDetail[] | undefined,
): ClosedPeriodApprovalRecovery | null {
  return details?.map(getClosedPeriodRecovery).find((recovery) => recovery !== null) ?? null;
}

export function getClosedPeriodRecoveryFromError(
  error: unknown,
): ClosedPeriodApprovalRecovery | null {
  if (!isApiError(error)) return null;
  const structuredError = error as ApiError;
  return getClosedPeriodRecovery({
    code: structuredError.code ?? "",
    invoiceDateMonth: structuredError.invoiceDateMonth,
    glDateMonth: structuredError.glDateMonth,
    currentMonth: structuredError.currentMonth,
    suggestedInvoiceDate: structuredError.suggestedInvoiceDate,
    suggestedGlDate: structuredError.suggestedGlDate,
    nextAction: structuredError.nextAction,
  });
}
