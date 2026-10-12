import { matchesCriterion } from "@/modules/accounting/modules/invoices/lib/rules/helpers";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type {
  Rule,
  RuleCriteriaField,
  RuleCriteriaOperator,
} from "@/modules/accounting/modules/invoices/types/rules";
import { formatAction } from "@/modules/accounting/modules/invoices/components/settings/ruleWorkspaceModel";
import type { RuleLabelMaps } from "@/modules/accounting/modules/invoices/components/settings/ruleLabels";

export type RuleOverlapField = "vendor_code" | "email_from" | "vendor_name";

const OVERLAP_FIELDS = new Set<RuleCriteriaField>([
  "vendor_code",
  "email_from",
  "vendor_name",
]);

const POSITIVE_OPERATORS = new Set<RuleCriteriaOperator>([
  "equals",
  "contains",
  "starts_with",
  "ends_with",
]);

const FIELD_PRIORITY: Record<RuleOverlapField, number> = {
  vendor_code: 0,
  email_from: 1,
  vendor_name: 2,
};

export interface RuleOverlap {
  rule: Rule;
  matchedField: RuleOverlapField;
  matchedValue: string;
  actionSummary: string;
}

export function findOverlappingRules(
  sourceInvoice: Invoice,
  existingRules: Rule[],
  labels: RuleLabelMaps,
): RuleOverlap[] {
  const overlaps: RuleOverlap[] = [];

  existingRules.forEach((rule) => {
    if (!rule.isActive) return;

    let bestMatch: RuleOverlap | null = null;
    rule.criteria.forEach((criterion) => {
      if (!isOverlapField(criterion.field)) return;
      if (!POSITIVE_OPERATORS.has(criterion.operator)) return;
      const matchedValue = criterion.values.find((value) => matchesCriterion(sourceInvoice, {
        ...criterion,
        values: [value],
      }));
      if (matchedValue === undefined) return;

      if (!bestMatch || FIELD_PRIORITY[criterion.field] < FIELD_PRIORITY[bestMatch.matchedField]) {
        bestMatch = {
          rule,
          matchedField: criterion.field,
          matchedValue,
          actionSummary: buildActionSummary(rule, labels),
        };
      }
    });

    if (bestMatch) overlaps.push(bestMatch);
  });

  return overlaps;
}

function isOverlapField(field: RuleCriteriaField): field is RuleOverlapField {
  return OVERLAP_FIELDS.has(field);
}

function buildActionSummary(rule: Rule, labels: RuleLabelMaps): string {
  return rule.actions
    .map((action) => {
      const display = formatAction(action, labels);
      return display.value ? `${display.label} ${display.value}` : display.label;
    })
    .join(", ");
}
