"use client";

import { Button } from "@/modules/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/modules/shared/components/ui/dialog";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { Textarea } from "@/modules/shared/components/ui/textarea";

interface BulkRejectDialogProps {
  count: number;
  error: string | null;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onReasonChange: (reason: string) => void;
  open: boolean;
  reason: string;
}

export function BulkRejectDialog({
  count,
  error,
  isPending,
  onConfirm,
  onOpenChange,
  onReasonChange,
  open,
  reason,
}: BulkRejectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Reject {count} invoice{count !== 1 ? "s" : ""}?
          </DialogTitle>
          <DialogDescription>
            Optionally add a note explaining the reason for rejection.{" "}
            <span className="text-muted-foreground">
              (Note: rejection reason is not currently forwarded to the API; tracked for future support.)
            </span>
          </DialogDescription>
        </DialogHeader>

        <Textarea
          placeholder="Reason for rejection (optional)"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          rows={3}
          className="resize-none"
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <PermissionGate requires="accounting.invoices.reject">
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? "Rejecting..." : `Reject ${count}`}
            </Button>
          </PermissionGate>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
