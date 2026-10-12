// Toolbox 3.0 — shared pattern component.
// Target path in the app: src/modules/shared/components/patterns/StatGrid.tsx
import type { ReactNode } from "react";
import { cn } from "@/modules/shared/lib/utils";

export interface StatGridProps {
  /** Max columns at full width (4 default). Collapses to 2, then 1. */
  cols?: 2 | 3 | 4 | 5 | 6;
  children?: ReactNode;
  className?: string;
}

// Whole class strings per col count so Tailwind JIT sees them.
const COLS: Record<NonNullable<StatGridProps["cols"]>, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-5",
  6: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
};

/** Responsive grid for MetricCards — the canonical dashboard "bento" row. */
export function StatGrid({ cols = 4, children, className }: StatGridProps) {
  return <div className={cn("grid gap-4", COLS[cols], className)}>{children}</div>;
}
