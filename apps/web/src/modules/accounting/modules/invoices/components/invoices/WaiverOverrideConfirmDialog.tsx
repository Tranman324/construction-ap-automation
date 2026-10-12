"use client";

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

export type WaiverOverrideDialogMode = "set" | "revert";

interface WaiverOverrideConfirmDialogProps {
  mode: WaiverOverrideDialogMode | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function WaiverOverrideConfirmDialog({
  mode,
  onOpenChange,
  onConfirm,
}: WaiverOverrideConfirmDialogProps) {
  const settingOverride = mode === "set";

  return (
    <AlertDialog open={mode !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {settingOverride ? "Mark waiver on this document?" : "Clear waiver on this document?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {settingOverride
              ? "This records that the signed lien waiver is embedded in the invoice document and clears the missing-waiver warning."
              : "This clears the document-level waiver mark. If no separate waiver is linked, the missing-waiver warning will return."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {settingOverride ? "Mark waiver" : "Clear waiver"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
