"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CheckCircle2,
  EyeOff,
  FileCheck2,
  Flag,
  FolderInput,
  StopCircle,
  Tags,
  UserPlus,
} from "lucide-react";

import type {
  RuleAction,
  RuleActionType,
  RuleCriterion,
} from "@/modules/accounting/modules/invoices/types/rules";
import {
  formatAction,
  formatCriterion,
  type ActionDisplay,
} from "@/modules/accounting/modules/invoices/components/settings/ruleWorkspaceModel";
import { ruleLabelMapsFromOptions } from "@/modules/accounting/modules/invoices/components/settings/ruleLabels";
import { useRuleOptions } from "@/modules/accounting/modules/invoices/hooks/queries";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Switch } from "@/modules/shared/components/ui/switch";
import { cn } from "@/modules/shared/lib/utils";

const ACTION_ICONS: Record<RuleActionType, LucideIcon> = {
  auto_approve: CheckCircle2,
  auto_discard: Bell,
  auto_file: FolderInput,
  hide_from_queue: EyeOff,
  set_vendor: Tags,
  set_job: Tags,
  set_classification: Tags,
  assign_reviewer: UserPlus,
  add_note: FileCheck2,
  flag: Flag,
  set_phase_code: Tags,
  set_gl_account: Tags,
  set_cost_type: Tags,
  set_routing_code: Tags,
};

const TONE_CLASSES: Record<ActionDisplay["tone"], string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  muted: "bg-muted text-muted-foreground",
};

const CHIP_TONE_CLASSES: Record<ActionDisplay["tone"], string> = {
  primary: "border-primary/30 text-primary",
  success: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
  warning: "border-amber-500/30 text-amber-600 dark:text-amber-400",
  muted: "text-muted-foreground",
};

interface RuleCriteriaChipsProps {
  criteria: RuleCriterion[];
  compact?: boolean;
}

interface RuleActionListProps {
  actions: RuleAction[];
  stopOnMatch: boolean;
  dense?: boolean;
}

interface RuleActiveSwitchProps {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function RuleCriteriaChips({ criteria, compact = false }: RuleCriteriaChipsProps) {
  const labels = ruleLabelMapsFromOptions(useRuleOptions().data);
  if (criteria.length === 0) {
    return <span className="text-xs text-muted-foreground">No criteria configured</span>;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {criteria.map((criterion, index) => {
        const display = formatCriterion(criterion, labels);
        const emailParts = compact && criterion.field === "email_from"
          ? splitEmailAddress(display.value)
          : null;
        return (
          <span key={`${criterion.field}-${index}`} className="inline-flex items-center gap-1.5">
            {index > 0 && <span className="text-xs text-muted-foreground">and</span>}
            <span className={cn("text-muted-foreground", compact ? "text-2xs" : "text-xs")}>
              {display.lead}
            </span>
            <Badge
              variant="secondary"
              className={cn(
                emailParts ? "max-w-full whitespace-normal" : "max-w-44 truncate",
                compact && "px-1.5 py-0 text-2xs",
                display.isMono && "font-mono",
              )}
              title={display.value}
              aria-label={emailParts ? display.value : undefined}
            >
              {emailParts ? (
                <span className="flex flex-col items-start leading-tight">
                  <span>{emailParts.local}</span>
                  <span>@{emailParts.domain}</span>
                </span>
              ) : display.value}
            </Badge>
          </span>
        );
      })}
    </span>
  );
}

function splitEmailAddress(value: string): { local: string; domain: string } | null {
  const separator = value.indexOf("@");
  if (separator <= 0 || separator === value.length - 1) return null;

  return {
    local: value.slice(0, separator),
    domain: value.slice(separator + 1),
  };
}

export function RuleActionList({ actions, stopOnMatch, dense = false }: RuleActionListProps) {
  const labels = ruleLabelMapsFromOptions(useRuleOptions().data);
  const rows = stopOnMatch ? [...actions, { type: "hide_from_queue" as const, value: "Stop processing further rules" }] : actions;

  if (rows.length === 0) {
    return <span className="text-xs text-muted-foreground">No actions configured</span>;
  }

  return (
    <ul className={cn("flex flex-col", dense ? "gap-1.5" : "gap-2")}>
      {rows.map((action, index) => {
        const isStopRow = stopOnMatch && index === rows.length - 1;
        const display = isStopRow
          ? { label: "Stop processing further rules", value: null, tone: "muted" as const }
          : formatAction(action, labels);
        const Icon = isStopRow ? StopCircle : ACTION_ICONS[action.type];

        return (
          <li key={`${action.type}-${index}`} className="flex items-center gap-2">
            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", TONE_CLASSES[display.tone])}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className={cn("min-w-0 text-sm text-foreground", dense && "text-xs")}>
              {display.label}
              {display.value ? <strong className="ml-1 font-mono font-semibold">{display.value}</strong> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function RuleActionSummary({ actions, stopOnMatch, max = 2 }: RuleActionListProps & { max?: number }) {
  const labels = ruleLabelMapsFromOptions(useRuleOptions().data);
  const shown = actions.slice(0, max);
  const extra = actions.length - shown.length;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {shown.map((action, index) => {
        const display = formatAction(action, labels);
        return (
          <Badge key={`${action.type}-${index}`} variant="outline" className={cn("font-mono text-2xs", CHIP_TONE_CLASSES[display.tone])}>
            {display.value ? `${display.label} ${display.value}` : display.label}
          </Badge>
        );
      })}
      {extra > 0 && <span className="text-xs font-semibold text-muted-foreground">+{extra}</span>}
      {stopOnMatch && <StopCircle className="h-3.5 w-3.5 text-muted-foreground" aria-label="Stops further rules" />}
    </span>
  );
}

export function RuleActiveSwitch({ checked, label, disabled, onCheckedChange }: RuleActiveSwitchProps) {
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className="data-[state=checked]:bg-primary"
    />
  );
}

export function RulePriorityBadge({ order }: { order: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs font-semibold text-muted-foreground">
      {order + 1}
    </span>
  );
}
