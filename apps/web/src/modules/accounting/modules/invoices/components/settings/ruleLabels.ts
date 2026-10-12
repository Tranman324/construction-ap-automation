// Served rule-catalog label maps. The rule-builder catalogs (actions, fields,
// operators) are fetched via `useRuleOptions`; pure model functions receive the
// resolved label lookups through `RuleLabelMaps` instead of importing a
// hardcoded catalog. A missing label falls back to the raw key so non-UI
// callers and partial data never crash.

import type { RuleOptionsResponse, RuleOptionItem } from "@/modules/accounting/modules/invoices/types/api";

export interface RuleLabelMaps {
  fields: Record<string, string>;
  operators: Record<string, string>;
  actions: Record<string, string>;
}

function toLabelRecord(items: RuleOptionItem[] | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  for (const item of items ?? []) {
    record[item.value] = item.label;
  }
  return record;
}

export function ruleLabelMapsFromOptions(options: RuleOptionsResponse | undefined): RuleLabelMaps {
  return {
    fields: toLabelRecord(options?.fields),
    operators: toLabelRecord(options?.operators),
    actions: toLabelRecord(options?.actions),
  };
}
