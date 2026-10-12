// Toolbox 3.0 — shared pattern component.
// Target path in the app: src/modules/shared/components/patterns/DetailPage.tsx
"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";
import type { ReactNode } from "react";

export interface DetailPaging {
  index: number; // zero-based
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
}
export interface DetailMetaItem {
  icon?: LucideIcon;
  label?: string;
  value?: ReactNode;
}
export interface DetailTab {
  value: string;
  label: string;
  icon?: LucideIcon;
}
export interface DetailPageProps {
  backLabel?: string;
  onBack?: () => void;
  paging?: DetailPaging;
  eyebrow?: string;
  title: ReactNode;
  status?: ReactNode;
  meta?: DetailMetaItem[];
  actions?: ReactNode;
  tabs?: DetailTab[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  children?: ReactNode;
}

/**
 * Record detail layout: back/prev-next nav, hero (eyebrow + title + status +
 * meta + actions), sticky pill tabs, body. Use for every detail page.
 */
export function DetailPage({
  backLabel = "Back", onBack, paging, eyebrow, title, status,
  meta, actions, tabs, activeTab, onTabChange, children,
}: DetailPageProps) {
  return (
    <div className="flex flex-col">
      {/* Nav */}
      <div className="flex items-center justify-between gap-3 px-0.5 pb-3 pt-0.5">
        <button
          onClick={onBack}
          className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          {backLabel}
        </button>
        {paging && paging.total > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {paging.index + 1} of {paging.total}
            </span>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={paging.index <= 0} onClick={paging.onPrev} aria-label="Previous">
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={paging.index >= paging.total - 1} onClick={paging.onNext} aria-label="Next">
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-[18px] border border-border bg-card p-[24px_26px] shadow-sm">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[120px]"
          style={{
            background:
              "radial-gradient(120% 140% at 85% -40%, color-mix(in srgb, var(--ncg-cyan) 12%, transparent), transparent 60%)",
          }}
        />
        <div className="relative flex items-start justify-between gap-5">
          <div>
            {eyebrow && (
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                {eyebrow}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[26px] font-extrabold leading-[1.1] tracking-[-0.02em] text-foreground">
                {title}
              </h1>
              {status}
            </div>
            {meta && meta.length > 0 && (
              <div className="mt-3.5 flex flex-wrap gap-x-[18px] gap-y-2 text-[13px] text-muted-foreground">
                {meta.map((m, i) => {
                  const Icon = m.icon;
                  return (
                    <span key={i} className="inline-flex items-center gap-1.5">
                      {Icon && <Icon className="h-3.5 w-3.5" />}
                      {m.label && <span>{m.label}</span>}
                      {m.value != null && <strong className="font-semibold text-foreground">{m.value}</strong>}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
        </div>
      </div>

      {/* Sticky pill tabs */}
      {tabs && tabs.length > 0 && (
        <div className="sticky top-14 z-10 mt-4 border-b border-border bg-background/80 py-1.5 backdrop-blur-md">
          <div className="flex gap-1 overflow-x-auto" role="tablist">
            {tabs.map((t) => {
              const Icon = t.icon;
              const isActive = t.value === activeTab;
              return (
                <button
                  key={t.value}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onTabChange?.(t.value)}
                  className={cn(
                    "inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-[background-color,color,box-shadow]",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {Icon && <Icon className="h-4 w-4" />}
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="px-0.5 py-[22px]">{children}</div>
    </div>
  );
}
