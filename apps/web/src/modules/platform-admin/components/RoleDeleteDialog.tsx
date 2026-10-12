"use client";

import { Loader2 } from "lucide-react";

import { formatAdminRoleName } from "@/modules/platform-admin/lib/adminRoles";
import type { AdminRole } from "@/modules/platform-admin/types/admin";
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

interface RoleDeleteDialogProps {
  open: boolean;
  role: AdminRole | null;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function RoleDeleteDialog({
  open,
  role,
  isPending,
  onConfirm,
  onOpenChange,
}: RoleDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{role ? `Delete ${formatAdminRoleName(role.name)}?` : "Delete role?"}</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the custom role definition. Assigned-user conflicts will block deletion until users are reassigned.
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
              "Delete role"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}