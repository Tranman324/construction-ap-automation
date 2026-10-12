import type {
  Rule,
  RuleAction,
  RuleCriterion,
  RuleUpdatePayload,
} from "@/modules/accounting/modules/invoices/types/rules";
import {
  CLEARABLE_ACTIONS,
  VALUELESS_ACTIONS,
} from "@/modules/accounting/modules/invoices/components/settings/ruleActionBehavior";
import type { RuleLabelMaps } from "@/modules/accounting/modules/invoices/components/settings/ruleLabels";

export type RuleMoveDirection = "up" | "down";

export interface RuleDraft {
  name: string;
  isActive: boolean;
  stopOnMatch: boolean;
  criteria: RuleCriterion[];
  actions: RuleAction[];
}

export interface RuleWorkspaceStats {
  total: number;
  active: number;
  disabled: number;
  stopOnMatch: number;
  actionCount: number;
  latestUpdatedAt: string | null;
}

export interface CriterionDisplay {
  lead: string;
  value: string;
  isMono: boolean;
}

export interface ActionDisplay {
  label: string;
  value: string | null;
  tone: "primary" | "success" | "warning" | "muted";
}

const MONO_FIELDS = new Set<string>([
  "vendor_code",
  "amount",
  "invoice_number",
  "job_number",
  "email_from",
]);

const PRIMARY_ACTIONS = new Set<string>(["set_vendor", "set_job", "set_classification"]);
const SUCCESS_ACTIONS = new Set<string>(["auto_approve", "auto_file"]);
const WARNING_ACTIONS = new Set<string>(["auto_discard", "flag"]);

export function createDefaultCriterion(): RuleCriterion {
  return { field: "vendor_name", operator: "contains", values: [""] };
}

export function createDefaultAction(): RuleAction {
  return { type: "hide_from_queue" };
}

export function sortRulesByOrder(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function buildRuleWorkspaceStats(rules: Rule[]): RuleWorkspaceStats {
  const latest = rules.reduce<string | null>((current, rule) => {
    if (!rule.updatedAt) return current;
    if (!current) return rule.updatedAt;
    return Date.parse(rule.updatedAt) > Date.parse(current) ? rule.updatedAt : current;
  }, null);

  return {
    total: rules.length,
    active: rules.filter((rule) => rule.isActive).length,
    disabled: rules.filter((rule) => !rule.isActive).length,
    stopOnMatch: rules.filter((rule) => rule.stopOnMatch).length,
    actionCount: rules.reduce((count, rule) => count + rule.actions.length, 0),
    latestUpdatedAt: latest,
  };
}

export function moveRuleIds(
  rules: Rule[],
  ruleId: string,
  direction: RuleMoveDirection,
): string[] {
  const sorted = sortRulesByOrder(rules);
  const index = sorted.findIndex((rule) => rule.id === ruleId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return [];
  [sorted[index], sorted[swapIndex]] = [sorted[swapIndex], sorted[index]];
  return sorted.map((rule) => rule.id);
}

export function createRuleDraft(rule: Rule): RuleDraft {
  return {
    name: rule.name,
    isActive: rule.isActive,
    stopOnMatch: rule.stopOnMatch,
    criteria: rule.criteria.map((criterion) => ({
      ...criterion,
      values: [...criterion.values],
    })),
    actions: rule.actions.map((action) => ({ ...action })),
  };
}

export function toRuleUpdatePayload(draft: RuleDraft): RuleUpdatePayload {
  return {
    name: draft.name.trim(),
    isActive: draft.isActive,
    stopOnMatch: draft.stopOnMatch,
    criteria: draft.criteria,
    actions: draft.actions,
  };
}

export function formatCriterion(criterion: RuleCriterion, labels: RuleLabelMaps): CriterionDisplay {
  const value = formatCriterionValue(criterion);
  const fieldLabel = labels.fields[criterion.field] ?? criterion.field;
  const operatorLabel = labels.operators[criterion.operator] ?? criterion.operator;
  return {
    lead: `${fieldLabel} ${operatorLabel.toLowerCase()}`,
    value,
    isMono: MONO_FIELDS.has(criterion.field),
  };
}

export function formatAction(action: RuleAction, labels: RuleLabelMaps): ActionDisplay {
  const clearsValue = action.clear === true && CLEARABLE_ACTIONS.has(action.type);
  const actionLabel = labels.actions[action.type] ?? action.type;
  return {
    label: clearsValue ? actionLabel.replace(/^Set /, "Clear ") : actionLabel,
    value: clearsValue || VALUELESS_ACTIONS.has(action.type) ? null : action.value ?? "",
    tone: clearsValue ? "muted" : actionTone(action),
  };
}

export function formatRuleSummary(rule: Rule, labels: RuleLabelMaps): string {
  const criteria = rule.criteria.map((criterion) => {
    const display = formatCriterion(criterion, labels);
    return `${display.lead} ${display.value}`;
  });
  const actions = rule.actions.map((action) => {
    const display = formatAction(action, labels);
    return display.value ? `${display.label} ${display.value}` : display.label;
  });
  return `${criteria.join(" AND ")} -> ${actions.join(", ")}`;
}

function formatCriterionValue(criterion: RuleCriterion): string {
  if (criterion.operator === "is_empty" || criterion.operator === "is_not_empty") {
    return "any value";
  }
  if (criterion.operator === "between") {
    return `${criterion.values[0] ?? ""} and ${criterion.values[1] ?? ""}`.trim();
  }
  return criterion.values.filter(Boolean).join(" or ") || "unfilled";
}

function actionTone(action: RuleAction): ActionDisplay["tone"] {
  if (PRIMARY_ACTIONS.has(action.type)) return "primary";
  if (SUCCESS_ACTIONS.has(action.type)) return "success";
  if (WARNING_ACTIONS.has(action.type)) return "warning";
  return "muted";
}
