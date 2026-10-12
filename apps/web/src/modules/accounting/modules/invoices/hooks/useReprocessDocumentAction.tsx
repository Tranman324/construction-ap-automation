"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { useReprocessInvoice } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { mutationErrorMessage } from "@/modules/accounting/modules/invoices/lib/mutationErrorMessage";
import type { DocumentAction } from "@/modules/accounting/modules/invoices/types/documentSpec";
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
import { toast } from "@/modules/shared/components/ui/toaster";

interface ReprocessDocumentActionOptions {
  documentId?: string;
  enabled?: boolean;
}

export function useReprocessDocumentAction({
  documentId,
  enabled = true,
}: ReprocessDocumentActionOptions) {
  const [open, setOpen] = useState(false);
  const reprocess = useReprocessInvoice();
  const available = enabled && Boolean(documentId);

  const action = useMemo<DocumentAction | undefined>(() => {
    if (!available) return undefined;

    return {
      id: "reprocess-document",
      label: reprocess.isPending ? "Reprocessing" : "Reprocess",
      icon: RefreshCw,
      pending: reprocess.isPending,
      disabled: reprocess.isPending,
      onClick: () => setOpen(true),
    };
  }, [available, reprocess.isPending]);

  function confirmReprocess() {
    if (!documentId || reprocess.isPending) return;

    reprocess.mutate(
      { id: documentId },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success("Reprocessing started", {
            description: "The request was accepted. Document status will update after processing finishes.",
          });
        },
        onError: (error: Error) => {
          toast.error("Reprocess failed", {
            description: mutationErrorMessage(error, "The document could not be reprocessed."),
          });
        },
      },
    );
  }

  const dialog = (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !reprocess.isPending && setOpen(nextOpen)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reprocess this document?</AlertDialogTitle>
          <AlertDialogDescription>
            Reprocessing will overwrite derived and extracted fields with newly processed values.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={reprocess.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={reprocess.isPending}
            onClick={(event) => {
              event.preventDefault();
              confirmReprocess();
            }}
          >
            {reprocess.isPending ? "Reprocessing…" : "Reprocess"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { action, dialog };
}
