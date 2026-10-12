"use client";

import { CheckCircle2, FileCheck2, Loader2, Paperclip, RotateCcw } from "lucide-react";

import type { WaiverOverrideState } from "@/modules/accounting/modules/invoices/components/invoices/invoiceDetailPanelState";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";

interface WaiverOnDocumentCardProps {
  waiverOverride: WaiverOverrideState;
  isSubmitted: boolean;
  revertPending: boolean;
  onRevert: () => void;
}

function formatMarkedDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function WaiverOnDocumentCard({
  waiverOverride,
  isSubmitted,
  revertPending,
  onRevert,
}: WaiverOnDocumentCardProps) {
  const markedDate = formatMarkedDate(waiverOverride.at);

  return (
    <div className="px-4 py-3 border-b flex-shrink-0">
      <div className="flex items-center gap-2 mb-2">
        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Lien Waiver
        </p>
        <Badge
          variant="outline"
          className="ml-auto text-3xs px-1.5 py-0 text-green-700 bg-green-50 border-green-200"
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          On document
        </Badge>
      </div>

      <div className="rounded-lg border border-green-200 bg-green-50/70 p-3 dark:border-green-900/50 dark:bg-green-950/20">
        <div className="flex items-start gap-2">
          <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700 dark:text-green-300" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-green-900 dark:text-green-100">
              Waiver exists on this document
            </p>
            {(waiverOverride.by || markedDate) && (
              <p className="mt-1 text-xs text-green-800/80 dark:text-green-200/80">
                Marked{waiverOverride.by ? ` by ${waiverOverride.by}` : ""}
                {markedDate ? ` on ${markedDate}` : ""}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isSubmitted ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled>
                    <RotateCcw className="h-3 w-3" />
                    Clear
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Cannot clear - already submitted to Spectrum
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={onRevert}
              disabled={revertPending}
            >
              {revertPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
