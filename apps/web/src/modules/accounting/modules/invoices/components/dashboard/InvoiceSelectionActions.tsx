"use client";

import { BulkActionBar } from "@/modules/accounting/modules/invoices/components/invoices/BulkActionBar";

interface InvoiceSelectionActionsProps {
  selectedIds: string[];
  onClear: () => void;
}

export function InvoiceSelectionActions({
  selectedIds,
  onClear,
}: InvoiceSelectionActionsProps) {
  return (
    <BulkActionBar
      selectedIds={selectedIds}
      onClear={onClear}
      mode="inline-actions"
      showTrash
    />
  );
}
