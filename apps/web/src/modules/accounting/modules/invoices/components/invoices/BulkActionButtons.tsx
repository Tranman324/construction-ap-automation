"use client";

import { useRef, type ReactNode } from "react";
import { Archive, FolderOpen, RotateCcw } from "lucide-react";

import { Button } from "@/modules/shared/components/ui/button";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { formatShortcutTooltip, useDocumentPanelKeyboardShortcuts, useDocumentShortcutLabels } from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";

interface BulkActionButtonsProps {
  isPending: boolean;
  onFileToDocuments: () => void;
  onTrash: () => void;
  onUnapprove: () => void;
  showTrash: boolean;
  submitAction?: ReactNode;
}

export function BulkActionButtons({
  isPending,
  onFileToDocuments,
  onTrash,
  onUnapprove,
  showTrash,
  submitAction,
}: BulkActionButtonsProps) {
  const shortcutRef = useRef(null);
  const shortcuts = useDocumentShortcutLabels();
  useDocumentPanelKeyboardShortcuts({
    primaryActionRef: shortcutRef,
    undoAction: null,
    previousAction: null,
    nextAction: null,
    discardAction: { disabled: !showTrash || isPending, run: onTrash },
  });
  return (
    <>
      {submitAction}
      <PermissionGate requires="accounting.invoices.approve">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={isPending}
          onClick={onUnapprove}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Undo Approve
        </Button>
      </PermissionGate>
      {showTrash && (
        <PermissionGate requires="accounting.invoices.delete">
          <Button
            data-invoice-discard="true"
            title={formatShortcutTooltip("Discard", shortcuts.discard)}
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={isPending}
            onClick={onTrash}
          >
            <Archive className="h-3.5 w-3.5" />
            Discard
          </Button>
        </PermissionGate>
      )}
      <PermissionGate requires="accounting.invoices.view_details">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={isPending}
          onClick={onFileToDocuments}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Shelve
        </Button>
      </PermissionGate>
    </>
  );
}
