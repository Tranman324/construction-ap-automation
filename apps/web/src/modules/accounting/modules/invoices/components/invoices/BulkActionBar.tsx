"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/modules/shared/components/ui/button";
import { useBulkAction } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { BulkActionButtons } from "@/modules/accounting/modules/invoices/components/invoices/BulkActionButtons";
import { BulkTrashDialog } from "@/modules/accounting/modules/invoices/components/invoices/BulkTrashDialog";
import { toast } from "@/modules/shared/components/ui/toaster";
import type { BulkActionPayload } from "@/modules/accounting/modules/invoices/types/api";
import {
  DUPLICATE_UNRESOLVED_COPY,
  countDuplicateSkips,
  isDuplicateUnresolvedError,
} from "@/modules/accounting/modules/invoices/lib/duplicateBlocker";

interface BulkActionBarProps {
  selectedIds: string[];
  onClear: () => void;
  mode?: "fixed" | "inline-actions";
  showTrash?: boolean;
  submitAction?: React.ReactNode;
}

function formatInvoiceCount(count: number): string {
  return `${count} invoice${count !== 1 ? "s" : ""}`;
}

/** Bulk approve reports duplicate blocks as DUPLICATE_UNRESOLVED skips or errors. */
function formatBulkActionError(err: Error, fallback: string): string {
  return isDuplicateUnresolvedError(err) ? DUPLICATE_UNRESOLVED_COPY : err.message || fallback;
}

export function BulkActionBar({
  selectedIds,
  onClear,
  mode = "fixed",
  showTrash = false,
  submitAction,
}: BulkActionBarProps) {
  const [trashOpen, setTrashOpen] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const bulkAction = useBulkAction();

  if (selectedIds.length === 0) return null;
  const count = selectedIds.length;
  const label = `${count} invoice${count !== 1 ? "s" : ""} selected`;

  function handleBulkAction(
    action: BulkActionPayload["action"],
    successTitle: string,
    errorTitle: string,
    onSuccessComplete: () => void = onClear,
  ) {
    setActionError(null);
    bulkAction.mutate(
      { ids: selectedIds, action },
      {
        onSuccess: (data) => {
          const duplicateSkips = countDuplicateSkips(data.skippedInvoices);
          if (duplicateSkips > 0) {
            const message = `${DUPLICATE_UNRESOLVED_COPY} ${formatInvoiceCount(duplicateSkips)} skipped.`;
            setActionError(message);
            toast.error(errorTitle, { description: message });
            return;
          }
          toast.success(successTitle, {
            description: `${formatInvoiceCount(data.updated ?? count)} updated.`,
          });
          onSuccessComplete();
        },
        onError: (err: Error) => {
          const message = formatBulkActionError(err, errorTitle);
          setActionError(message);
          toast.error(errorTitle, { description: message });
        },
      }
    );
  }
  const isPending = bulkAction.isPending;
  const actionButtons = (
    <BulkActionButtons
      isPending={isPending}
      onFileToDocuments={() =>
        handleBulkAction("file", "Invoices shelved", "Failed to shelve invoices.")
      }
      onTrash={() => setTrashOpen(true)}
      onUnapprove={() =>
        handleBulkAction("unapprove", "Invoices moved to pending", "Failed to move invoices to pending.")
      }
      showTrash={showTrash}
      submitAction={submitAction}
    />
  );
  const trashDialog = (
    <BulkTrashDialog
      count={count}
      isPending={isPending}
      onConfirm={() =>
        handleBulkAction(
          "discard",
          "Invoices discarded",
          "Failed to discard invoices.",
          () => {
            setTrashOpen(false);
            onClear();
          },
        )
      }
      onOpenChange={setTrashOpen}
      open={trashOpen}
    />
  );
  if (mode === "inline-actions") {
    return (
      <>
        {actionError && <span className="text-xs text-destructive">{actionError}</span>}
        {actionButtons}
        {trashDialog}
      </>
    );
  }
  return (
    <>
      <div
        className="fixed bottom-0 z-50 flex items-center gap-3 border-t bg-background px-6 py-3 shadow-lg"
        style={{ left: "var(--sidebar-width, 250px)", right: 0 }}
      >
        <span className="text-sm font-medium text-foreground">{label}</span>
        {actionError && <span className="text-xs text-destructive">{actionError}</span>}
        <div className="ml-auto flex items-center gap-2">
          {actionButtons}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 text-muted-foreground"
          disabled={isPending}
          onClick={onClear}
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      </div>
      {trashDialog}
    </>
  );
}
