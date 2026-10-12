"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ListChecks } from "lucide-react";
import { toast } from "sonner";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { Rule, RuleCreateAndApplyResponse } from "@/modules/accounting/modules/invoices/types/rules";
import { useCreateRule, isRuleCreateAndApplyResponse } from "@/modules/accounting/modules/invoices/hooks/useRules";
import { InvoiceRuleContextPanel } from "@/modules/accounting/modules/invoices/components/settings/InvoiceRuleContextPanel";
import { RuleBuilderBlocks } from "@/modules/accounting/modules/invoices/components/settings/RuleBuilderBlocks";
import {
  createBlankRuleBuilderDraft,
  createInvoiceRuleBuilderDraft,
  toRuleCreatePayload,
  validateRuleBuilderDraft,
  type RuleBuilderDraft,
} from "@/modules/accounting/modules/invoices/components/settings/ruleBuilderModel";
import { buildRulePreview } from "@/modules/accounting/modules/invoices/components/settings/rulePreviewModel";
import { findOverlappingRules } from "@/modules/accounting/modules/invoices/components/settings/ruleIntelligence";
import { ruleLabelMapsFromOptions } from "@/modules/accounting/modules/invoices/components/settings/ruleLabels";
import { useRuleOptions } from "@/modules/accounting/modules/invoices/hooks/queries";
import { RuleOverlapWarning } from "@/modules/accounting/modules/invoices/components/settings/RuleOverlapWarning";
import { RulePreviewPane } from "@/modules/accounting/modules/invoices/components/settings/RulePreviewPane";
import { Button } from "@/modules/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/modules/shared/components/ui/dialog";
import { cn } from "@/modules/shared/lib/utils";

interface RuleBuilderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingRules: Rule[];
  previewInvoices: Invoice[];
  sourceInvoice?: Invoice;
  onBack?: () => void;
  onSaved?: (result: Rule | RuleCreateAndApplyResponse) => void;
}

interface DraftState {
  key: string; draft: RuleBuilderDraft; errors: string[];
}

