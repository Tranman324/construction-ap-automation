"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import type {
  RuleAction,
  RuleCriterion,
} from "@/modules/accounting/modules/invoices/types/rules";
import type { RuleBuilderDraft } from "@/modules/accounting/modules/invoices/components/settings/ruleBuilderModel";
import { RuleActionRow } from "@/modules/accounting/modules/invoices/components/settings/RuleActionRow";
import { RuleBuilderRunOptions } from "@/modules/accounting/modules/invoices/components/settings/RuleBuilderRunOptions";
import { RuleCriterionRow } from "@/modules/accounting/modules/invoices/components/settings/RuleCriterionRow";
import {
  RuleActionList,
  RuleCriteriaChips,
} from "@/modules/accounting/modules/invoices/components/settings/RuleWorkspaceAtoms";
import { createDefaultAction, createDefaultCriterion } from "@/modules/accounting/modules/invoices/components/settings/ruleWorkspaceModel";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";

interface RuleBuilderBlocksProps {
  draft: RuleBuilderDraft;
  disabled?: boolean;
  onDraftChange: (draft: RuleBuilderDraft) => void;
}

export function RuleBuilderBlocks({
  draft,
  disabled = false,
  onDraftChange,
}: RuleBuilderBlocksProps) {
  function patchDraft(patch: Partial<RuleBuilderDraft>) {
    onDraftChange({ ...draft, ...patch });
  }

  function updateCriterion(index: number, updated: RuleCriterion) {
    patchDraft({
      criteria: draft.criteria.map((criterion, candidateIndex) => (
        candidateIndex === index ? updated : criterion
      )),
    });
  }

  function updateAction(index: number, updated: RuleAction) {
    patchDraft({
      actions: draft.actions.map((action, candidateIndex) => (
        candidateIndex === index ? updated : action
      )),
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="rule-builder-name">
          Rule name
        </label>
        <Input
          id="rule-builder-name"
          value={draft.name}
          disabled={disabled}
          onChange={(event) => patchDraft({ name: event.target.value })}
        />
      </div>

      <BuilderSection label="If" title="Invoice matches all criteria">
        <div className="rounded-lg border bg-muted/25 p-3">
          <RuleCriteriaChips criteria={draft.criteria} />
        </div>
        <div className="mt-3 space-y-3">
          {draft.criteria.map((criterion, index) => (
            <RuleCriterionRow
              key={`${criterion.field}-${index}`}
              criterion={criterion}
              onChange={(updated) => updateCriterion(index, updated)}
              onRemove={() => patchDraft({ criteria: draft.criteria.filter((_, candidateIndex) => candidateIndex !== index) })}
              showRemove={draft.criteria.length > 1}
            />
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 w-full gap-2 border-dashed"
          disabled={disabled}
          onClick={() => patchDraft({ criteria: [...draft.criteria, createDefaultCriterion()] })}
        >
          <Plus className="h-4 w-4" />
          Add criterion
        </Button>
      </BuilderSection>

      <BuilderSection label="Then" title="Apply these actions">
        <div className="rounded-lg border bg-muted/25 p-3">
          <RuleActionList actions={draft.actions} stopOnMatch={draft.stopOnMatch} dense />
        </div>
        <div className="mt-3 space-y-3">
          {draft.actions.map((action, index) => (
            <RuleActionRow
              key={`${action.type}-${index}`}
              action={action}
              onChange={(updated) => updateAction(index, updated)}
              onRemove={() => patchDraft({ actions: draft.actions.filter((_, candidateIndex) => candidateIndex !== index) })}
              showRemove={draft.actions.length > 1}
            />
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 w-full gap-2 border-dashed"
          disabled={disabled}
          onClick={() => patchDraft({ actions: [...draft.actions, createDefaultAction()] })}
        >
          <Plus className="h-4 w-4" />
          Add action
        </Button>
      </BuilderSection>

      <BuilderSection label="Run" title="Rule behavior">
        <RuleBuilderRunOptions draft={draft} disabled={disabled} onDraftChange={onDraftChange} />
      </BuilderSection>
    </div>
  );
}

function BuilderSection({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-md bg-primary/10 px-2 py-1 text-2xs font-bold uppercase tracking-wide text-primary">
          {label}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}
