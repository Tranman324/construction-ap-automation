"use client";

import { AlertTriangle, Loader2, Wrench } from "lucide-react";

import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { Button } from "@/modules/shared/components/ui/button";

interface SplitReviewPendingProps {
  isAnalyzing: boolean;
  analyzeError: string | null;
  onRetry: () => void;
  onBuildManually: () => void;
}

export function SplitReviewPending({
  isAnalyzing,
  analyzeError,
  onRetry,
  onBuildManually,
}: SplitReviewPendingProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      {analyzeError ? (
        <AlertTriangle className="h-9 w-9 text-destructive" />
      ) : (
        <Loader2 className="h-9 w-9 animate-spin text-muted-foreground" />
      )}
      <div>
        <p className="text-sm font-semibold">{analyzeError ? "Analysis failed" : "Analyzing pages"}</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          {analyzeError ?? "The split suggestions will appear here when page analysis finishes."}
        </p>
      </div>
      <div className="flex gap-2">
        {analyzeError ? (
          <PermissionGate requires="accounting.invoices.manage_splits">
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </PermissionGate>
        ) : null}
        <PermissionGate requires="accounting.invoices.manage_splits">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={isAnalyzing} onClick={onBuildManually}>
            <Wrench className="h-3.5 w-3.5" />
            Build manually
          </Button>
        </PermissionGate>
      </div>
    </div>
  );
}
