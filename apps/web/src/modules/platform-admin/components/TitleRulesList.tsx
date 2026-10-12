"use client";

import { Trash2 } from "lucide-react";

import { formatAdminRoleLabel } from "@/modules/platform-admin/lib/adminRoles";
import type { TitleRule } from "@/modules/platform-admin/types/admin";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Button } from "@/modules/shared/components/ui/button";

interface TitleRulesListProps {
  rules: TitleRule[];
  canManageTitleRules: boolean;
  isMutating: boolean;
  onEdit: (rule: TitleRule) => void;
  onDelete: (rule: TitleRule) => void;
}

export function TitleRulesList({
  rules,
  canManageTitleRules,
  isMutating,
  onEdit,
  onDelete,
}: TitleRulesListProps) {
  if (rules.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-border/50 bg-background/70 px-4 py-8 text-sm text-muted-foreground">
        No title rules are configured yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-background/70">
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(8rem,0.7fr)_minmax(10rem,0.9fr)_minmax(6rem,0.5fr)_minmax(7rem,0.5fr)_auto] gap-3 border-b border-border/50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <span>Pattern</span>
        <span>Match</span>
        <span>Role</span>
        <span>Priority</span>
        <span>Status</span>
        <span className="text-right">Actions</span>
      </div>

      {rules.map((rule) => (
        <div
          key={rule.id}
          data-testid={`title-rule-row-${rule.id}`}
          className="grid grid-cols-[minmax(0,1.2fr)_minmax(8rem,0.7fr)_minmax(10rem,0.9fr)_minmax(6rem,0.5fr)_minmax(7rem,0.5fr)_auto] gap-3 border-b border-border/40 px-4 py-4 last:border-b-0"
        >
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{rule.pattern}</p>
          </div>
          <p className="text-sm text-muted-foreground">{rule.match_type}</p>
          <p className="text-sm text-foreground">{formatAdminRoleLabel(rule.role_name, "Unknown role")}</p>
          <p className="font-mono text-sm text-foreground">{rule.priority}</p>
          <Badge
            variant="outline"
            className={
              rule.is_active
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-border/60 bg-muted/60 text-muted-foreground"
            }
          >
            {rule.is_active ? "Active" : "Inactive"}
          </Badge>
          <div className="space-y-2 justify-self-end text-right">
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid={`edit-title-rule-${rule.id}`}
                onClick={() => onEdit(rule)}
                disabled={!canManageTitleRules || isMutating}
              >
                Edit
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid={`delete-title-rule-${rule.id}`}
                className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onDelete(rule)}
                disabled={!canManageTitleRules || isMutating}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
            {!canManageTitleRules ? (
              <p className="text-xs text-muted-foreground">Requires platform.manage_title_rules</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}