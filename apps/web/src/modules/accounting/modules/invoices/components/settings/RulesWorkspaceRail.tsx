"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from "lucide-react";

import type { Rule } from "@/modules/accounting/modules/invoices/types/rules";
import {
  RuleActionSummary,
  RuleActiveSwitch,
  RuleCriteriaChips,
  RulePriorityBadge,
} from "@/modules/accounting/modules/invoices/components/settings/RuleWorkspaceAtoms";
import {
  formatRuleSummary,
  type RuleMoveDirection,
} from "@/modules/accounting/modules/invoices/components/settings/ruleWorkspaceModel";
import { ruleLabelMapsFromOptions } from "@/modules/accounting/modules/invoices/components/settings/ruleLabels";
import { useRuleOptions } from "@/modules/accounting/modules/invoices/hooks/queries";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { cn } from "@/modules/shared/lib/utils";

interface RulesWorkspaceRailProps {
  rules: Rule[];
  selectedRuleId: string | null;
  searchTerm: string;
  isMutating?: boolean;
  onSearchTermChange: (value: string) => void;
  onSelectRule: (ruleId: string) => void;
  onToggleRule: (rule: Rule, checked: boolean) => void;
  onMoveRule: (ruleId: string, direction: RuleMoveDirection) => void;
  onDeleteRule: (rule: Rule) => void;
  onCreateRule: () => void;
}

export function RulesWorkspaceRail({
  rules,
  selectedRuleId,
  searchTerm,
  isMutating = false,
  onSearchTermChange,
  onSelectRule,
  onToggleRule,
  onMoveRule,
  onDeleteRule,
  onCreateRule,
}: RulesWorkspaceRailProps) {
  const labels = ruleLabelMapsFromOptions(useRuleOptions().data);
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const visibleRules = normalizedSearch
    ? rules.filter((rule) => `${rule.name} ${formatRuleSummary(rule, labels)}`.toLowerCase().includes(normalizedSearch))
    : rules;

  return (
    <aside className="flex min-h-0 flex-col border-r bg-muted/30">
      <div className="flex items-center gap-2 border-b p-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Search rules..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button size="sm" className="h-8 shrink-0 gap-1.5 px-2.5 text-xs" onClick={onCreateRule}>
          <Plus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {visibleRules.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            No rules match that search.
          </div>
        ) : (
          <ul className="space-y-2">
            {visibleRules.map((rule) => {
              const isSelected = rule.id === selectedRuleId;
              const orderIndex = rules.findIndex((candidate) => candidate.id === rule.id);
              return (
                <li
                  key={rule.id}
                  className={cn(
                    "rounded-lg border bg-card shadow-sm transition-colors",
                    isSelected && "border-primary/40 ring-2 ring-primary/10",
                    !rule.isActive && "opacity-65",
                  )}
                >
                  <div className="flex items-start gap-2 p-3">
                    <button
                      type="button"
                      aria-label={`Select ${rule.name}`}
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onSelectRule(rule.id)}
                    >
                      <div className="flex items-center gap-2">
                        <RulePriorityBadge order={rule.order} />
                        <span className={cn("truncate text-sm font-semibold", isSelected && "text-primary")}>
                          {rule.name}
                        </span>
                      </div>
                      <div className="mt-2">
                        <RuleCriteriaChips criteria={rule.criteria} compact />
                      </div>
                      <div className="mt-2">
                        <RuleActionSummary actions={rule.actions} stopOnMatch={rule.stopOnMatch} />
                      </div>
                    </button>

                    <div className="flex shrink-0 flex-col items-center gap-1">
                      <RuleActiveSwitch
                        checked={rule.isActive}
                        disabled={isMutating}
                        label={`${rule.name} active`}
                        onCheckedChange={(checked) => onToggleRule(rule, checked)}
                      />
                      <div className="flex items-center gap-0.5">
                        <IconButton
                          label={`Move ${rule.name} up`}
                          disabled={isMutating || orderIndex <= 0}
                          onClick={() => onMoveRule(rule.id, "up")}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          label={`Move ${rule.name} down`}
                          disabled={isMutating || orderIndex === rules.length - 1}
                          onClick={() => onMoveRule(rule.id, "down")}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          label={`Delete ${rule.name}`}
                          disabled={isMutating}
                          onClick={() => onDeleteRule(rule)}
                          danger
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

interface IconButtonProps {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
  onClick: () => void;
}

function IconButton({ label, disabled = false, danger = false, children, onClick }: IconButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30",
        danger && "hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}
