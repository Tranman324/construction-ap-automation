import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

import {
  formatSpectrumSubmitCurrency,
  type SpectrumSubmitConfirmSummary,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import type { SpectrumSubmitPrecheckSummary } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitPrecheckModel";
import {
  getSpectrumSubmitCandidateLabel,
  type SpectrumSubmitProgressRow,
  type SpectrumSubmitSubmittingPhase,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";
import {
  CompactStatGrid,
  InlineNotice,
  ScrollableList,
  ScrollableListRow,
} from "@/modules/shared/components/patterns";
import { cn } from "@/modules/shared/lib/utils";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";

interface SpectrumSubmitConfirmViewProps {
  candidatesLoaded: boolean;
  precheck: SpectrumSubmitPrecheckSummary;
  summary: SpectrumSubmitConfirmSummary;
}

interface SpectrumSubmitSubmittingViewProps {
  phase: SpectrumSubmitSubmittingPhase;
}

function getSubmitRowLabel(row: SpectrumSubmitProgressRow): string {
  return row.invoiceNumber ?? row.invoiceId;
}

function PrecheckNotice({
  candidatesLoaded,
  precheck,
  sourceLabel,
}: {
  candidatesLoaded: boolean;
  precheck: SpectrumSubmitPrecheckSummary;
  sourceLabel: string;
}) {
  if (!candidatesLoaded) {
    return (
      <InlineNotice tone="neutral" role="status">
        Loading approved invoices for pre-checks.
      </InlineNotice>
    );
  }

  if (precheck.warnings.length === 0) {
    return (
      <InlineNotice tone="success" role="status" title={sourceLabel}>
        All pre-checks passed.
      </InlineNotice>
    );
  }

  if (precheck.blockingWaiverCount > 0) {
    return (
      <InlineNotice tone="warning" role="alert" title="Lien waiver required before submission.">
        <p>
          {precheck.blockingWaiverCount} invoice{precheck.blockingWaiverCount === 1 ? " is" : "s are"} blocked.
          Link a waiver or mark it on the document before submitting.
        </p>
      </InlineNotice>
    );
  }

  return null;
}

export function SpectrumSubmitConfirmView({
  candidatesLoaded,
  precheck,
  summary,
}: SpectrumSubmitConfirmViewProps) {
  return (
    <div className="space-y-4 px-5 py-5 sm:px-6">
      <CompactStatGrid
        items={[
          { label: "Documents", value: summary.count, ariaLabel: "Documents count" },
          { label: "Total value", value: formatSpectrumSubmitCurrency(summary.totalAmount), ariaLabel: "Total value" },
          { label: "Jobs affected", value: summary.jobsAffected ?? "--", ariaLabel: "Affected jobs" },
        ]}
      />

      <PrecheckNotice
        candidatesLoaded={candidatesLoaded}
        precheck={precheck}
        sourceLabel={summary.sourceLabel}
      />
    </div>
  );
}

export function SpectrumSubmitSubmittingView({ phase }: SpectrumSubmitSubmittingViewProps) {
  const activeCandidate = phase.candidates.find((candidate) => candidate.id === phase.activeInvoiceId);
  const activeLabel = activeCandidate ? getSpectrumSubmitCandidateLabel(activeCandidate) : "Finalizing";

  return (
    <div className="space-y-4 px-5 py-4 sm:px-6">
      <div className="space-y-2">
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Spectrum submit progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={phase.percentage}
        >
          <span className={cn("block h-full rounded-full bg-primary", motionStyles.progressBar)} style={{ width: `${phase.percentage}%` }} />
        </div>
        <div className="flex min-w-0 items-baseline gap-3 text-sm">
          <span className="shrink-0 font-mono font-semibold tabular-nums" aria-label="Submit progress count">
            {phase.completedCount} / {phase.totalCount}
          </span>
          <span className="min-w-0 truncate text-muted-foreground" aria-label="Current submit item">
            {phase.activeInvoiceId ? "Posting " : "Finalizing "}
            <strong className="font-semibold text-foreground">{activeLabel}</strong>
            {activeCandidate?.vendorName ? ` - ${activeCandidate.vendorName}` : null}
          </span>
        </div>
      </div>

      <ScrollableList ariaLabel="Submitting invoices" maxHeight="sm">
        {phase.rows.map((row) => {
          const label = getSubmitRowLabel(row);

          return (
            <ScrollableListRow
              key={row.invoiceId}
              ariaLabel={`${label} ${row.state}`}
              className={cn(
                "grid grid-cols-[auto_minmax(5rem,auto)_minmax(0,1fr)_auto] items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0",
                row.state === "active" && "bg-muted/60",
                row.state === "waiting" && "text-muted-foreground opacity-55",
              )}
            >
              {row.state === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              ) : row.state === "failure" ? (
                <XCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
              ) : row.state === "active" ? (
                <Loader2 className={cn("h-4 w-4 animate-spin text-primary", motionStyles.spinner)} aria-hidden="true" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="font-mono font-semibold tabular-nums text-foreground">{label}</span>
              <span className="min-w-0 truncate text-muted-foreground">{row.vendorName ?? "Unknown vendor"}</span>
              <span className="font-mono tabular-nums text-foreground">{formatSpectrumSubmitCurrency(row.amount)}</span>
            </ScrollableListRow>
          );
        })}
      </ScrollableList>
    </div>
  );
}

export { SpectrumSubmitResultsView } from "@/modules/accounting/modules/invoices/components/dashboard/SpectrumSubmitResultsView";
