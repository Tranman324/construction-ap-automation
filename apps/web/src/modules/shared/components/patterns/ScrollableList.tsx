import type { ReactNode } from "react";

import { cn } from "@/modules/shared/lib/utils";

export interface ScrollableListProps {
  ariaLabel: string;
  children?: ReactNode;
  className?: string;
  maxHeight?: "sm" | "md" | "lg";
}

export interface ScrollableListRowProps {
  active?: boolean;
  ariaLabel?: string;
  children?: ReactNode;
  className?: string;
}

const MAX_HEIGHT: Record<NonNullable<ScrollableListProps["maxHeight"]>, string> = {
  sm: "max-h-72",
  md: "max-h-[360px]",
  lg: "max-h-[28rem]",
};

export function ScrollableList({
  ariaLabel,
  children,
  className,
  maxHeight = "md",
}: ScrollableListProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn("overflow-y-auto rounded-md border bg-background", MAX_HEIGHT[maxHeight], className)}
    >
      {children}
    </div>
  );
}

export function ScrollableListRow({
  active = false,
  ariaLabel,
  children,
  className,
}: ScrollableListRowProps) {
  return (
    <div
      aria-current={active ? "true" : undefined}
      aria-label={ariaLabel}
      className={cn("border-b px-3 py-3 text-sm last:border-b-0", className)}
    >
      {children}
    </div>
  );
}
