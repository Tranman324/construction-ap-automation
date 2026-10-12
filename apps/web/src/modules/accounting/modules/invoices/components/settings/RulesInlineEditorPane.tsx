"use client";

import { useState } from "react";
import { Save, Trash2 } from "lucide-react";

import type {
  Rule,
  RuleUpdatePayload,
} from "@/modules/accounting/modules/invoices/types/rules";
import { RulesInlineEditorBody } from "@/modules/accounting/modules/invoices/components/settings/RulesInlineEditorBody";
import { RuleActiveSwitch } from "@/modules/accounting/modules/invoices/components/settings/RuleWorkspaceAtoms";
import {
  createRuleDraft,
  toRuleUpdatePayload,
  type RuleDraft,
} from "@/modules/accounting/modules/invoices/components/settings/ruleWorkspaceModel";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";

interface RulesInlineEditorPaneProps {
  rule: Rule;
  isSaving?: boolean;
  isDeleting?: boolean;
  onSave: (rule: Rule, payload: RuleUpdatePayload) => void;
  onDelete: (rule: Rule) => void;
}

export function RulesInlineEditorPane({
  rule,
  isSaving = false,
  isDeleting = false,
  onSave,
  onDelete,
}: RulesInlineEditorPaneProps) {
  const [draft, setDraft] = useState<RuleDraft>(() => createRuleDraft(rule));
  const [confirmDelete, setConfirmDelete] = useState(false);

  function patchDraft(patch: Partial<RuleDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function handleSave() {
    if (!draft.name.trim()) return;
    onSave(rule, toRuleUpdatePayload(draft));
  }

  return (
    <section className="flex min-h-0 flex-col bg-card">
      <header className="border-b p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Input
              aria-label="Rule name"
              value={draft.name}
              onChange={(event) => patchDraft({ name: event.target.value })}
              className="h-9 border-transparent px-1 text-base font-semibold shadow-none focus-visible:border-ring"
            />
            <p className="text-xs text-muted-foreground">
              Priority {rule.order + 1} - created by {rule.createdBy || "unknown"}
            </p>
          </div>
          <RuleActiveSwitch
            checked={draft.isActive}
            disabled={isSaving}
            label={`${rule.name} active in editor`}
            onCheckedChange={(checked) => patchDraft({ isActive: checked })}
          />
        </div>
      </header>

      <RulesInlineEditorBody draft={draft} isSaving={isSaving} setDraft={setDraft} />

      <footer className="flex flex-wrap items-center gap-2 border-t bg-muted/20 p-3">
        {confirmDelete ? (
          <>
            <span className="text-xs font-medium text-destructive">Delete this rule?</span>
            <Button size="sm" variant="destructive" disabled={isDeleting} onClick={() => onDelete(rule)}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" disabled={isDeleting} onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" className="gap-2 text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" className="gap-2" disabled={isSaving || !draft.name.trim()} onClick={handleSave}>
          <Save className="h-4 w-4" />
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
      </footer>
    </section>
  );
}
