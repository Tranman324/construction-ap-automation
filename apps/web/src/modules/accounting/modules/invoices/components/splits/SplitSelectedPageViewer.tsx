"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Loader2, Maximize2, Minus, Plus } from "lucide-react";

import { SourceDocumentPlaceholder } from "@/modules/accounting/modules/invoices/components/documents/SourceDocumentPlaceholder";
import {
  clampPage,
  stepZoom,
} from "@/modules/accounting/modules/invoices/components/documents/sourceDocumentViewerModel";
import { getGroupColor } from "@/modules/accounting/modules/invoices/lib/splitGroupColors";
import {
  buildSplitPagePreviewHref,
  loadSplitPagePreview,
  prefetchSplitPagePreview,
} from "@/modules/accounting/modules/invoices/lib/splitPagePreviewCache";
import { Button } from "@/modules/shared/components/ui/button";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import { cn } from "@/modules/shared/lib/utils";

export interface SplitSelectedPageGroup {
  index: number;
  label: string;
  docTypeLabel: string;
}

interface SplitSelectedPageViewerProps {
  docId: string;
  fileName: string;
  pageCount: number;
  selectedPage: number;
  group: SplitSelectedPageGroup | null;
  loading?: boolean;
  onSelectedPageChange: (page: number) => void;
  className?: string;
}

type PreviewState =
  | { status: "idle"; src: null; previewSrc: null }
  | { status: "loaded"; src: string; previewSrc: string }
  | { status: "failed"; src: string; previewSrc: null };

interface ToolbarButtonProps {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

function ToolbarButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "h-7 w-7 rounded-md text-muted-foreground hover:text-foreground",
        pressed && "bg-primary/10 text-primary hover:text-primary",
      )}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function SplitSelectedPageViewer({
  docId,
  fileName,
  pageCount,
  selectedPage,
  group,
  loading = false,
  onSelectedPageChange,
  className,
}: SplitSelectedPageViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [failedPages, setFailedPages] = useState<Set<number>>(new Set());
  const [previewState, setPreviewState] = useState<PreviewState>({ status: "idle", src: null, previewSrc: null });
  const activePage = clampPage(selectedPage, pageCount);
  const pagePreviewHref = useMemo(
    () => buildSplitPagePreviewHref(docId, activePage),
    [activePage, docId],
  );
  const previewLoaded = previewState.status === "loaded" && previewState.src === pagePreviewHref;
  const pageFailed = failedPages.has(activePage) || (previewState.status === "failed" && previewState.src === pagePreviewHref);
  const pageLoading = loading || (!previewLoaded && !pageFailed);
  const atFirstPage = activePage <= 1;
  const atLastPage = activePage >= pageCount;
  const atMinZoom = zoom <= 0.5;
  const atMaxZoom = zoom >= 2;

  useEffect(() => {
    if (activePage !== selectedPage) onSelectedPageChange(activePage);
  }, [activePage, onSelectedPageChange, selectedPage]);

  useEffect(() => {
    if (loading || failedPages.has(activePage)) return;

    let cancelled = false;

    void loadSplitPagePreview(pagePreviewHref)
      .then((entry) => {
        if (!cancelled) setPreviewState({ status: "loaded", src: pagePreviewHref, previewSrc: entry.previewSrc });
      })
      .catch(() => {
        if (cancelled) return;
        setFailedPages((current) => new Set([...current, activePage]));
        setPreviewState({ status: "failed", src: pagePreviewHref, previewSrc: null });
      });

    return () => {
      cancelled = true;
    };
  }, [activePage, failedPages, loading, pagePreviewHref]);

  const prefetchAdjacentPages = useCallback(() => {
    for (const page of [activePage - 1, activePage + 1]) {
      if (page < 1 || page > pageCount || failedPages.has(page)) continue;
      prefetchSplitPagePreview(buildSplitPagePreviewHref(docId, page));
    }
  }, [activePage, docId, failedPages, pageCount]);

  return (
    <section className={cn("flex min-h-0 flex-1 flex-col overflow-hidden border-r bg-background", className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        {group ? (
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs font-semibold">
            <span className={cn("h-2.5 w-2.5 rounded-full", getGroupColor(group.index))} />
            <span>{group.label}</span>
            <span className="text-muted-foreground">{group.docTypeLabel}</span>
          </div>
        ) : (
          <span className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            Unassigned
          </span>
        )}
        <div className="flex items-center gap-1">
          <ToolbarButton label="Previous page" disabled={atFirstPage} onClick={() => onSelectedPageChange(clampPage(activePage - 1, pageCount))}>
            <ChevronLeft className="h-4 w-4" />
          </ToolbarButton>
          <span className="min-w-12 text-center font-mono text-xs font-semibold tabular-nums text-foreground">
            {activePage} <span className="font-normal text-muted-foreground">/ {Math.max(pageCount, 1)}</span>
          </span>
          <ToolbarButton label="Next page" disabled={atLastPage} onClick={() => onSelectedPageChange(clampPage(activePage + 1, pageCount))}>
            <ChevronRight className="h-4 w-4" />
          </ToolbarButton>
        </div>
        <div className="flex items-center gap-1">
          <ToolbarButton label="Zoom out" disabled={atMinZoom} onClick={() => {
            setFitMode(false);
            setZoom((current) => stepZoom(current, "out"));
          }}>
            <Minus className="h-4 w-4" />
          </ToolbarButton>
          <span className="min-w-11 text-center font-mono text-xs font-semibold tabular-nums text-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <ToolbarButton label="Zoom in" disabled={atMaxZoom} onClick={() => {
            setFitMode(false);
            setZoom((current) => stepZoom(current, "in"));
          }}>
            <Plus className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label="Fit page" pressed={fitMode} onClick={() => {
            setFitMode(true);
            setZoom(1);
          }}>
            <Maximize2 className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-5">
        {pageLoading ? (
          <div className="flex min-h-full items-start justify-center" role="status" aria-label="Loading selected page">
            <div className="flex w-full max-w-[680px] flex-col gap-3">
              <Skeleton className="aspect-[8.5/11] w-full rounded border border-border bg-card shadow-lg" />
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading page preview
              </div>
            </div>
          </div>
        ) : pageFailed ? (
          <SourceDocumentPlaceholder
            icon="missing"
            title="Page preview not available"
            fileName={fileName}
            detail={`The preview for page ${activePage} could not be rendered.`}
          />
        ) : previewLoaded ? (
          <div className="flex min-h-full items-start justify-center">
            <Image
              src={previewState.previewSrc}
              alt={`Selected page ${activePage}`}
              width={1000}
              height={1294}
              unoptimized
              className={cn(
                "h-auto rounded border border-border bg-card object-contain shadow-lg",
                fitMode ? "max-h-full max-w-full" : "max-w-none",
              )}
              style={fitMode ? undefined : { width: `${Math.round(680 * zoom)}px` }}
              onLoad={prefetchAdjacentPages}
              onError={() => {
                setFailedPages((current) => new Set([...current, activePage]));
                setPreviewState({ status: "failed", src: pagePreviewHref, previewSrc: null });
              }}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
