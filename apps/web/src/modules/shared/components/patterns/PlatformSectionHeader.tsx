import type { ReactNode } from "react";

import { cn } from "@/modules/shared/lib/utils";
import skeletonStyles from "@/modules/shared/components/ui/skeleton.module.css";

export interface PlatformSectionHeaderProps {
  actions?: ReactNode;
  accentLabel: string;
  className?: string;
  pulseTestId?: string;
  title: string;
}

export function PlatformSectionHeader({
  actions,
  accentLabel,
  className,
  pulseTestId,
  title,
}: PlatformSectionHeaderProps) {
  const headingLabel = `${title} // ${accentLabel}`;

  return (
    <header
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-gradient-to-r from-primary/[0.08] via-card/95 to-card/85 px-4 py-2.5 shadow-sm shadow-primary/5 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          data-testid={pulseTestId}
          aria-hidden="true"
          className={cn(
            skeletonStyles.shimmer,
            "inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_0_5px] shadow-primary/10",
          )}
        />
        <h1
          aria-label={headingLabel}
          className="text-sm font-bold uppercase tracking-[0.24em] text-muted-foreground sm:text-base"
        >
          <span>{title}</span>
          <span className="text-ncg-cyan">{` // ${accentLabel}`}</span>
        </h1>
      </div>
      {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
    </header>
  );
}
