import { CheckCircle2, ChevronLeft, ChevronRight, FolderOpen, Trash2, XCircle } from "lucide-react";

import { formatSpectrumSubmitCurrency } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import type {
  SpectrumSubmitResultRow,
  SpectrumSubmitResultsPhase,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";
import { getSpectrumSubmitErrorDetailDisplay } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";
import {
  type SpectrumSubmitFailureNavigation,
  getSpectrumSubmitFailureContext,
  getSpectrumSubmitFailureNavigation,
  getSpectrumSubmitFailureReason,
  getUnresolvedSpectrumSubmitFailures,
  isSpectrumSubmitResultActionable,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitResultsModel";
import { InlineNotice, ScrollableList, ScrollableListRow } from "@/modules/shared/components/patterns";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

interface SpectrumSubmitResultsViewProps {
  phase: SpectrumSubmitResultsPhase;
  activeFailureInvoiceId?: string | null;
  discardingInvoiceId?: string | null;
  failureNavigation?: SpectrumSubmitFailureNavigation | null;
  onDiscardInvoice?: (row: SpectrumSubmitResultRow) => void;
  onFailureNavigationChange?: (invoiceId: string | null) => void;
  onOpenInvoice?: (invoiceId: string) => void;
}

function getPrimaryLabel(row: SpectrumSubmitResultRow): string {
  return row.invoiceNumber ?? row.invoiceId;
}

function getSecondaryLabel(row: SpectrumSubmitResultRow): string {
  return row.vendorName ?? "Unknown vendor";
}

function getIssueDetail(row: SpectrumSubmitResultRow): string | null {
  const context = getSpectrumSubmitFailureContext(row);
  if (context) return context;
  if (row.duplicate?.reason) return null;

  const issue = row.issue?.trim();
  if (!issue) return null;

  const reason = getSpectrumSubmitFailureReason(row);
  return issue === reason ? null : issue;
}

function SpectrumSubmitPreflightErrors({ errors }: { errors: readonly string[] | undefined }) {
  const display = getSpectrumSubmitErrorDetailDisplay(errors);
  if (display.errors.length === 0) return null;

  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-red-700 dark:text-red-300">
      {display.errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
      {display.remainingCount > 0 && <li>+{display.remainingCount} more</li>}
    </ul>
  );
}

export function SpectrumSubmitResultsView({
  activeFailureInvoiceId = null, phase, discardingInvoiceId = null, failureNavigation = null,
  onDiscardInvoice, onFailureNavigationChange, onOpenInvoice,
}: SpectrumSubmitResultsViewProps) {
  const unresolvedFailures = getUnresolvedSpectrumSubmitFailures(phase);
  const navigation = failureNavigation ?? getSpectrumSubmitFailureNavigation(phase, activeFailureInvoiceId);
  const canNavigateFailures = navigation.total > 1 && Boolean(onFailureNavigationChange);
  const displayRows = [
    ...phase.rows.filter((row) => !row.submitted),
    ...phase.rows.filter((row) => row.submitted),
  ];

  return (
    <div className="space-y-3 px-5 py-4 sm:px-6">
      <p className="sr-only">
        <span className="font-medium text-foreground">{phase.submittedCount}/{phase.rows.length}</span>{" "}
        invoice{phase.rows.length !== 1 ? "s" : ""} submitted to Spectrum.
      </p>
      <ScrollableList ariaLabel="Spectrum submission results" maxHeight="md">
        {displayRows.map((row) => {
          const actionable = isSpectrumSubmitResultActionable(row);
          const discarding = discardingInvoiceId === row.invoiceId;
          const active = actionable && row.invoiceId === activeFailureInvoiceId;
          const issueDetail = getIssueDetail(row);

          return (
            <ScrollableListRow
              key={row.invoiceId}
              active={active}
              className={cn(
                "flex items-start gap-3",
                active && "bg-amber-50/70 ring-1 ring-inset ring-amber-300 dark:bg-amber-950/20",
                row.discarded && "text-muted-foreground",
              )}
            >
              {row.submitted ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-mono font-semibold tabular-nums text-foreground">{getPrimaryLabel(row)}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{getSecondaryLabel(row)}</span>
                </div>
                {row.submitted ? (
                  <p className="mt-1 text-xs text-muted-foreground">Submitted to Spectrum</p>
                ) : (
                  <div className="mt-1 space-y-0.5">
                    <p className="text-xs font-semibold text-foreground">{getSpectrumSubmitFailureReason(row)}</p>
                    <SpectrumSubmitPreflightErrors errors={row.preflightErrors} />
                    {issueDetail && (
                      <p className="font-mono text-2xs text-muted-foreground">Spectrum issue: {issueDetail}</p>
                    )}
                  </div>
                )}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2 self-center">
                {row.submitted ? (
                  <span className="font-mono text-xs tabular-nums text-foreground">{formatSpectrumSubmitCurrency(row.amount)}</span>
                ) : actionable ? (
                  <>
                    <Button size="sm" type="button" variant="outline" onClick={() => onOpenInvoice?.(row.invoiceId)}>
                      <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      Open
                    </Button>
                    <Button
                      aria-label={`Discard ${getPrimaryLabel(row)}`}
                      disabled={discarding}
                      size="icon-sm"
                      title="Discard"
                      type="button"
                      variant="outline"
                      onClick={() => onDiscardInvoice?.(row)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </>
                ) : (
                  <span className="text-xs font-semibold text-muted-foreground">Resolved</span>
                )}
              </div>
            </ScrollableListRow>
          );
        })}
      </ScrollableList>
      {unresolvedFailures.length > 0 ? (
        <InlineNotice
          tone="warning"
          role="alert"
          className="flex-wrap rounded-none border-x-0 border-b-0 border-t border-dashed bg-transparent p-0 pt-3 text-amber-700 dark:text-amber-300"
          bodyClassName="flex min-w-0 flex-wrap items-center gap-2"
          actions={(
            <div
              aria-label="Unresolved failure navigation"
              className="flex items-center gap-1 text-foreground"
              role="group"
            >
              <Button
                aria-label="Previous unresolved failure"
                disabled={!canNavigateFailures}
                size="icon-xs"
                title="Previous unresolved failure"
                type="button"
                variant="outline"
                onClick={() => onFailureNavigationChange?.(navigation.previousInvoiceId)}
              >
                <ChevronLeft className="h-3 w-3" aria-hidden="true" />
              </Button>
              <span
                aria-label="Current unresolved failure"
                className="min-w-9 text-center text-xs font-semibold tabular-nums"
              >
                {navigation.position} / {navigation.total}
              </span>
              <Button
                aria-label="Next unresolved failure"
                disabled={!canNavigateFailures}
                size="icon-xs"
                title="Next unresolved failure"
                type="button"
                variant="outline"
                onClick={() => onFailureNavigationChange?.(navigation.nextInvoiceId)}
              >
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              </Button>
            </div>
          )}
        >
          <span>{unresolvedFailures.length} failed.</span>
          <Button
            className="h-auto p-0 text-sm font-semibold text-amber-700 underline-offset-2 hover:text-amber-800 dark:text-amber-300"
            type="button"
            variant="link"
            onClick={() => {
              if (navigation.activeInvoiceId) {
                onOpenInvoice?.(navigation.activeInvoiceId);
              }
            }}
          >
            Fix {unresolvedFailures.length} failed -&gt;
          </Button>
          <span>opens just these to correct and resubmit, or discard them.</span>
        </InlineNotice>
      ) : phase.failedCount > 0 ? (
        <InlineNotice
          tone="success"
          role="status"
          icon={CheckCircle2}
          className="rounded-none border-x-0 border-b-0 border-t border-dashed bg-transparent p-0 pt-3 font-semibold"
        >
          All failures resolved.
        </InlineNotice>
      ) : null}
    </div>
  );
}
