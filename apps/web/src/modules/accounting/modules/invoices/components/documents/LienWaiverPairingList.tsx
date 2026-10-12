"use client";
import { PanelNotice } from "./PanelNotice";

import { ChevronLeft, ChevronRight, ExternalLink, Inbox, Link2, Loader2, RefreshCw, Search } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import type {
  PairedWaiverDocumentSummary,
  WaiverCandidateSummary,
} from "@/modules/accounting/modules/invoices/types/api";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/modules/shared/components/ui/tooltip";

interface LienWaiverPairingListProps {
  candidates: readonly WaiverCandidateSummary[];
  paired: PairedWaiverDocumentSummary | null;
  loading: boolean;
  error: string | null;
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
  linkingAvailable: boolean;
  suppressEmptyNotice?: boolean;
}

function formatMoney(amount: number | null): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function title(summary: PairedWaiverDocumentSummary | WaiverCandidateSummary): string {
  return summary.vendorName ?? summary.vendorCode ?? summary.invoiceNumber ?? summary.fileName ?? summary.id;
}

function summaryDetails(summary: PairedWaiverDocumentSummary | WaiverCandidateSummary): string {
  return [
    summary.invoiceNumber ? `Invoice ${summary.invoiceNumber}` : summary.fileName,
    summary.jobNumber,
    formatMoney(summary.amount),
  ].filter(Boolean).join(" · ");
}

function DisabledReason({ reason, children, className = "" }: { reason?: string; children: ReactNode; className?: string }) {
  if (!reason) return children;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex ${className}`}>{children}</span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PairingRow({
  candidate,
  pending,
  pairingDisabled,
  disabledReason,
  onLink,
  onView,
}: {
  candidate: WaiverCandidateSummary;
  pending: boolean;
  pairingDisabled: boolean;
  disabledReason?: string;
  onLink: () => void;
  onView: () => void;
}) {
  const invoiceLabel = candidate.invoiceNumber ?? candidate.fileName ?? candidate.id;
  return (
    <div className="flex min-w-0 overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/30">
      <DisabledReason reason={disabledReason} className="min-w-0 flex-1">
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-w-0 flex-1 justify-start gap-3 rounded-none px-3 py-3 text-left hover:bg-accent/40"
          onClick={onLink}
          disabled={pairingDisabled || Boolean(disabledReason)}
          aria-label={`Pair ${title(candidate)} invoice ${invoiceLabel}`}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{title(candidate)}</span>
            <span className="block truncate font-mono text-xs font-normal text-muted-foreground">{summaryDetails(candidate) || candidate.id}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />}
            Pair
          </span>
        </Button>
      </DisabledReason>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="h-auto self-stretch rounded-none border-l border-border"
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          onView();
        }}
        aria-label={`Preview invoice ${invoiceLabel}`}
      >
        <ExternalLink aria-hidden="true" />
      </Button>
    </div>
  );
}

export function LienWaiverPairingList({
  candidates,
  paired,
  loading,
  error,
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
  linkingAvailable,
  suppressEmptyNotice = false,
}: LienWaiverPairingListProps) {
  if (paired) {
    return (
      <PanelNotice id="waiver-paired" label="Paired to invoice" resolved>
      <div className="flex min-w-0 items-center gap-3 rounded-lg border border-emerald-300 bg-emerald-50/70 px-3 py-2.5 dark:border-emerald-800 dark:bg-emerald-950/30" aria-label="Paired invoice">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
          <Link2 className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">Paired to invoice</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{summaryDetails(paired) || paired.id}</p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1">
          <Button type="button" size="xs" variant="ghost" onClick={() => onViewPaired(paired.id)}>
            <ExternalLink aria-hidden="true" />
            Preview
          </Button>
          <DisabledReason reason={unlinkDisabledReason}>
            <Button type="button" size="xs" variant="outline" onClick={onUnlink} disabled={!canUnlink || unlinkPending || Boolean(unlinkDisabledReason)}>
              {unlinkPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              Change
            </Button>
          </DisabledReason>
        </div>
      </div>
      </PanelNotice>
    );
  }

  if (!linkingAvailable) {
    return <PanelNotice id="waiver-linking-unavailable" label="Invoice linking unavailable"><div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground" role="status">Invoice linking is not available for this document.</div></PanelNotice>;
  }

  if (loading) {
    return <div className="space-y-2" aria-label="Loading invoices"><Skeleton className="h-16 w-full rounded-lg" /><Skeleton className="h-16 w-full rounded-lg" /></div>;
  }

  if (error && candidates.length === 0) {
    return <PanelNotice id="waiver-pairing-error" label="Invoice pairing error"><p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p></PanelNotice>;
  }

  const pages = Math.max(1, Math.ceil(total / limit));
  const showSearch = total > limit || Boolean(query);

  if (candidates.length === 0) {
    return (
      <div className="space-y-2">
        {showSearch ? <SearchField query={query} onQueryChange={onQueryChange} /> : null}
        {!suppressEmptyNotice && <PanelNotice id="waiver-candidates-empty" label="No available invoices">
        <div className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm text-muted-foreground">
          <Inbox className="h-4 w-4" aria-hidden="true" />
          No unlinked invoices are available.
        </div>
        </PanelNotice>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error ? <PanelNotice id="waiver-pairing-error" label="Invoice pairing error"><p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p></PanelNotice> : null}
      {showSearch ? <SearchField query={query} onQueryChange={onQueryChange} /> : null}
      {candidates.map((candidate) => (
        <PairingRow
          key={candidate.id}
          candidate={candidate}
          pending={linkPendingId === candidate.id}
          pairingDisabled={linkPendingId !== null}
          disabledReason={linkDisabledReason?.(candidate)}
          onLink={() => onLink(candidate.id)}
          onView={() => onViewCandidate(candidate.id)}
        />
      ))}
      {pages > 1 ? (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">Page {page} of {pages}</span>
          <div className="flex gap-1">
            <Button type="button" size="icon-xs" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous candidate page"><ChevronLeft aria-hidden="true" /></Button>
            <Button type="button" size="icon-xs" variant="outline" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="Next candidate page"><ChevronRight aria-hidden="true" /></Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SearchField({ query, onQueryChange }: { query: string; onQueryChange: (query: string) => void }) {
  return (
    <label className="relative block">
      <span className="sr-only">Search invoices</span>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <Input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search invoice, vendor, job, or amount" className="h-9 pl-8" aria-label="Search invoices" />
    </label>
  );
}
