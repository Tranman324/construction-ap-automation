"use client";

import { Loader2 } from "lucide-react";

import type { TitleRule } from "@/modules/platform-admin/types/admin";
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

interface TitleRuleDeleteDialogProps {
  open: boolean;
  rule: TitleRule | null;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function TitleRuleDeleteDialog({
  open,
  rule,
  isPending,
  onConfirm,
  onOpenChange,
}: TitleRuleDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{rule ? `Delete ${rule.pattern}?` : "Delete rule?"}</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the title matching rule immediately. Future previews and user assignments will no longer use it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete rule"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}