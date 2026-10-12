"use client";

import { Loader2 } from "lucide-react";

import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { Button } from "@/modules/shared/components/ui/button";

interface SplitReviewFooterProps {
  valid: boolean;
  firstError: string | null;
  unassignedCount: number;
  groupCount: number;
  isMutating: boolean;
  confirmPending: boolean;
  confirmError: string | null;
  onTreatAsSingleDocument: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SplitReviewFooter({
  valid,
  firstError,
  unassignedCount,
  groupCount,
  isMutating,
  confirmPending,
  confirmError,
  onTreatAsSingleDocument,
  onCancel,
  onConfirm,
}: SplitReviewFooterProps) {
  return (
    <>
      <footer className="flex shrink-0 items-center gap-2 border-t bg-card px-4 py-3">
        <PermissionGate requires="accounting.invoices.manage_splits">
          <Button variant="outline" size="sm" disabled={isMutating} onClick={onTreatAsSingleDocument}>
            Treat as single doc
          </Button>
        </PermissionGate>
        <Button variant="ghost" size="sm" disabled={isMutating} onClick={onCancel}>
          Cancel
        </Button>
        <div className="min-w-0 flex-1">
          {firstError ? (
            <p className="truncate text-xs text-amber-600 dark:text-amber-300">{firstError}</p>
          ) : unassignedCount > 0 ? (
            <p className="truncate text-xs text-amber-600 dark:text-amber-300">{unassignedCount} unassigned</p>
          ) : null}
        </div>
        <PermissionGate requires="accounting.invoices.manage_splits">
          <Button size="sm" className="gap-1.5" disabled={!valid || isMutating} onClick={onConfirm}>
            {confirmPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Confirm Split ({groupCount})
          </Button>
        </PermissionGate>
      </footer>
      {confirmError ? (
        <div className="border-t border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {confirmError}
        </div>
      ) : null}
    </>
  );
}
