"use client";

import { ChevronLeft, ChevronRight, Eye, Inbox, Link2, Loader2, Search, Unlink } from "lucide-react";
import type { ReactNode } from "react";
import { PanelNotice } from "../documents/PanelNotice";

import type {
  PairedWaiverDocumentSummary,
  WaiverCandidateSummary,
} from "@/modules/accounting/modules/invoices/types/api";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/modules/shared/components/ui/tooltip";

interface ManualWaiverPairingListProps {
  candidates: readonly WaiverCandidateSummary[];
  paired: PairedWaiverDocumentSummary | null;
  loading: boolean;
  error: string | null;
  candidateLabel: string;
  pairedLabel: string;
  query: string;
  page: number;
  total: number;
  limit: number;
  onQueryChange: (query: string) => void;
  onPageChange: (page: number) => void;
  canUnlink: boolean;
  linkPendingId: string | null;
  unlinkPending: boolean;
  onLink: (candidateId: string) => void;
  onUnlink: () => void;
  onViewCandidate: (candidateId: string) => void;
  onViewPaired: (pairedId: string) => void;
  linkDisabledReason?: (candidate: WaiverCandidateSummary) => string | undefined;
  unlinkDisabledReason?: string;
  linkingAvailable?: boolean;
  unavailableMessage?: string;
}

function formatMoney(amount: number | null): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatReceivedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `Received ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

function summaryDetails(summary: PairedWaiverDocumentSummary | WaiverCandidateSummary): string {
  return [
    summary.vendorName ?? summary.vendorCode,
    summary.jobNumber ? `Job ${summary.jobNumber}` : null,
    summary.invoiceNumber ? `#${summary.invoiceNumber}` : null,
    formatMoney(summary.amount),
    "receivedAt" in summary ? formatReceivedAt(summary.receivedAt) : null,
  ].filter(Boolean).join(" · ");
}

export function ManualWaiverPairingList({
  candidates,
  paired,
  loading,
  error,
  candidateLabel,
  pairedLabel,
  query,
  page,
  total,
  limit,
  onQueryChange,
  onPageChange,
  canUnlink,
  linkPendingId,
  unlinkPending,
  onLink,
  onUnlink,
  onViewCandidate,
  onViewPaired,
  linkDisabledReason,
  unlinkDisabledReason,
  linkingAvailable = true,
  unavailableMessage = "Manual linking is not needed for this document.",
}: ManualWaiverPairingListProps) {
  if (paired) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/20" aria-label={`Paired ${pairedLabel}`}>
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{paired.fileName ?? paired.id}</p>
          <div className="ml-auto flex shrink-0 gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onViewPaired(paired.id)}>
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            View
          </Button>
          <DisabledReason reason={unlinkDisabledReason}>
            <Button type="button" size="sm" variant="outline" onClick={onUnlink} disabled={!canUnlink || unlinkPending || Boolean(unlinkDisabledReason)}>
              {unlinkPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Unlink className="h-3.5 w-3.5" aria-hidden="true" />}
              Unlink
            </Button>
          </DisabledReason>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{summaryDetails(paired) || paired.id}</p>
      </div>
    );
  }

  if (!linkingAvailable) {
    return (
      <PanelNotice id="manual-waiver-linking-not-needed" label="Manual linking is not needed" resolved>
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground" role="status">
        {unavailableMessage}
      </div>
      </PanelNotice>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2" aria-label={`Loading ${candidateLabel.toLowerCase()}`}>
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>;
  }

  const pages = Math.max(1, Math.ceil(total / limit));
  const resultLabel = `${total.toLocaleString()} ${total === 1 ? "result" : "results"}`;

  if (candidates.length === 0) {
    return (
      <div className="space-y-3">
        <SearchField candidateLabel={candidateLabel} query={query} onQueryChange={onQueryChange} />
        <PanelNotice id="manual-waiver-empty-candidates" label={`No unlinked ${candidateLabel.toLowerCase()} available`} resolved>
        <div className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm text-muted-foreground">
          <Inbox className="h-4 w-4" aria-hidden="true" />
          No unlinked {candidateLabel.toLowerCase()} are available.
        </div>
        </PanelNotice>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <SearchField candidateLabel={candidateLabel} query={query} onQueryChange={onQueryChange} />
      <p className="text-xs text-muted-foreground">{resultLabel}</p>
      {candidates.map((candidate) => {
        const disabledReason = linkDisabledReason?.(candidate);
        return (
        <div key={candidate.id} className="rounded-lg border border-border p-3">
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{candidate.fileName ?? candidate.id}</p>
            <div className="ml-auto flex shrink-0 gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => onViewCandidate(candidate.id)}>
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                View
              </Button>
              <DisabledReason reason={disabledReason}>
                <Button type="button" size="sm" onClick={() => onLink(candidate.id)} disabled={linkPendingId === candidate.id || Boolean(disabledReason)}>
                  {linkPendingId === candidate.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  Link
                </Button>
              </DisabledReason>
            </div>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{summaryDetails(candidate) || candidate.id}</p>
        </div>
        );
      })}
      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">Page {page} of {pages}</span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous candidate page">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Previous
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="Next candidate page">
            Next
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function DisabledReason({ reason, children }: { reason?: string; children: ReactNode }) {
  if (!reason) return children;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{children}</span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SearchField({
  candidateLabel,
  query,
  onQueryChange,
}: Pick<ManualWaiverPairingListProps, "candidateLabel" | "query" | "onQueryChange">) {
  return (
    <label className="relative block">
      <span className="sr-only">Search {candidateLabel.toLowerCase()}</span>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <Input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search filename, vendor, job, amount, or email"
        className="pl-8"
        aria-label={`Search ${candidateLabel.toLowerCase()}`}
      />
    </label>
  );
}
