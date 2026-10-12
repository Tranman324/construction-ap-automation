"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Flag, Search, X } from "lucide-react";
import { Input } from "@/modules/shared/components/ui/input";
import { Button } from "@/modules/shared/components/ui/button";

import type { InvoicePanel } from "@/modules/accounting/modules/invoices/types/ui";
import { cn } from "@/modules/shared/lib/utils";
import { formatShortcutTooltip, useDocumentPanelKeyboardShortcuts } from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";

export const DASHBOARD_PANELS: ReadonlyArray<{
  value: InvoicePanel;
  label: string;
}> = [
  { value: "invoice", label: "Invoices" },
  { value: "receipt", label: "Receipts" },
  { value: "statement", label: "Statements" },
  { value: "coi", label: "COI" },
  { value: "w9", label: "W-9" },
  { value: "lien-waiver", label: "Lien Waivers" },
  { value: "other", label: "Other" },
];

interface DashboardPanelFiltersProps {
  search?: { value: string; open: boolean; onOpen: () => void; onClose: () => void; onChange: (value: string) => void };
  value?: InvoicePanel;
  onChange: (value: InvoicePanel | undefined) => void;
  /** Whether the active queue scope is narrowed to timestamp-flagged records. */
  flaggedActive?: boolean;
  /** Count from the active queue scope; omitted/0 renders the control without a count. */
  flaggedCount?: number;
  /** Toggle the Flagged (needs-attention) filter within the current scope. */
  onFlaggedSelect?: () => void;
  /** Queue-only controls shown with document type filters. */
  children?: ReactNode;
}

interface TrackEdges { l: boolean; r: boolean }

/** Reuse the previous object when measurements have not changed. */
export function getTrackEdges(previous: TrackEdges, track: Pick<HTMLElement, "scrollWidth" | "clientWidth" | "scrollLeft"> | null): TrackEdges {
  const max = track ? track.scrollWidth - track.clientWidth : 0;
  const l = !!track && max > 1 && track.scrollLeft > 1;
  const r = !!track && max > 1 && track.scrollLeft < max - 1;
  return previous.l === l && previous.r === r ? previous : { l, r };
}

export function DashboardPanelFilters({
  value,
  onChange,
  flaggedActive = false,
  flaggedCount,
  onFlaggedSelect,
  children,
  search,
}: DashboardPanelFiltersProps) {
  const showFlaggedCount = typeof flaggedCount === "number" && flaggedCount > 0;
  const flaggedLabel = showFlaggedCount ? `Flagged (${flaggedCount})` : "Flagged";
  const searchShown = Boolean(search && (search.open || search.value));
  const trackRef = useRef<HTMLDivElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const restoreSearchFocus = useRef(false);
  const [trackEdge, setTrackEdge] = useState<TrackEdges>({ l: false, r: false });
  const shortcutRef = useRef(null);
  useDocumentPanelKeyboardShortcuts({
    primaryActionRef: shortcutRef,
    undoAction: null,
    previousAction: null,
    nextAction: null,
    searchAction: search ? { label: "Search", run: search.onOpen } : null,
  });
  const syncTrack = useCallback(() => {
    setTrackEdge((previous) => getTrackEdges(previous, trackRef.current));
  }, []);
  useEffect(() => { syncTrack(); });
  useEffect(() => {
    window.addEventListener("resize", syncTrack);
    const track = trackRef.current;
    const observer = track && typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncTrack) : null;
    if (track) observer?.observe(track);
    return () => { window.removeEventListener("resize", syncTrack); observer?.disconnect(); };
  }, [searchShown, syncTrack]);
  useEffect(() => {
    if (!searchShown && restoreSearchFocus.current) {
      searchButtonRef.current?.focus();
      restoreSearchFocus.current = false;
    }
  }, [searchShown]);
  function closeSearch() {
    restoreSearchFocus.current = true;
    search?.onClose();
  }

  return (
    <div className="tbx-rail" role="group" aria-label="Document filters">
      <button
        type="button"
        aria-pressed={flaggedActive}
        aria-label={flaggedLabel}
        onClick={() => onFlaggedSelect?.()}
        className={cn(
          "tbx-rail__flag inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors",
          flaggedActive
            ? "border-red-300 bg-red-50 text-red-700 font-semibold"
            : "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Flag className="h-[13px] w-[13px] text-red-500" aria-hidden="true" />
        <span>Flagged</span>
        {showFlaggedCount && (
          <span className={cn(
            "rounded-full px-1.5 py-0.5 font-mono text-2xs leading-none tabular-nums",
            flaggedActive ? "bg-red-200 text-red-700" : "bg-muted text-muted-foreground",
          )}>
            {flaggedCount}
          </span>
        )}
      </button>
      <span className="tbx-rail__div" aria-hidden="true" />
      {searchShown && search ? (
        <div className="tbx-rail__srch">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input autoFocus className="pl-9" aria-label="Search vendor, invoice number, or job"
            placeholder="Search vendor, invoice #, or job..." value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeSearch(); } }} />
          <button type="button" className="tbx-rail__srchx" title="Close search" aria-label="Close search" onClick={closeSearch}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <div ref={trackRef} onScroll={syncTrack} className={cn("tbx-rail__track", trackEdge.l && "has-l", trackEdge.r && "has-r")}>
            <button
              type="button"
              aria-pressed={!value}
              onClick={() => onChange(undefined)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                !value
                  ? "border-primary/50 bg-primary/5 text-primary font-semibold"
                  : "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              All types
            </button>
            {DASHBOARD_PANELS.map((item) => (
              <button
                type="button"
                key={item.value}
                aria-pressed={value === item.value}
                onClick={() => onChange(value === item.value ? undefined : item.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  value === item.value
                    ? "border-primary/50 bg-primary/5 text-primary font-semibold"
                    : "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          {search && <>
            <span className="tbx-rail__div" aria-hidden="true" />
            <Button ref={searchButtonRef} type="button" variant="outline" size="icon" className="tbx-iconbtn-lg tbx-rail__srchbtn"
              title={formatShortcutTooltip("Search", "/")}
              onClick={search.onOpen} aria-label="Search"><Search size={15} aria-hidden="true" /></Button>
          </>}
        </>
      )}
      {children && <div className="tbx-rail__job">{children}</div>}
    </div>
  );
}
