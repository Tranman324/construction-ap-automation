"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import type { ClosedPeriodApprovalRecovery } from "../../lib/approvalRecovery";
import type { ClosedPeriodTrayAction } from "./invoiceResolveModel";

/** Publish presentation only; the action bar retains recovery/transaction ownership. */
export function useClosedPeriodTrayAction(
  invoiceId: string,
  recovery: ClosedPeriodApprovalRecovery | null,
  disabled: boolean,
  run: () => void,
  onChange?: (action: ClosedPeriodTrayAction | null) => void,
) {
  const latest = useRef({ invoiceId, run, disabled, recovery });
  const mounted = useRef(false);
  const generation = useRef(0);
  useLayoutEffect(() => { generation.current += 1; }, [invoiceId]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => { latest.current = { invoiceId, run, disabled, recovery }; });
  const invoke = useCallback(() => {
    const current = latest.current;
    if (mounted.current && current.invoiceId === invoiceId && current.recovery && !current.disabled) current.run();
  }, [invoiceId]);
  const month = recovery?.invoiceDateMonth;
  const currentMonth = recovery?.currentMonth;
  const date = recovery?.suggestedInvoiceDate;
  const nextAction = recovery?.nextAction;
  useLayoutEffect(() => {
    const publishedGeneration = generation.current;
    onChange?.(month && currentMonth && date ? {
      invoiceId,
      recovery: { invoiceDateMonth: month, currentMonth, suggestedInvoiceDate: date, ...(nextAction ? { nextAction } : {}) },
      disabled,
      onUseSuggestedDate: () => { if (generation.current === publishedGeneration) invoke(); },
    } : null);
    return () => onChange?.(null);
  }, [onChange, invoiceId, month, currentMonth, date, nextAction, disabled, invoke]);
}
