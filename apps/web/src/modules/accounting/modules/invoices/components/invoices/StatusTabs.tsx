"use client";

import { Trash2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/modules/shared/components/ui/tabs";
import type { DashboardStats } from "@/modules/accounting/modules/invoices/types/api";
import { cn } from "@/modules/shared/lib/utils";

interface StatusTabsProps {
  activeStatus: string;
  onStatusChange: (s: string) => void;
  stats: DashboardStats | undefined;
  trashCount?: number;
  onTrashClick?: () => void;
}

const TAB_ITEMS = [
  { value: "all",       label: "All",        statKey: "activeTotal" } as const,
  { value: "pending",   label: "Pending",    statKey: "pending"   } as const,
  { value: "approved",  label: "Approved",   statKey: "approved"  } as const,
  { value: "submitted", label: "Submitted",  statKey: "submitted" } as const,
  { value: "discarded", label: "Discarded",  statKey: "discarded" } as const,
  { value: "duplicate", label: "Duplicates", statKey: "duplicate" } as const,
];

export function StatusTabs({
  activeStatus,
  onStatusChange,
  stats,
  trashCount = 0,
  onTrashClick,
}: StatusTabsProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="overflow-x-auto">
        <Tabs value={activeStatus} onValueChange={onStatusChange}>
          <TabsList variant="line" className="gap-0">
            {TAB_ITEMS.map(({ value, label, statKey }) => {
              const count =
                statKey && stats ? (stats[statKey] as number) : null;
              return (
                <TabsTrigger key={value} value={value} className="gap-1.5">
                  {label}
                  {count !== null && (
                    <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums leading-none text-muted-foreground">
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      {onTrashClick && (
        <button
          type="button"
          onClick={onTrashClick}
          className={cn(
            "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            trashCount > 0
              ? "border-border bg-muted/50 text-foreground hover:bg-muted"
              : "border-dashed border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/40",
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Trash</span>
          {trashCount > 0 && (
            <span className="rounded-full bg-background px-1.5 py-0.5 text-3xs tabular-nums leading-none text-muted-foreground">
              {trashCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
