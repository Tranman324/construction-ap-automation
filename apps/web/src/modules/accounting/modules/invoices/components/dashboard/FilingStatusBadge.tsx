"use client";

import { Archive, FolderCheck } from "lucide-react";

import { Badge } from "@/modules/shared/components/ui/badge";
import { getFilingStatus, type Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

interface FilingStatusBadgeProps {
  invoice: Invoice;
}

export function FilingStatusBadge({ invoice }: FilingStatusBadgeProps) {
  const status = getFilingStatus(invoice);

  if (status === "unfiled") return null;

  if (status === "sp-filed") {
    return (
      <Badge
        variant="outline"
        className="w-fit gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
      >
        <FolderCheck className="h-3 w-3" aria-hidden="true" />
        Filed to SP
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="w-fit gap-1 border-muted-foreground/20 bg-muted text-muted-foreground"
    >
      <Archive className="h-3 w-3" aria-hidden="true" />
      Shelved
    </Badge>
  );
}
