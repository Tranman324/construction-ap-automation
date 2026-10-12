import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { RuleCriterion } from "@/modules/accounting/modules/invoices/types/rules";
import type { RuleBuilderDraft } from "@/modules/accounting/modules/invoices/components/settings/ruleBuilderModel";
import {
  isBetweenOperator,
  isNullaryOperator,
  matchesAllCriteria,
} from "@/modules/accounting/modules/invoices/lib/rules/helpers";

export type RulePreviewKind = "real" | "empty" | "placeholder";

export interface RulePreviewRow {
  id: string;
  vendorName: string;
  invoiceNumber: string;
  jobNumber: string;
  amount: number | null;
}

export interface RulePreviewResult {
  kind: RulePreviewKind;
  message: string;
  matchCount: number;
  rows: RulePreviewRow[];
}

export function buildRulePreview(
  draft: RuleBuilderDraft,
  invoices: Invoice[],
): RulePreviewResult {
  const incompleteReason = findIncompleteCriterion(draft.criteria);
  if (incompleteReason) {
    return buildPlaceholderPreview(incompleteReason);
  }

  if (invoices.length === 0) {
    return buildPlaceholderPreview("Queue data is still loading, so this is an example preview.");
  }

  const matches = invoices.filter((invoice) => matchesAllCriteria(invoice, draft.criteria));
  const rows = matches.map(invoiceToPreviewRow).slice(0, 8);

  if (matches.length === 0) {
    return {
      kind: "empty",
      message: "No invoices in the current queue match yet.",
      matchCount: 0,
      rows: [],
    };
  }

  return {
    kind: "real",
    message: "Matched against invoices currently loaded in the queue.",
    matchCount: matches.length,
    rows,
  };
}

export function invoiceToPreviewRow(invoice: Invoice): RulePreviewRow {
  return {
    id: invoice.id,
    vendorName: invoice.extracted?.vendorName ?? invoice.matching?.vendor?.vendorName ?? "Unknown vendor",
    invoiceNumber: invoice.extracted?.invoiceNumber ?? invoice.id,
    jobNumber: invoice.extracted?.jobNumber ?? invoice.matching?.job?.jobNumber ?? "No job",
    amount: invoice.extracted?.amount ?? null,
  };
}

function findIncompleteCriterion(criteria: RuleCriterion[]): string | null {
  if (criteria.length === 0) return "Add a criterion to preview matching invoices.";

  for (const criterion of criteria) {
    if (isNullaryOperator(criterion.operator)) continue;
    if (isBetweenOperator(criterion.operator)) {
      if (!criterion.values[0]?.trim() || !criterion.values[1]?.trim()) {
        return "Complete the range criterion to preview real queue matches.";
      }
      continue;
    }
    if (!criterion.values.some((value) => value.trim().length > 0)) {
      return "Complete the criterion value to preview real queue matches.";
    }
  }

  return null;
}

function buildPlaceholderPreview(reason: string): RulePreviewResult {
  return {
    kind: "placeholder",
    message: reason,
    matchCount: 3,
    rows: [
      {
        id: "preview-sample-1",
        vendorName: "Example Concrete Supply",
        invoiceNumber: "INV-1048",
        jobNumber: "24-101",
        amount: 2840.12,
      },
      {
        id: "preview-sample-2",
        vendorName: "Example Equipment Rental",
        invoiceNumber: "ER-7712",
        jobNumber: "24-118",
        amount: 643.75,
      },
      {
        id: "preview-sample-3",
        vendorName: "Example Electrical",
        invoiceNumber: "EE-3319",
        jobNumber: "24-129",
        amount: 1189,
      },
    ],
  };
}
