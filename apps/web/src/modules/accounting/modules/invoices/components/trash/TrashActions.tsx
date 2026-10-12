"use client";

import { useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/modules/shared/components/ui/alert-dialog";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { Button } from "@/modules/shared/components/ui/button";
import {
  usePermanentDelete,
  useRestoreInvoice,
} from "@/modules/accounting/modules/invoices/hooks/mutations";
import type { RestoreInvoiceResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { toast } from "@/modules/shared/components/ui/toaster";

interface TrashActionsProps {
  invoice: Invoice;
}

function getInvoiceLabel(invoice: Invoice): string {
  return invoice.extracted?.invoiceNumber ?? invoice.file ?? invoice.id;
}

function isFilterDiscard(invoice: Invoice): boolean {
  return invoice.discardSource === "auto-ai"
    || invoice.discardSource === "rule-filter"
    || invoice.discardSource === "junk-hash";
}

export function TrashActions({ invoice }: TrashActionsProps) {
  const restoreInvoice = useRestoreInvoice();
  const permanentDelete = usePermanentDelete();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [isRestoringFiltered, setIsRestoringFiltered] = useState(false);

  function handleRestore(fromFilterConfirmation = false) {
    if (fromFilterConfirmation) setIsRestoringFiltered(true);
    restoreInvoice.mutate(
      { id: invoice.id },
      {
        onSuccess: (result: RestoreInvoiceResponse) => {
          toast.success("Invoice restored", {
            description: `${getInvoiceLabel(invoice)} restored to ${result.status}.`,
          });
          if (fromFilterConfirmation) {
            setIsRestoringFiltered(false);
            setRestoreConfirmOpen(false);
          }
        },
        onError: (error: Error) => {
          toast.error("Restore failed", {
            description: error.message || "Please try again.",
          });
          if (fromFilterConfirmation) setIsRestoringFiltered(false);
        },
      },
    );
  }

  function handlePermanentDelete() {
    permanentDelete.mutate(
      { id: invoice.id },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          toast.success("Invoice permanently deleted", {
            description: `${getInvoiceLabel(invoice)} has been removed.`,
          });
        },
        onError: (error: Error) => {
          setConfirmOpen(false);
          toast.error("Permanent delete failed", {
            description: error.message || "Please try again.",
          });
        },
      },
    );
  }

  function requestRestore() {
    if (isFilterDiscard(invoice)) {
      setRestoreConfirmOpen(true);
      return;
    }
    handleRestore();
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <PermissionGate requires="accounting.invoices.delete">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={restoreInvoice.isPending || permanentDelete.isPending || isRestoringFiltered}
            onClick={requestRestore}
          >
            {restoreInvoice.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin duration-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Restore
          </Button>
        </PermissionGate>

        <PermissionGate requires="accounting.invoices.delete">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive text-xs"
            disabled={restoreInvoice.isPending || permanentDelete.isPending || isRestoringFiltered}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Permanently
          </Button>
        </PermissionGate>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the invoice record and its PDF. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={permanentDelete.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={permanentDelete.isPending}
              onClick={handlePermanentDelete}
            >
              {permanentDelete.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin duration-spin" />
                  Deleting…
                </>
              ) : (
                "Delete Permanently"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={restoreConfirmOpen}
        onOpenChange={(open) => {
          if (!isRestoringFiltered) setRestoreConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore auto-filtered file?</AlertDialogTitle>
            <AlertDialogDescription>
              This file was auto-filtered as junk. Restoring removes it from the junk list — future copies of this file will be processed normally.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreInvoice.isPending || isRestoringFiltered}>Cancel</AlertDialogCancel>
            <Button disabled={restoreInvoice.isPending || isRestoringFiltered} onClick={() => handleRestore(true)}>
              {restoreInvoice.isPending || isRestoringFiltered ? "Restoring…" : "Restore"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
