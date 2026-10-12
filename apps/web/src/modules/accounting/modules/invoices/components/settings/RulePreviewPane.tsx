"use client";

import { RefreshCw } from "lucide-react";

import type { RulePreviewResult } from "@/modules/accounting/modules/invoices/components/settings/rulePreviewModel";
import { cn } from "@/modules/shared/lib/utils";

interface RulePreviewPaneProps {
  preview: RulePreviewResult;
  applyExisting: boolean;
}

export function RulePreviewPane({ preview, applyExisting }: RulePreviewPaneProps) {
  return (
    <aside className="flex min-h-0 flex-col rounded-lg border bg-muted/20">
      <header className="flex items-center gap-2 border-b bg-card px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <RefreshCw className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            <span className="font-mono">{preview.matchCount}</span> invoices match
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {applyExisting ? "Included when the rule is created" : "New invoices only"}
          </p>
        </div>
      </header>

      <div className="border-b px-4 py-3">
        <p
          className={cn(
            "text-xs",
            preview.kind === "placeholder" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
          )}
        >
          {preview.message}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {preview.rows.length > 0 ? (
          <div className="space-y-2">
            {preview.rows.map((row) => (
              <div key={row.id} className="rounded-lg border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.vendorName}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {row.invoiceNumber} - {row.jobNumber}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-semibold">
                    {formatAmount(row.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">
            No matching rows to show.
          </div>
        )}
      </div>
    </aside>
  );
}

function formatAmount(amount: number | null): string {
  if (amount === null) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}
