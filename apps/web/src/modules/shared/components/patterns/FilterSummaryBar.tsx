import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

export interface FilterSummaryBarProps {
  children: ReactNode;
  className?: string;
  clearLabel?: string;
  onClear: () => void;
}

export function FilterSummaryBar({
  children,
  className,
  clearLabel = "Clear filters",
  onClear,
}: FilterSummaryBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-[13px] text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground",
        className,
      )}
    >
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 gap-1.5 px-2 text-xs font-medium"
        onClick={onClear}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
        {clearLabel}
      </Button>
      <span>{children}</span>
    </div>
  );
}
