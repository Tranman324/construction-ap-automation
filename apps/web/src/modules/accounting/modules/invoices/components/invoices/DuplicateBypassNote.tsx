"use client";

import { RotateCcw } from "lucide-react";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { DuplicateStatusResponse } from "@/modules/accounting/modules/invoices/types/api";
import { useRevertDuplicateBypass } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { Button } from "@/modules/shared/components/ui/button";
import { toast } from "@/modules/shared/components/ui/toaster";
import { formatDuplicateDate } from "@/modules/accounting/modules/invoices/lib/duplicateFormat";

interface DuplicateBypassNoteProps {
  invoice: Invoice;
  duplicateStatus?: DuplicateStatusResponse | null;
}

/** The bypass record: live status first, served invoice fields as the fallback. */
function bypassRecord(invoice: Invoice, status?: DuplicateStatusResponse | null) {
  if (status) {
    return status.state === "none" && status.bypassed ? status.bypassed : null;
  }
  return invoice.duplicateBypassed
    ? { at: invoice.duplicateBypassedAt ?? null, by: invoice.duplicateBypassedBy ?? null }
    : null;
}

/** Line 2 of the card; drops the "by" or "on" part when that datum is missing. */
function bypassDetail(record: { at: string | null; by: string | null }): string {
  const on = formatDuplicateDate(record.at);
  const who = [record.by ? `by ${record.by}` : null, on ? `on ${on}` : null].filter(Boolean).join(" ");
  return who ? `${who} · Approve is open again` : "Approve is open again";
}

/** Details-tab status card for a bypassed duplicate flag (not a tray row). */
export function DuplicateBypassNote({ invoice, duplicateStatus }: DuplicateBypassNoteProps) {
  const revert = useRevertDuplicateBypass();
  const record = bypassRecord(invoice, duplicateStatus);
  if (!record) return null;

  function restore() {
    revert.mutate({ id: invoice.id }, {
      onSuccess: () => toast.success("Duplicate flag restored"),
      onError: (error) => toast.error("Could not restore duplicate flag", { description: error.message }),
    });
  }

  return (
    <div className="mb-[18px] shrink-0 rounded-[10px] border border-border bg-card p-3" data-testid="duplicate-bypass-note">
      <div className="flex items-center gap-2">
        <p className="mr-auto min-w-0 text-[12.5px] font-semibold text-foreground">Duplicate flag bypassed</p>
        <PermissionGate requires="accounting.invoices.approve">
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-[11px] text-xs" disabled={revert.isPending} onClick={restore}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {revert.isPending ? "Restoring…" : "Restore flag"}
          </Button>
        </PermissionGate>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{bypassDetail(record)}</p>
    </div>
  );
}
