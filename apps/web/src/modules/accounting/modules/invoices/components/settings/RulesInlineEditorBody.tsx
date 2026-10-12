"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Plus } from "lucide-react";

import type {
  RuleAction,
  RuleCriterion,
} from "@/modules/accounting/modules/invoices/types/rules";
import { RuleActionRow } from "@/modules/accounting/modules/invoices/components/settings/RuleActionRow";
import { RuleCriterionRow } from "@/modules/accounting/modules/invoices/components/settings/RuleCriterionRow";
import {
  RuleActionList,
  RuleActiveSwitch,
  RuleCriteriaChips,
} from "@/modules/accounting/modules/invoices/components/settings/RuleWorkspaceAtoms";
import {
  createDefaultAction,
  createDefaultCriterion,
  type RuleDraft,
} from "@/modules/accounting/modules/invoices/components/settings/ruleWorkspaceModel";
import { Button } from "@/modules/shared/components/ui/button";
import { Separator } from "@/modules/shared/components/ui/separator";

interface RulesInlineEditorBodyProps {
  draft: RuleDraft;
  isSaving: boolean;
  setDraft: Dispatch<SetStateAction<RuleDraft>>;
}

export function RulesInlineEditorBody({
  draft,
  isSaving,
  setDraft,
}: RulesInlineEditorBodyProps) {
  function patchDraft(patch: Partial<RuleDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateCriterion(index: number, updated: RuleCriterion) {
    setDraft((current) => ({
      ...current,
      criteria: current.criteria.map((criterion, candidateIndex) => (
        candidateIndex === index ? updated : criterion
      )),
    }));
  }

  function removeCriterion(index: number) {
    setDraft((current) => ({
      ...current,
      criteria: current.criteria.filter((_, candidateIndex) => candidateIndex !== index),
    }));
  }

  function updateAction(index: number, updated: RuleAction) {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action, candidateIndex) => (
        candidateIndex === index ? updated : action
      )),
    }));
  }

  function removeAction(index: number) {
    setDraft((current) => ({
      ...current,
      actions: current.actions.filter((_, candidateIndex) => candidateIndex !== index),
    }));
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
        <div className="space-y-5">
          <EditorSection label="If" title="Invoice matches all criteria">
            <div className="mb-3 rounded-lg border bg-muted/25 p-3">
              <RuleCriteriaChips criteria={draft.criteria} />
            </div>
            <div className="space-y-3">
              {draft.criteria.map((criterion, index) => (
                <RuleCriterionRow
                  key={`${criterion.field}-${index}`}
                  criterion={criterion}
                  onChange={(updated) => updateCriterion(index, updated)}
                  onRemove={() => removeCriterion(index)}
                  showRemove={draft.criteria.length > 1}
                />
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 w-full gap-2 border-dashed"
              onClick={() => patchDraft({ criteria: [...draft.criteria, createDefaultCriterion()] })}
            >
              <Plus className="h-4 w-4" />
              Add criterion
            </Button>
          </EditorSection>

          <EditorSection label="Then" title="Apply these actions">
            <div className="mb-3 rounded-lg border bg-muted/25 p-3">
              <RuleActionList actions={draft.actions} stopOnMatch={draft.stopOnMatch} dense />
            </div>
            <div className="space-y-3">
              {draft.actions.map((action, index) => (
                <RuleActionRow
                  key={`${action.type}-${index}`}
                  action={action}
                  onChange={(updated) => updateAction(index, updated)}
                  onRemove={() => removeAction(index)}
                  showRemove={draft.actions.length > 1}
                />
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 w-full gap-2 border-dashed"
              onClick={() => patchDraft({ actions: [...draft.actions, createDefaultAction()] })}
            >
              <Plus className="h-4 w-4" />
              Add action
            </Button>
          </EditorSection>
        </div>

        <aside className="rounded-lg border bg-muted/25 p-4">
          <h3 className="text-sm font-semibold">Run behavior</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Rules run from top to bottom on every incoming invoice.
          </p>
          <Separator className="my-4" />
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">Stop after match</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Prevent lower-priority rules from changing this invoice.
              </span>
            </span>
            <RuleActiveSwitch
              checked={draft.stopOnMatch}
              disabled={isSaving}
              label="Stop processing further rules"
              onCheckedChange={(checked) => patchDraft({ stopOnMatch: checked })}
            />
          </label>
        </aside>
      </div>
    </div>
  );
}

interface EditorSectionProps {
  label: string;
  title: string;
  children: ReactNode;
}

function EditorSection({ label, title, children }: EditorSectionProps) {
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
