"use client";

import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";

import { Button } from "@/modules/shared/components/ui/button";

interface SplitReviewLoadRecoveryProps {
  title: string;
  detail: string;
  retrying: boolean;
  onRetry: () => void;
  onBack: () => void;
}

export function SplitReviewLoadRecovery({
  title,
  detail,
  retrying,
  onRetry,
  onBack,
}: SplitReviewLoadRecoveryProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b bg-card px-5 py-3">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">Split Review</h1>
          <p className="truncate text-xs text-muted-foreground">Document recovery</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onRetry} disabled={retrying}>
              <RefreshCw className={retrying ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              Retry
            </Button>
            <Button size="sm" onClick={onBack}>
              Back to queue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
