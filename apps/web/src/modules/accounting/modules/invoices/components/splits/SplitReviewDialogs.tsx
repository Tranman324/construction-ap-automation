"use client";

import { Loader2 } from "lucide-react";

import { PermissionGate } from "@/modules/shared/components/PermissionGate";
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

interface SplitReviewDialogsProps {
  singleDocumentOpen: boolean;
  singleDocumentPending: boolean;
  onSingleDocumentOpenChange: (open: boolean) => void;
  onConfirmSingleDocument: () => void;
}

export function SplitReviewDialogs({
  singleDocumentOpen,
  singleDocumentPending,
  onSingleDocumentOpenChange,
  onConfirmSingleDocument,
}: SplitReviewDialogsProps) {
  return (
    <AlertDialog open={singleDocumentOpen} onOpenChange={onSingleDocumentOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Treat as single document?</AlertDialogTitle>
          <AlertDialogDescription>
            This PDF will be moved back to the review queue as one multi-page document.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={singleDocumentPending}>Go back</AlertDialogCancel>
          <PermissionGate requires="accounting.invoices.manage_splits">
            <AlertDialogAction disabled={singleDocumentPending} onClick={onConfirmSingleDocument}>
              {singleDocumentPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Confirm
            </AlertDialogAction>
          </PermissionGate>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
