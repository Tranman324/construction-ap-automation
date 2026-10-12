"use client";

import type { RuleWorkspaceStats } from "@/modules/accounting/modules/invoices/components/settings/ruleWorkspaceModel";
import { cn } from "@/modules/shared/lib/utils";

interface RuleStatStripProps {
  stats: RuleWorkspaceStats;
}

export function RuleStatStrip({ stats }: RuleStatStripProps) {
  const items = [
    { label: "Active rules", value: `${stats.active}/${stats.total}`, className: "text-primary" },
    { label: "Disabled", value: stats.disabled.toString(), className: "text-muted-foreground" },
    { label: "Guarded", value: stats.stopOnMatch.toString(), className: "text-amber-600 dark:text-amber-400" },
    { label: "Actions", value: stats.actionCount.toString(), className: "text-emerald-600 dark:text-emerald-400" },
    { label: "Latest update", value: stats.latestUpdatedAt?.slice(0, 10) ?? "None", className: "text-foreground" },
  ];

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <div className={cn("truncate font-mono text-lg font-bold tabular-nums", item.className)}>{item.value}</div>
          <div className="truncate text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
