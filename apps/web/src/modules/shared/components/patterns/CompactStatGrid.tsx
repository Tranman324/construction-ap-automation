import type { ReactNode } from "react";

import { cn } from "@/modules/shared/lib/utils";

export interface CompactStatItem {
  ariaLabel?: string;
  label: string;
  value: ReactNode;
}

export interface CompactStatGridProps {
  className?: string;
  columns?: 2 | 3 | 4;
  items: CompactStatItem[];
}

const GRID_COLUMNS: Record<NonNullable<CompactStatGridProps["columns"]>, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

export function CompactStatGrid({
  className,
  columns = 3,
  items,
}: CompactStatGridProps) {
  return (
    <div className={cn("grid gap-2", GRID_COLUMNS[columns], className)}>
      {items.map((item) => (
        <div key={item.label} className="rounded-md border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums" aria-label={item.ariaLabel}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}
