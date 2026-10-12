"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

interface SplitProcessingPlaceholderProps {
  invoice: Invoice;
  onRefresh: () => void;
}

export function SplitProcessingPlaceholder({
  invoice,
  onRefresh,
}: SplitProcessingPlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <div className="rounded-full bg-blue-50 dark:bg-blue-950/30 p-4">
        <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          This document is still being processed
        </h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {invoice.file} was split from a multi-page PDF and is currently being
          classified and extracted. It will appear in the review queue shortly.
        </p>
        {invoice.email?.from && (
          <p className="text-xs text-muted-foreground">
            From: {invoice.email.from}
          </p>
        )}
      </div>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={onRefresh}>
        <RefreshCw className="h-3.5 w-3.5" />
        Check again
      </Button>
    </div>
  );
}
