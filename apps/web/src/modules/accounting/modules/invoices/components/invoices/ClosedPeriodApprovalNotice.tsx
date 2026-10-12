"use client";

import { CalendarClock } from "lucide-react";

import type { ClosedPeriodApprovalRecovery } from "@/modules/accounting/modules/invoices/lib/approvalRecovery";
import { Button } from "@/modules/shared/components/ui/button";

interface ClosedPeriodApprovalNoticeProps {
  recovery: ClosedPeriodApprovalRecovery;
  disabled?: boolean;
  onUseSuggestedDate: () => void;
}

export function ClosedPeriodApprovalNotice({
  recovery,
  disabled = false,
  onUseSuggestedDate,
}: ClosedPeriodApprovalNoticeProps) {
  return (
    <div role="alert" className="flex min-w-0 items-center gap-2">
      <CalendarClock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={`Invoice date falls in ${recovery.invoiceDateMonth} — a closed period. Only ${recovery.currentMonth} is open.`}>Invoice date falls in {recovery.invoiceDateMonth} — a closed period. Only {recovery.currentMonth} is open.</p>
        <Button type="button" variant="warning" size="sm" className="h-7 shrink-0 gap-1 px-[11px] text-xs font-semibold" disabled={disabled} onClick={onUseSuggestedDate}>
          Use {recovery.suggestedInvoiceDate}
        </Button>
    </div>
  );
}
