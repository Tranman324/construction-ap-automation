"use client";

import { useState } from "react";
import { Archive, Trash2, X } from "lucide-react";

import { useBulkAction, useDeleteInvoice } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/modules/shared/components/ui/dialog";

interface DocumentShelfSelectionBarProps {
  selectedIds: string[];
  onClear: () => void;
}

export function DocumentShelfSelectionBar({ selectedIds, onClear }: DocumentShelfSelectionBarProps) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const bulkAction = useBulkAction();
  const deleteInvoice = useDeleteInvoice();

  if (selectedIds.length === 0) return null;

  function runBulkAction(action: "file" | "discard") {
    bulkAction.mutate({ ids: selectedIds, action }, { onSuccess: onClear });
  }

  function handleBulkDelete() {
    const ids = [...selectedIds];
    let index = 0;
    function next() {
      const id = ids[index];
      if (!id) {
        setDeleteConfirmOpen(false);
        onClear();
        return;
      }
      deleteInvoice.mutate({ id }, { onSuccess: () => { index += 1; next(); } });
    }
    next();
  }

  return (
    <>
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border bg-popover px-4 py-2.5 shadow-xl">
        <span className="mr-2 text-sm font-medium text-muted-foreground">
          {selectedIds.length} document{selectedIds.length === 1 ? "" : "s"} selected
        </span>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-teal-200 text-teal-600 hover:bg-teal-50"
          disabled={bulkAction.isPending}
          onClick={() => runBulkAction("file")}
        >
          <Archive className="h-3.5 w-3.5" />
          Shelve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={bulkAction.isPending}
          onClick={() => runBulkAction("discard")}
        >
          <Archive className="h-3.5 w-3.5" />
          Discard
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
          disabled={deleteInvoice.isPending}
          onClick={() => setDeleteConfirmOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
        <Button size="icon" variant="ghost" className="ml-1 h-7 w-7" aria-label="Clear selection" onClick={onClear}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.length} document{selectedIds.length === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the selected document records and associated files. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteInvoice.isPending} onClick={handleBulkDelete}>
              {deleteInvoice.isPending ? "Deleting..." : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
