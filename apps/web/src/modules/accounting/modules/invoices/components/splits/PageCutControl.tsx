"use client";

import { Scissors } from "lucide-react";

import { cn } from "@/modules/shared/lib/utils";

interface PageCutControlProps {
  page: number;
  cuttable: boolean;
  isCut: boolean;
  onToggleCut: (page: number) => void;
}

export function PageCutControl({ page, cuttable, isCut, onToggleCut }: PageCutControlProps) {
  if (!cuttable) {
    return (
      <div className="w-9 shrink-0 pt-8">
        <div className="mx-auto h-full w-px border-l border-dashed border-destructive/40" />
      </div>
    );
  }

  return (
    <div className="flex w-9 shrink-0 items-center justify-center pt-8">
      <button
        type="button"
        aria-label={isCut ? `Remove split before page ${page}` : `Split before page ${page}`}
        aria-pressed={isCut}
        title={isCut ? "Remove split" : "Split here"}
        onClick={() => onToggleCut(page)}
        className={cn(
          "relative z-10 flex h-7 w-7 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition",
          "before:absolute before:-top-14 before:-bottom-16 before:left-1/2 before:-z-10 before:border-l before:border-dashed before:border-muted-foreground/30",
          "hover:border-primary hover:text-primary hover:before:border-primary",
          isCut && "border-primary bg-primary text-primary-foreground before:border-primary",
        )}
      >
        <Scissors className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
