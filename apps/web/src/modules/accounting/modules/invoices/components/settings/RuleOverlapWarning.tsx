import { AlertTriangle } from "lucide-react";

import type { RuleOverlap } from "@/modules/accounting/modules/invoices/components/settings/ruleIntelligence";
import { useRuleOptions } from "@/modules/accounting/modules/invoices/hooks/queries";

interface RuleOverlapWarningProps {
  overlaps: RuleOverlap[];
}

export function RuleOverlapWarning({ overlaps }: RuleOverlapWarningProps) {
  const { data: ruleOptions, isError, isLoading } = useRuleOptions();
  if (overlaps.length === 0) return null;
  if (isError || isLoading || !ruleOptions) {
    return <div role="status" className="mx-4 mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">Rule fields unavailable</div>;
  }
  const fieldLabels = Object.fromEntries(ruleOptions.fields.map((field) => [field.value, field.label]));

  return (
    <div
      role="status"
      className="mx-4 mt-4 flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">Similar rules exist</p>
        <ul className="mt-1 space-y-1 text-xs">
          {overlaps.map((overlap) => (
            <li key={overlap.rule.id}>
              <strong>&ldquo;{overlap.rule.name}&rdquo;</strong>
              {" — "}{fieldLabels[overlap.matchedField] ?? "Field unavailable"} {overlap.matchedValue}
              {overlap.actionSummary ? ` → ${overlap.actionSummary}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
