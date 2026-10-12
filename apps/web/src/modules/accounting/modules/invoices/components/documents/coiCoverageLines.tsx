"use client";

import { CalendarClock, ChevronDown, ChevronRight } from "lucide-react";

import { formatCoiLimit, type CoiCoverageLineDisplay } from "@/modules/accounting/modules/invoices/components/documents/coiDocumentData";
import type { CoiComplianceResult } from "@/modules/accounting/modules/invoices/types/api";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";
import { PanelNotice } from "./PanelNotice";

export interface CoiCoverageLinesProps {
  coverageLines: readonly CoiCoverageLineDisplay[];
  coverageFailures: CoiComplianceResult["coverageFailures"];
  coverageExceptions: CoiComplianceResult["coverageExceptions"];
  expandedCoverage: Readonly<Record<string, boolean>>;
  onToggle: (lineId: string) => void;
}

export function CoiCoverageLines({ coverageLines, coverageFailures, coverageExceptions, expandedCoverage, onToggle }: CoiCoverageLinesProps) {
  const coverageLineIds = new Set(coverageLines.map((line) => line.id));
  const unmatchedFailures = coverageFailures.filter((failure) => !coverageLineIds.has(failure.coverageId));
  const unmatchedExceptions = coverageExceptions.filter((exception) => !coverageLineIds.has(exception.coverageId));

  return <div className="space-y-3">{coverageLines.map((line) => {
    const expanded = Boolean(expandedCoverage[line.id]);
    const failures = coverageFailures.filter((failure) => failure.coverageId === line.id);
    const exceptions = coverageExceptions.filter((exception) => exception.coverageId === line.id);
    const limits = expanded ? line.limits : line.limits.slice(0, 3);
    return <div key={line.id} className={cn("rounded-lg border p-3", failures.length ? "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/10" : "border-border bg-muted/20")}>
      <div className="flex items-start gap-3"><CalendarClock className="mt-1 h-4 w-4 text-muted-foreground" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="font-semibold text-foreground">{line.label}</p><p className="font-mono text-xs text-muted-foreground">{line.policyNumber} - {line.carrier} - exp {line.expirationDate ?? "Unknown"}</p></div>{line.limits.length > 3 && <Button type="button" variant="ghost" size="sm" onClick={() => onToggle(line.id)}>{expanded ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}{expanded ? "Hide" : "Show"} limits</Button>}</div>
      {failures.length > 0 && <PanelNotice tabId="coverage" id={`coi-coverage-failure-${line.id}`} label={`${line.label} coverage minimums`}><div role="group" aria-label={`${line.label} coverage minimums`}><p className="font-semibold text-foreground">{line.label}</p><p className="mt-2 text-xs text-red-700 dark:text-red-300">{failures.map((failure) => `${failure.limitLabel}: server minimum ${formatCoiLimit(failure.minimum)}`).join(" · ")}</p></div></PanelNotice>}
      {exceptions.length > 0 && <PanelNotice tabId="coverage" id={`coi-coverage-exception-${line.id}`} label={`${line.label} informational limits`} resolved><div role="group" aria-label={`${line.label} informational limits`}><p className="font-semibold text-foreground">{line.label}</p><p className="mt-2 text-xs text-muted-foreground">Not enforced — informational: {exceptions.map((exception) => `${exception.limitLabel}: reference minimum ${formatCoiLimit(exception.minimum)}`).join(" · ")}</p></div></PanelNotice>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{limits.map((limit) => <div key={`${line.id}-${limit.label}`} className="rounded-md border bg-background px-3 py-2"><p className="text-xs font-medium text-muted-foreground">{limit.label}</p><p className="font-mono text-sm">{formatCoiLimit(limit.value)}</p></div>)}</div>
    </div>;
  })}{unmatchedFailures.map((failure) => <PanelNotice tabId="coverage" key={`${failure.coverageId}-${failure.limitLabel}`} id={`coi-coverage-failure-${failure.coverageId}-${failure.limitLabel}`} label={`${failure.coverageLabel} coverage minimum`}><div className="rounded-lg border border-red-200 bg-red-50/60 p-3 dark:border-red-900 dark:bg-red-950/10"><p className="font-semibold text-foreground">{failure.coverageLabel}</p><p className="mt-2 text-xs text-red-700 dark:text-red-300">{failure.limitLabel}: {failure.value === null ? "not reported" : formatCoiLimit(failure.value)}; server minimum {formatCoiLimit(failure.minimum)}</p></div></PanelNotice>)}{unmatchedExceptions.map((exception) => <PanelNotice tabId="coverage" key={`${exception.coverageId}-${exception.limitLabel}`} id={`coi-coverage-exception-${exception.coverageId}-${exception.limitLabel}`} label={`${exception.coverageLabel} informational limit`} resolved><div className="rounded-lg border bg-muted/20 p-3"><p className="font-semibold text-foreground">{exception.coverageLabel}</p><p className="mt-2 text-xs text-muted-foreground">Not enforced — informational: {exception.limitLabel}: {exception.value === null ? "not reported" : formatCoiLimit(exception.value)}; reference minimum {formatCoiLimit(exception.minimum)}</p></div></PanelNotice>)}</div>;
}
