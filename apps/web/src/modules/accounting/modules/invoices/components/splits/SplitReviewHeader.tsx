"use client";

import { ArrowLeft } from "lucide-react";

import { Button } from "@/modules/shared/components/ui/button";

interface SplitReviewHeaderProps {
  fileName: string;
  onBack: () => void;
}

export function SplitReviewHeader({
  fileName,
  onBack,
}: SplitReviewHeaderProps) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b bg-card px-5 py-3">
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-mono text-sm font-semibold">{fileName}</h1>
      </div>
    </header>
  );
}
