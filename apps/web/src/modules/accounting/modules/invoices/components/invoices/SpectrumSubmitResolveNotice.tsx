"use client";

import { AlertTriangle } from "lucide-react";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { SpectrumSubmitFailureWorkflowSnapshot } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitFailureWorkflowModel";

interface SpectrumSubmitResolveNoticeProps {
  issue: string;
}

interface SpectrumSubmitResolveCopy {
  issue: string;
  guidance: string;
}

const ISSUE_GUIDANCE: Array<{ match: RegExp; guidance: string }> = [
  {
    match: /cost type does not match distribution g\/?l account/i,
    guidance: "Update the GL Account in the Allocation tab to match the cost type.",
  },
  {
    match: /g\/?l date is outside of min\/max range for a\/?p/i,
    guidance: "Update the Invoice Date in the Details tab; Toolbox uses it as the GL date.",
  },
  {
    match: /invoice number exists in (invoice approval|posted invoices)/i,
    guidance: "This invoice number already exists in Spectrum. Verify it is not a duplicate before resubmitting.",
  },
];

export function getSpectrumSubmitResolveCopy(issue: string): SpectrumSubmitResolveCopy {
  const trimmed = issue.trim();
  const guidance = ISSUE_GUIDANCE.find((entry) => entry.match.test(trimmed))?.guidance
    ?? "Review and fix the issue below, then resubmit.";

  return {
    issue: trimmed || "Spectrum rejected this invoice.",
    guidance,
  };
}

export function getSpectrumSubmitResolveIssue(
  invoice: Invoice,
  snapshot: SpectrumSubmitFailureWorkflowSnapshot | null,
): string | null {
  const workflowIssue = snapshot?.results.rows
    .find((row) => row.invoiceId === invoice.id && !row.submitted)
    ?.issue
    ?.trim();
  if (workflowIssue) return workflowIssue;

  const invoiceIssue = invoice.lastSpectrumError?.trim();
  return invoiceIssue || null;
}

export function SpectrumSubmitResolveNotice({ issue }: SpectrumSubmitResolveNoticeProps) {
  const copy = getSpectrumSubmitResolveCopy(issue);

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Spectrum rejected this invoice</p>
          <p className="mt-1 text-sm">{copy.issue}</p>
          <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">{copy.guidance}</p>
        </div>
      </div>
    </div>
  );
}
