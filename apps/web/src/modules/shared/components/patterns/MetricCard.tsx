// Toolbox 3.0 — shared pattern component.
// Target path in the app: src/modules/shared/components/patterns/MetricCard.tsx
"use client";

import type { LucideIcon } from "lucide-react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/modules/shared/lib/utils";
import skeletonStyles from "@/modules/shared/components/ui/skeleton.module.css";

export type MetricTone =
  | "cyan" | "emerald" | "amber" | "orange" | "violet" | "red" | "blue";

export interface MetricDelta {
  dir: "up" | "down";
  label: string;
}

export interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  /** Semantic tone; colors the glyph + number when `active`. */
  tone?: MetricTone;
  /** Activates the tone (colored number, tinted glyph, ring). */
  active?: boolean;
  /** Gently pulse the glyph to flag a live alert (reduced-motion safe). */
  pulsing?: boolean;
  delta?: MetricDelta;
  href?: string;
  onClick?: () => void;
  className?: string;
}

// Literal class strings (kept whole so Tailwind's JIT can see them).
const TONE: Record<MetricTone, { value: string; glyph: string; ring: string }> = {
  cyan:    { value: "text-tone-cyan",    glyph: "bg-tone-cyan/15 text-tone-cyan",       ring: "border-tone-cyan/40 ring-1 ring-tone-cyan/20" },
  emerald: { value: "text-tone-emerald", glyph: "bg-tone-emerald/15 text-tone-emerald", ring: "border-tone-emerald/40 ring-1 ring-tone-emerald/20" },
  amber:   { value: "text-tone-amber",   glyph: "bg-tone-amber/15 text-tone-amber",     ring: "border-tone-amber/40 ring-1 ring-tone-amber/20" },
  orange:  { value: "text-tone-orange",  glyph: "bg-tone-orange/15 text-tone-orange",   ring: "border-tone-orange/40 ring-1 ring-tone-orange/20" },
  violet:  { value: "text-tone-violet",  glyph: "bg-tone-violet/15 text-tone-violet",   ring: "border-tone-violet/40 ring-1 ring-tone-violet/20" },
  red:     { value: "text-tone-red",     glyph: "bg-tone-red/15 text-tone-red",         ring: "border-tone-red/40 ring-1 ring-tone-red/20" },
  blue:    { value: "text-tone-blue",    glyph: "bg-tone-blue/15 text-tone-blue",       ring: "border-tone-blue/40 ring-1 ring-tone-blue/20" },
};

/**
 * Stat tile: label + tinted glyph + big number. The shared metric display so
 * modules stop rolling their own. Compose many inside <StatGrid>.
 */
export function MetricCard({
  label, value, icon: Icon, tone, active = false, pulsing = false,
  delta, href, onClick, className,
}: MetricCardProps) {
  const t = tone ? TONE[tone] : null;
  const interactive = !!(href || onClick);

  const body = (
    <>
      <div className="flex items-start justify-between gap-2.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <span
            className={cn(
              "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-secondary text-muted-foreground",
              active && t?.glyph,
            )}
          >
            <Icon
              className={cn(
                "h-[18px] w-[18px]",
                active && pulsing && skeletonStyles.shimmer,
              )}
              strokeWidth={1.75}
            />
          </span>
        )}
      </div>

      <span
        className={cn(
          "mt-auto text-[34px] font-extrabold leading-none tracking-[-0.02em] tabular-nums text-foreground",
          active && t?.value,
        )}
      >
        {value}
      </span>

      {delta && (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs font-semibold",
            delta.dir === "down" ? "text-tone-red" : "text-tone-emerald",
          )}
        >
          {delta.dir === "down" ? (
            <TrendingDown className="h-3.5 w-3.5" />
          ) : (
            <TrendingUp className="h-3.5 w-3.5" />
          )}
          {delta.label}
        </span>
      )}
    </>
  );

  const classes = cn(
    "flex min-h-[116px] w-full flex-col gap-3.5 rounded-2xl border border-border bg-card p-[18px_20px] text-left shadow-sm transition-[background-color,border-color,box-shadow] duration-150",
    interactive && "cursor-pointer hover:bg-accent/60",
    interactive && "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45 focus-visible:border-ring",
    active && t?.ring,
    className,
  );

  if (href) return <a href={href} className={classes}>{body}</a>;
  if (onClick) return <button type="button" onClick={onClick} className={classes}>{body}</button>;
  return <div className={classes}>{body}</div>;
}
