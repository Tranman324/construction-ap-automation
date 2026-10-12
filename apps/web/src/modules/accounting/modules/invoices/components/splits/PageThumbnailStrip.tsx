"use client";

import Image from "next/image";
import { Check, RotateCcw, Scissors, Trash2 } from "lucide-react";

import {
  findPageGroup,
  type SplitEditorState,
} from "@/modules/accounting/modules/invoices/lib/splitLayout";
import { PageCutControl } from "@/modules/accounting/modules/invoices/components/splits/PageCutControl";
import {
  getSplitCutPages,
  isCuttablePage,
} from "@/modules/accounting/modules/invoices/lib/splitCutModel";
import {
  getGroupBorderColor,
  getGroupColor,
  getGroupSoftColor,
  getGroupTextColor,
} from "@/modules/accounting/modules/invoices/lib/splitGroupColors";
import { splitPageRangeLabel } from "@/modules/accounting/modules/invoices/lib/splitPageModel";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

interface PageThumbnailStripProps {
  docId: string;
  pageCount: number;
  state: SplitEditorState;
  selectedPage: number;
  highlightedGroupIndex: number | null;
  onSelectPage: (page: number) => void;
  onTogglePage: (page: number, shiftKey: boolean) => void;
  onToggleCut: (page: number) => void;
  onDiscardPage: (page: number) => void;
  onUndiscardPage: (page: number) => void;
}

export function PageThumbnailStrip({
  docId,
  pageCount,
  state,
  selectedPage,
  highlightedGroupIndex,
  onSelectPage,
  onTogglePage,
  onToggleCut,
  onDiscardPage,
  onUndiscardPage,
}: PageThumbnailStripProps) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  const discardedPages = new Set(state.discardedPages);
  const selectedPages = state.selectedPages;
  const cutPages = new Set(getSplitCutPages(state, pageCount));

  return (
    <section className="flex min-h-0 flex-col border-b bg-card">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Scissors className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">Page strip</p>
            <p className="truncate text-xs text-muted-foreground">
              Use the scissors between pages to start a new document.
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
          {state.groups.length} docs
        </span>
      </div>

      <div className="min-h-0 overflow-x-auto px-4 py-4">
        <div className="flex min-w-max items-stretch" role="list" aria-label="Split pages">
          {pages.map((page, index) => {
            const groupIndex = findPageGroup(state.groups, page);
            const group = groupIndex >= 0 ? state.groups[groupIndex] : null;
            const isDiscarded = discardedPages.has(page);
            const isSelectedPage = selectedPage === page;
            const isSelectedForAction = selectedPages.has(page);
            const isHighlighted = highlightedGroupIndex !== null && groupIndex === highlightedGroupIndex;
            const firstGroupPage = group ? [...group.pages].sort((a, b) => a - b)[0] : null;
            const isGroupStart = firstGroupPage === page;
            const cuttable = isCuttablePage(state, pageCount, page);
            const isCut = cutPages.has(page);

            return (
              <div key={page} className="flex items-stretch" role="listitem">
                {index > 0 ? (
                  <PageCutControl page={page} cuttable={cuttable} isCut={isCut} onToggleCut={onToggleCut} />
                ) : null}

                <div className="relative flex w-28 shrink-0 flex-col pt-8">
                  {isGroupStart && group ? (
                    <div
                      className={cn(
                        "absolute left-0 top-0 flex h-6 max-w-full items-center gap-1.5 rounded-md border px-2 text-2xs font-semibold",
                        getGroupBorderColor(groupIndex),
                        getGroupSoftColor(groupIndex),
                        getGroupTextColor(groupIndex),
                      )}
                    >
                      <span className={cn("h-2 w-2 rounded-full", getGroupColor(groupIndex))} />
                      <span>Doc {groupIndex + 1}</span>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    data-page={page}
                    onClick={() => onSelectPage(page)}
                    className={cn(
                      "group relative overflow-hidden rounded-md border-2 bg-background text-left shadow-sm transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      group ? getGroupBorderColor(groupIndex) : "border-border",
                      isSelectedPage && "ring-2 ring-primary/40",
                      isHighlighted && "scale-[1.02] shadow-md",
                      isDiscarded && "border-dashed opacity-60 grayscale",
                    )}
                  >
                    <Image
                      src={`/api/backend/splits/${docId}/page/${page}/preview?width=240`}
                      alt={`Page ${page}`}
                      width={240}
                      height={310}
                      unoptimized
                      loading="lazy"
                      className="aspect-[8.5/11] w-full bg-muted object-cover"
                    />
                    {isDiscarded ? (
                      <div className="absolute inset-x-0 top-0 bottom-7 flex flex-col items-center justify-center gap-2 bg-destructive/10 text-destructive">
                        <Trash2 className="h-5 w-5" />
                        <span className="text-3xs font-bold uppercase tracking-wide">Discarded</span>
                      </div>
                    ) : null}
                    {isSelectedForAction ? (
                      <span className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                    <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-card/95 px-2 py-1">
                      <span className="font-mono text-2xs font-semibold text-foreground">p{page}</span>
                      {group ? (
                        <span className="text-3xs text-muted-foreground">{splitPageRangeLabel(group.pages)}</span>
                      ) : (
                        <span className="text-3xs text-amber-600">unassigned</span>
                      )}
                    </span>
                  </button>

                  <div className="mt-2 flex items-center justify-between gap-1">
                    <Button
                      type="button"
                      variant={isSelectedForAction ? "default" : "outline"}
                      size="sm"
                      className="h-7 flex-1 px-2 text-2xs"
                      onClick={(event) => onTogglePage(page, event.shiftKey)}
                    >
                      {isSelectedForAction ? "Selected" : "Select"}
                    </Button>
                    {isDiscarded ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Restore page ${page}`}
                        onClick={() => onUndiscardPage(page)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label={`Discard page ${page}`}
                        onClick={() => onDiscardPage(page)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
