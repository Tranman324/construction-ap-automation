"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Clock3, FileQuestion, LockKeyhole, WifiOff } from "lucide-react";
import Link from "next/link";
import { Button } from "@/modules/shared/components/ui/button";
import { Card, CardContent } from "@/modules/shared/components/ui/card";
import { TabEmpty } from "./TabEmpty";
import { RetryingLoader } from "./RetryingLoader";
import type { PanelPhase } from "./usePanelPhase";

export interface PanelStateProps {
  phase: PanelPhase;
  onRetry?: () => void;
  onBack?: () => void;
  backHref?: string;
  children?: ReactNode;
  emptySlot?: ReactNode;
  errorDetail?: string | null;
  retryingLoaderSize?: number;
}

function BackAction({ onBack, backHref }: Pick<PanelStateProps, "onBack" | "backHref">) {
  if (onBack) {
    return <Button type="button" variant="ghost" size="sm" onClick={onBack}>← Back</Button>;
  }
  if (backHref) {
    return <Button type="button" variant="ghost" size="sm" asChild><Link href={backHref}>← Back</Link></Button>;
  }
  return null;
}

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-48 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6 pb-6 text-center">{children}</CardContent>
      </Card>
    </div>
  );
}

function RetryAction({ onRetry }: { onRetry?: () => void }) {
  return onRetry ? <Button type="button" size="sm" onClick={onRetry}>Try again</Button> : null;
}

export function PanelState({ phase, onRetry, onBack, backHref, children, emptySlot, errorDetail, retryingLoaderSize }: PanelStateProps) {
  if (phase === "loading") return <>{children}</>;
  if (phase === "ready") return <>{children}</>;
  if (phase === "stale") {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="panel-stale">
        <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>Showing cached data</span>
          {onRetry ? <Button type="button" variant="ghost" size="sm" onClick={onRetry}>Refresh</Button> : null}
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    );
  }
  if (phase === "empty") return <>{emptySlot ?? <TabEmpty />}</>;
  if (phase === "retrying") {
    return (
      <div className="relative h-full min-h-48" data-testid="panel-retrying">
        {children}
        <div className="absolute inset-0 flex items-center justify-center bg-background/45" aria-label="Retrying" role="status">
          <RetryingLoader size={retryingLoaderSize} />
        </div>
      </div>
    );
  }
  if (phase === "error") {
    return <CenteredCard><AlertTriangle className="mx-auto mb-3 size-8 text-destructive" aria-hidden="true" /><p className="mb-1 text-sm font-medium">Something went wrong</p>{errorDetail ? <p className="mb-4 text-xs text-muted-foreground">{errorDetail}</p> : <div className="mb-4" />}<RetryAction onRetry={onRetry} /></CenteredCard>;
  }
  if (phase === "not-found") {
    return <CenteredCard><FileQuestion className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" /><p className="mb-3 text-sm text-muted-foreground">Invoice not found</p><BackAction onBack={onBack} backHref={backHref} /></CenteredCard>;
  }
  if (phase === "unauthorized") {
    return <CenteredCard><LockKeyhole className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" /><p className="mb-3 text-sm text-muted-foreground">You don&apos;t have access</p><BackAction onBack={onBack} backHref={backHref} /></CenteredCard>;
  }
  if (phase === "offline") {
    return <CenteredCard><WifiOff className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" /><p className="mb-2 text-sm font-medium">You&apos;re offline</p><p className="mb-4 text-xs text-muted-foreground">Data may be available when you reconnect.</p><BackAction onBack={onBack} backHref={backHref} /></CenteredCard>;
  }
  return <CenteredCard><Clock3 className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" /><p className="mb-1 text-sm font-medium">Request timed out</p>{errorDetail ? <p className="mb-4 text-xs text-muted-foreground">{errorDetail}</p> : <div className="mb-4" />}<RetryAction onRetry={onRetry} /></CenteredCard>;
}
