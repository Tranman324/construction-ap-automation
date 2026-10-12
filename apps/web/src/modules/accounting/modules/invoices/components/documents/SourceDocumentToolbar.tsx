"use client";

import type { ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Maximize2,
  Minus,
  Plus,
} from "lucide-react";

import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";
import { formatShortcutTooltip, useDocumentShortcutLabels } from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";

export interface SourceDocumentToolbarProps {
  fileName: string | null;
  fileHref: string;
  downloadName: string;
  canOpen: boolean;
  canDownload: boolean;
  page: number;
  pageCount: number;
  zoom: number;
  fitMode: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitPage: () => void;
}

interface ToolbarButtonProps {
  label: string;
  title?: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

function ToolbarButton({
  label,
  title,
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
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function SourceDocumentToolbar({
  fileName,
  fileHref,
  downloadName,
  canOpen,
  canDownload,
  page,
  pageCount,
  zoom,
  fitMode,
  onPreviousPage,
  onNextPage,
  onZoomOut,
  onZoomIn,
  onFitPage,
}: SourceDocumentToolbarProps) {
  const shortcuts = useDocumentShortcutLabels();
  const atFirstPage = page <= 1;
  const atLastPage = page >= pageCount;
  const atMinZoom = zoom <= 0.5;
  const atMaxZoom = zoom >= 2;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs font-semibold text-foreground" title={fileName ?? "No file"}>
          {fileName ?? "No file"}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <ToolbarButton label="Previous page" disabled={atFirstPage} onClick={onPreviousPage}>
          <ChevronLeft className="h-4 w-4" />
        </ToolbarButton>
        <span className="min-w-12 text-center font-mono text-xs font-semibold tabular-nums text-foreground">
          {page} <span className="font-normal text-muted-foreground">/ {pageCount}</span>
        </span>
        <ToolbarButton label="Next page" disabled={atLastPage} onClick={onNextPage}>
          <ChevronRight className="h-4 w-4" />
        </ToolbarButton>
      </div>

      <div className="flex items-center gap-1">
        <ToolbarButton label="Zoom out" disabled={atMinZoom} onClick={onZoomOut}>
          <Minus className="h-4 w-4" />
        </ToolbarButton>
        <span className="min-w-11 text-center font-mono text-xs font-semibold tabular-nums text-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <ToolbarButton label="Zoom in" disabled={atMaxZoom} onClick={onZoomIn}>
          <Plus className="h-4 w-4" />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton label="Fit page" pressed={fitMode} onClick={onFitPage}>
          <Maximize2 className="h-4 w-4" />
        </ToolbarButton>
        {canOpen ? (
          <Button asChild variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground">
            <a href={fileHref} target="_blank" rel="noopener noreferrer" aria-label="Open full document" title="Open full document">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        ) : (
          <ToolbarButton label="Open full document" disabled>
            <ExternalLink className="h-4 w-4" />
          </ToolbarButton>
        )}
        {canDownload ? (
          <Button asChild variant="ghost" size="icon" className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground">
            <a href={fileHref} download={downloadName} aria-label="Download file" title={formatShortcutTooltip("Download PDF", shortcuts.download)}>
              <Download className="h-4 w-4" />
            </a>
          </Button>
        ) : (
          <ToolbarButton label="Download file" title={formatShortcutTooltip("Download PDF", shortcuts.download)} disabled>
            <Download className="h-4 w-4" />
          </ToolbarButton>
        )}
      </div>
    </div>
  );
}
