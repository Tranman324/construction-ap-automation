"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import {
  formatShortcutTooltip,
  useDocumentShortcutLabels,
} from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";
import { Button } from "@/modules/shared/components/ui/button";
import { Separator } from "@/modules/shared/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";
import { cn } from "@/modules/shared/lib/utils";

export interface DocumentPanelHeaderNavigation {
  /** Position indicator "current / total". Omit both to show arrows only
   *  (e.g. server-computed keyset neighbors have no index/total). */
  current?: number;
  total?: number;
  onPrevious?: () => void;
  onNext?: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  previousLabel?: string;
  nextLabel?: string;
}

export interface DocumentPanelHeaderProps {
  title: ReactNode;
  filename?: ReactNode;
  onBack: () => void;
  backLabel?: string;
  navigation?: DocumentPanelHeaderNavigation;
  classificationSlot?: ReactNode;
  actionsSlot?: ReactNode;
  className?: string;
}

export function DocumentPanelHeader({
  title,
  filename,
  onBack,
  backLabel = "Close",
  navigation,
  classificationSlot,
  actionsSlot,
  className,
}: DocumentPanelHeaderProps) {
  const shortcuts = useDocumentShortcutLabels();
  const previousDisabled = navigation ? navigation.previousDisabled ?? !navigation.onPrevious : true;
  const nextDisabled = navigation ? navigation.nextDisabled ?? !navigation.onNext : true;

  return (
    <TooltipProvider delayDuration={150}>
      <header
        className={cn(
          "flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card/50 px-4 py-2 sm:flex-nowrap",
          className,
        )}
      >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 shrink-0 gap-1.5 text-sm font-medium"
        title={formatShortcutTooltip(backLabel, "Esc")}
        onClick={onBack}
      >
        <X className="h-4 w-4" aria-hidden="true" />
        {backLabel}
      </Button>

      <Separator orientation="vertical" className="hidden h-5 sm:block" />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{title}</div>
        {filename && (
          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {filename}
          </div>
        )}
      </div>

      {(classificationSlot || actionsSlot) && (
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {classificationSlot}
          {actionsSlot}
        </div>
      )}

      {navigation && (
        <>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-sm"
                    disabled={previousDisabled}
                    onClick={() => navigation.onPrevious?.()}
                    aria-label="Previous document"
                    aria-keyshortcuts={!previousDisabled ? shortcuts.previousAria : undefined}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    {navigation.previousLabel ?? "Prev"}
                  </Button>
                </span>
              </TooltipTrigger>
              {!previousDisabled && (
                <TooltipContent side="bottom">
                  {formatShortcutTooltip("Previous", shortcuts.previous)}
                </TooltipContent>
              )}
            </Tooltip>
            {typeof navigation.current === "number" && typeof navigation.total === "number" && (
              <span
                className="px-1 text-xs tabular-nums text-muted-foreground"
                aria-label={`Document ${navigation.current} of ${navigation.total}`}
              >
                {navigation.current} / {navigation.total}
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-sm"
                    disabled={nextDisabled}
                    onClick={() => navigation.onNext?.()}
                    aria-label="Next document"
                    aria-keyshortcuts={!nextDisabled ? shortcuts.nextAria : undefined}
                  >
                    {navigation.nextLabel ?? "Next"}
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </span>
              </TooltipTrigger>
              {!nextDisabled && (
                <TooltipContent side="bottom">
                  {formatShortcutTooltip("Next", shortcuts.next)}
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </>
      )}
      </header>
    </TooltipProvider>
  );
}
