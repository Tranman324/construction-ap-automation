"use client";

import Image from "next/image";
import { X, Trash2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";
import {
  type EditorGroup,
} from "@/modules/accounting/modules/invoices/lib/splitLayout";
import {
  getGroupBorderColor,
  getGroupColor,
} from "@/modules/accounting/modules/invoices/lib/splitGroupColors";

interface PageMiniThumbnailProps {
  docId: string;
  page: number;
  /** All groups in the editor — used to render the group-dot row */
  groups: EditorGroup[];
  /** Which group this page currently belongs to (-1 = unassigned/discarded) */
  currentGroupIndex: number;
  /** Called when user clicks a group dot to move page there */
  onMoveToGroup: (page: number, targetGroupId: string) => void;
  /** Called when user clicks × — unassign from current group */
  onUnassign?: (page: number) => void;
  /** Called when user clicks trash */
  onDiscard: (page: number) => void;
  /** Called on click to scroll the left panel */
  onScrollToPage: (page: number) => void;
}

export function PageMiniThumbnail({
  docId,
  page,
  groups,
  currentGroupIndex,
  onMoveToGroup,
  onUnassign,
  onDiscard,
  onScrollToPage,
}: PageMiniThumbnailProps) {
  return (
    <div
      className="relative group/mini w-12 shrink-0 cursor-pointer"
      onClick={() => onScrollToPage(page)}
    >
      {/* Thumbnail preview */}
      <div className="relative rounded-md overflow-hidden border border-border bg-muted shadow-sm transition-shadow duration-150 group-hover/mini:shadow-md group-hover/mini:border-primary/30">
        <Image
          src={`/api/backend/splits/${docId}/page/${page}/preview?width=80`}
          alt={`Page ${page}`}
          width={80}
          height={104}
          unoptimized
          loading="lazy"
          className="w-full aspect-[8.5/11] object-cover"
        />

        {/* Page number overlay */}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-0.5 py-px">
          <span className="text-4xs font-medium text-white tabular-nums leading-none">
            {page}
          </span>
        </div>

        {/* ── Hover overlay — group dots + actions ── */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/mini:opacity-100 transition-opacity duration-150 flex flex-col justify-between p-0.5">
          {/* Top: group-assignment dots */}
          {groups.length > 0 && (
            <div className="flex flex-wrap gap-0.5 justify-center">
              {groups.map((g, gi) => {
                const isCurrentGroup = gi === currentGroupIndex;
                return (
                  <Tooltip key={g.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isCurrentGroup) onMoveToGroup(page, g.id);
                        }}
                        className={`
                          w-3 h-3 rounded-full border-[1.5px] transition-[background-color,border-color,scale] duration-100
                          ${isCurrentGroup
                            ? `${getGroupColor(gi)} border-white/80 scale-110`
                            : `bg-transparent ${getGroupBorderColor(gi)} hover:${getGroupColor(gi)} hover:scale-110`
                          }
                        `}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-3xs py-0.5 px-1.5">
                      {g.displayName || `Group ${gi + 1}`}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}

          {/* Bottom: action buttons */}
          <div className="flex items-center justify-center gap-1">
            {onUnassign && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnassign(page);
                }}
                className="w-4 h-4 rounded-sm bg-white/90 flex items-center justify-center hover:bg-white transition-colors"
              >
                <X className="h-2.5 w-2.5 text-gray-700" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDiscard(page);
              }}
              className="w-4 h-4 rounded-sm bg-white/90 flex items-center justify-center hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-2.5 w-2.5 text-red-600" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