export function RuleBuilderModal({
  open,
  onOpenChange,
  existingRules,
  previewInvoices,
  sourceInvoice,
  onBack,
  onSaved,
}: RuleBuilderModalProps) {
  const createRule = useCreateRule();
  const { data: ruleOptions } = useRuleOptions();
  const labels = useMemo(() => ruleLabelMapsFromOptions(ruleOptions), [ruleOptions]);
  const submissionRef = useRef(false);
  const draftKey = sourceInvoice
    ? `invoice:${sourceInvoice.id}`
    : `new:${existingRules.map((rule) => `${rule.id}:${rule.order}`).join("|")}`;
  const initialDraft = useMemo(
    () => sourceInvoice ? createInvoiceRuleBuilderDraft(sourceInvoice) : createBlankRuleBuilderDraft(existingRules),
    [existingRules, sourceInvoice],
  );
  const [state, setState] = useState<DraftState>(() => ({
    key: draftKey,
    draft: initialDraft,
    errors: [],
  }));
  const draft = state.key === draftKey ? state.draft : initialDraft;
  const errors = state.key === draftKey ? state.errors : [];
  const isPending = createRule.isPending;
  const formDisabled = isPending;

  const invoicesForPreview = useMemo(
    () => uniqueInvoices(sourceInvoice ? [sourceInvoice, ...previewInvoices] : previewInvoices),
    [previewInvoices, sourceInvoice],
  );
  const preview = useMemo(
    () => buildRulePreview(draft, invoicesForPreview),
    [draft, invoicesForPreview],
  );
  const overlaps = useMemo(
    () => sourceInvoice
      ? findOverlappingRules(sourceInvoice, existingRules, labels)
      : [],
    [existingRules, labels, sourceInvoice],
  );
  const isInvoiceMode = !!sourceInvoice;

  function setDraft(nextDraft: RuleBuilderDraft) {
    setState({ key: draftKey, draft: nextDraft, errors: [] });
  }

  function resetDraft() {
    setState({ key: draftKey, draft: initialDraft, errors: [] });
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetDraft();
    onOpenChange(nextOpen);
  }

  function handleCancel() {
    resetDraft();
    if (onBack) {
      onBack();
      return;
    }
    onOpenChange(false);
  }

  async function handleCreate() {
    if (submissionRef.current) return;
    submissionRef.current = true;
    let savedResult: Rule | RuleCreateAndApplyResponse | null = null;
    try {
      const validation = validateRuleBuilderDraft(draft, labels);
      if (!validation.isValid) {
        setState({ key: draftKey, draft, errors: validation.errors });
        toast.error("Rule needs more detail", { description: validation.errors[0] });
        return;
      }

      const wantsApply = Boolean(sourceInvoice || draft.applyExisting);
      // ONE atomic request: with `apply: true` the backend creates AND applies in
      // a single transaction (a failure after the INSERT rolls the rule back — no
      // orphaned rule). No separate apply call, so no create-then-apply retry state.
      const payload = {
        ...toRuleCreatePayload(draft, existingRules),
        ...(wantsApply
          ? {
              apply: true as const,
              scope: draft.applyScope,
              ...(sourceInvoice
                ? {
                    documentIds: [sourceInvoice.id],
                    includeScope: draft.applyExisting,
                    sourceDocumentId: sourceInvoice.id,
                  }
                : {}),
            }
          : {}),
      };

      try {
        const result = await createRule.mutateAsync(payload);
        savedResult = result;
        if (wantsApply && isRuleCreateAndApplyResponse(result)) {
          toast.success("Rule created & applied", {
            description: `${result.applied.matchedInvoices} matched, ${result.applied.actionsApplied} actions applied.`,
          });
        } else {
          toast.success("Rule created", { description: draft.name.trim() });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Something went wrong while creating the rule.";
        setState({ key: draftKey, draft, errors: [message] });
        toast.error(wantsApply ? "Failed to create and apply rule" : "Failed to create rule", { description: message });
        return;
      }

      resetDraft();
      if (savedResult) onSaved?.(savedResult);
      onOpenChange(false);
    } finally {
      submissionRef.current = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[min(820px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b p-5">
          <div className="flex items-start gap-3 pr-8">
            {onBack ? (
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={handleCancel} aria-label="Back to rules">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ListChecks className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>{isInvoiceMode ? "Create rule from invoice" : "New rule"}</DialogTitle>
              <DialogDescription>
                {isInvoiceMode ? "Seeded from this invoice. Refine conditions before creating it." : "Build a rule and preview matching invoices as you go."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <RuleOverlapWarning overlaps={overlaps} />

        <div className={cn("grid min-h-0 flex-1 gap-4 overflow-hidden p-4", isInvoiceMode ? "lg:grid-cols-[310px_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_330px]")}>
          {sourceInvoice ? (
            <InvoiceRuleContextPanel
              invoice={sourceInvoice}
              draft={draft}
              disabled={formDisabled}
              onDraftChange={setDraft}
            />
          ) : null}
          <div className="min-h-0 overflow-y-auto rounded-lg border bg-card p-4">
            <RuleBuilderBlocks draft={draft} disabled={formDisabled} onDraftChange={setDraft} />
            {errors.length > 0 ? (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {errors[0]}
              </div>
            ) : null}
          </div>
          {!sourceInvoice ? <RulePreviewPane preview={preview} applyExisting={draft.applyExisting} /> : null}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t bg-muted/20 p-3">
          <span className="text-xs text-muted-foreground">
            {draft.applyExisting
              ? `${preview.matchCount} existing invoices in preview`
              : sourceInvoice
                ? "Applies to this document and future documents"
                : "Applies to new invoices only"}
          </span>
          <span className="flex-1" />
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" className="gap-2" disabled={isPending} onClick={() => void handleCreate()}>
            <Check className="h-4 w-4" />
            {isPending ? "Creating..." : "Create rule"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function uniqueInvoices(invoices: Invoice[]): Invoice[] {
  const seen = new Set<string>();
  return invoices.filter((invoice) => {
    if (seen.has(invoice.id)) return false;
    seen.add(invoice.id);
    return true;
  });
}
