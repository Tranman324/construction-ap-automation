// Toolbox 3.0 — shared pattern component.
// Target path in the app: src/modules/shared/components/patterns/DataTablePattern.tsx
"use client";

import type { ReactNode } from "react";
import { Search, Trash2, X } from "lucide-react";
import { Input } from "@/modules/shared/components/ui/input";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

export interface DataTableTab {
  value: string;
  label: string;
  count?: number;
}
export interface DataTableSearch {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}
export interface DataTableTrash {
  count: number;
  active?: boolean;
  onClick?: () => void;
}
export interface DataTableSelection {
  count: number;
  actions?: ReactNode;
  onClear?: () => void;
}
export interface DataTablePatternProps {
  title?: string;
  subtitle?: string;
  search?: DataTableSearch;
  filters?: ReactNode;
  /** Opt in to right-aligned search/filter controls beside the tab filters. */
  searchFiltersPosition?: "toolbar" | "tab-filters";
  toolbarActions?: ReactNode;
  tabFilters?: ReactNode;
  /** Shared consumers retain the original order unless they opt in. */
  tabFiltersPosition?: "before-tabs" | "after-tabs";
  tabs?: DataTableTab[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  trash?: DataTableTrash;
  selection?: DataTableSelection;
  /** The <table> (TanStack), list, or any body. Wrapped in the surface. */
  children?: ReactNode;
}

function CountChip({ children }: { children: ReactNode }) {
  return (
    <span
      data-dtp-count="true"
      className="ml-1 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground tabular-nums"
    >
      {children}
    </span>
  );
}

/**
 * Canonical list view: toolbar + status tabs + table surface + floating
 * bulk-action bar. Owns the chrome; you supply the table rows as children.
 */
export function DataTablePattern({
  title, subtitle, search, filters, searchFiltersPosition = "toolbar", toolbarActions,
  tabFilters, tabFiltersPosition = "before-tabs", tabs, activeTab, onTabChange, trash, selection, children,
}: DataTablePatternProps) {
  const searchFilters = (
    <>
      {search && (
        <div data-dtp-search="true" className="relative min-w-[260px] sm:w-[420px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={search.placeholder ?? "Search…"}
            value={search.value}
            onChange={(e) => search.onChange?.(e.target.value)}
          />
        </div>
      )}
      {filters}
    </>
  );
  const tabFilterContent = searchFiltersPosition === "tab-filters" && (search || filters) ? (
    <div className="flex flex-wrap items-center justify-between">
      {tabFilters}
      <div data-dtp-searchfilters="true" className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2.5 px-4 py-2">
        {searchFilters}
      </div>
    </div>
  ) : tabFilters;

  return (
    <div className="flex flex-col gap-4">
      {(title || toolbarActions || (searchFiltersPosition === "toolbar" && (search || filters))) && (
        <div data-dtp-toolbar="true" className="flex flex-wrap items-center gap-3">
          {title && (
            <div>
              <h3 className="text-lg font-bold tracking-[-0.01em] text-foreground">{title}</h3>
              {subtitle && <p className="mt-1 text-[13.5px] text-muted-foreground">{subtitle}</p>}
            </div>
          )}
          <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-2.5 xl:w-auto">
            {searchFiltersPosition === "toolbar" && searchFilters}
            {toolbarActions}
          </div>
        </div>
      )}

      {tabFilterContent && tabFiltersPosition === "before-tabs" && <div data-dtp-tabfilters="true">{tabFilterContent}</div>}

      {(tabs || trash) && (
        <div data-dtp-tabsrow="true" className="flex items-center justify-between gap-3">
          {tabs ? (
            <div className="flex items-center gap-0.5 border-b border-border" role="tablist">
              {tabs.map((t) => {
                const isActive = t.value === activeTab;
                return (
                  <button
                    key={t.value}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => onTabChange?.(t.value)}
                    className={cn(
                      "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-3 text-sm font-medium whitespace-nowrap transition-colors",
                      isActive
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                    {t.count != null && <CountChip>{t.count}</CountChip>}
                  </button>
                );
              })}
            </div>
          ) : (
            <span />
          )}
          {trash && (
            <button
              data-dtp-trash="true"
              type="button"
              aria-pressed={trash.active ?? false}
              onClick={trash.onClick}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                trash.active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : trash.count > 0
                  ? "border-border bg-muted/50 text-foreground hover:bg-muted"
                  : "border-dashed border-border/70 bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Trash</span>
              {trash.count > 0 && <CountChip>{trash.count}</CountChip>}
            </button>
          )}
        </div>
      )}

      {/* Table surface */}
      <div
        data-dtp-surface="table"
        className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      >
        {tabFilterContent && tabFiltersPosition === "after-tabs" && <div data-dtp-tabfilters="true">{tabFilterContent}</div>}
        {children}
      </div>

      {/* Floating bulk-action bar */}
      {selection && selection.count > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="sticky bottom-4 z-30 flex items-center gap-3.5 rounded-2xl border border-border bg-card p-[12px_16px] shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
        >
          <span className="text-sm font-semibold text-foreground">
            {selection.count} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            {selection.actions}
            <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={selection.onClear}>
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
