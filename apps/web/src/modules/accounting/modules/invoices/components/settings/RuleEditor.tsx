"use client";

import { useRef, useState } from "react";
import { Plus, Zap } from "lucide-react";
import type { Rule, RuleCriterion, RuleAction, RuleCreateAndApplyResponse } from "@/modules/accounting/modules/invoices/types/rules";
import { useCreateRule, useUpdateRule, useApplyRules, isRuleCreateAndApplyResponse } from "@/modules/accounting/modules/invoices/hooks/useRules";
import { useRuleOptions } from "@/modules/accounting/modules/invoices/hooks/queries";
import { RuleCriterionRow } from "@/modules/accounting/modules/invoices/components/settings/RuleCriterionRow";
import { RuleActionRow } from "@/modules/accounting/modules/invoices/components/settings/RuleActionRow";
import { CLEARABLE_ACTIONS, VALUELESS_ACTIONS } from "@/modules/accounting/modules/invoices/components/settings/ruleActionBehavior";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/modules/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { Checkbox } from "@/modules/shared/components/ui/checkbox";
import { Separator } from "@/modules/shared/components/ui/separator";
import { cn } from "@/modules/shared/lib/utils";

// ─── Default state factories ──────────────────────────────────────────────────

function defaultCriterion(): RuleCriterion {
  return { field: "vendor_name", operator: "contains", values: [""] };
}

function defaultAction(): RuleAction {
  return { type: "hide_from_queue" };
}

function cloneCriterion(criterion: RuleCriterion): RuleCriterion {
  return {
    ...criterion,
    values: [...criterion.values],
  };
}

function cloneAction(action: RuleAction): RuleAction {
  return { ...action };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface RuleEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pass an existing rule to edit it; omit to create a new one. */
  rule?: Rule;
  /** Pre-fill criteria when creating a new rule (e.g. from invoice context). */
  initialCriteria?: RuleCriterion[];
  /** Pre-fill the rule name. */
  initialName?: string;
  onSaved?: () => void;
}

interface RuleEditorState {
  key: string;
  name: string;
  criteria: RuleCriterion[];
  actions: RuleAction[];
  stopOnMatch: boolean;
  retroactive: boolean;
  retroScope: "pending" | "all";
  error: string | null;
  applyResult: string | null;
}

function buildRuleEditorState(
  key: string,
  rule?: Rule,
  initialCriteria?: RuleCriterion[],
  initialName?: string,
): RuleEditorState {
  if (rule) {
    return {
      key,
      name: rule.name,
      criteria: rule.criteria.length > 0
        ? rule.criteria.map(cloneCriterion)
        : [defaultCriterion()],
      actions: rule.actions.length > 0
        ? rule.actions.map(cloneAction)
        : [defaultAction()],
      stopOnMatch: rule.stopOnMatch,
      retroactive: false,
      retroScope: "pending",
      error: null,
      applyResult: null,
    };
  }

  return {
    key,
    name: initialName ?? "",
    criteria: initialCriteria && initialCriteria.length > 0
      ? initialCriteria.map(cloneCriterion)
      : [defaultCriterion()],
    actions: [defaultAction()],
    stopOnMatch: false,
    retroactive: false,
    retroScope: "pending",
    error: null,
    applyResult: null,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────────

export function RuleEditor({ open, onOpenChange, rule, initialCriteria, initialName, onSaved }: RuleEditorProps) {
  const editorKey = open
    ? rule
      ? `edit:${rule.id}:${JSON.stringify({
          name: rule.name,
          criteria: rule.criteria,
          actions: rule.actions,
          stopOnMatch: rule.stopOnMatch,
        })}`
      : `new:${initialName ?? ""}:${JSON.stringify(initialCriteria ?? [])}`
    : "closed";
  const [editorState, setEditorState] = useState<RuleEditorState>(() =>
    buildRuleEditorState(editorKey, rule, initialCriteria, initialName),
  );
  const submissionRef = useRef(false);
  const currentState = editorState.key === editorKey
    ? editorState
    : buildRuleEditorState(editorKey, rule, initialCriteria, initialName);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const applyRulesMutation = useApplyRules();

  // Served rule-builder catalogs. No client fallback: if they fail to load the
  // builder cannot render trustworthy dropdowns, so we block editing instead.
  const { data: ruleOptions, isError: ruleOptionsError, isLoading: ruleOptionsLoading } = useRuleOptions();
  const ruleOptionsUnavailable = ruleOptionsError || (!ruleOptionsLoading && !ruleOptions);

  const isEditing = !!rule;
  const isPending = createRule.isPending || updateRule.isPending || applyRulesMutation.isPending;
  const {
    name,
    criteria,
    actions,
    stopOnMatch,
    retroactive,
    retroScope,
    error,
    applyResult,
  } = currentState;

  function updateState(updater: (state: RuleEditorState) => RuleEditorState) {
    setEditorState((prev) => {
      const base = prev.key === editorKey
        ? prev
        : buildRuleEditorState(editorKey, rule, initialCriteria, initialName);
      return updater(base);
    });
  }

  function setName(value: string) {
    updateState((state) => ({ ...state, name: value }));
  }

  function setCriteria(nextCriteria: RuleCriterion[] | ((prev: RuleCriterion[]) => RuleCriterion[])) {
    updateState((state) => ({
      ...state,
      criteria: typeof nextCriteria === "function"
        ? nextCriteria(state.criteria)
        : nextCriteria,
    }));
  }

  function setActions(nextActions: RuleAction[] | ((prev: RuleAction[]) => RuleAction[])) {
    updateState((state) => ({
      ...state,
      actions: typeof nextActions === "function"
        ? nextActions(state.actions)
        : nextActions,
    }));
  }

  function setStopOnMatch(value: boolean) {
    updateState((state) => ({ ...state, stopOnMatch: value }));
  }

  function setRetroactive(value: boolean) {
    updateState((state) => ({ ...state, retroactive: value }));
  }

  function setRetroScope(value: "pending" | "all") {
    updateState((state) => ({ ...state, retroScope: value }));
  }

  function setError(value: string | null) {
    updateState((state) => ({ ...state, error: value }));
  }

  function setApplyResult(value: string | null) {
    updateState((state) => ({ ...state, applyResult: value }));
  }

  // ── Criterion helpers ────────────────────────────────────────────────────────

  function updateCriterion(i: number, updated: RuleCriterion) {
    setCriteria((prev) => prev.map((c, idx) => (idx === i ? updated : c)));
  }

  function removeCriterion(i: number) {
    setCriteria((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addCriterion() {
    setCriteria((prev) => [...prev, defaultCriterion()]);
  }

  // ── Action helpers ───────────────────────────────────────────────────────────

  function updateAction(i: number, updated: RuleAction) {
    setActions((prev) => prev.map((a, idx) => (idx === i ? updated : a)));
  }

  function removeAction(i: number) {
    setActions((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addAction() {
    setActions((prev) => [...prev, defaultAction()]);
  }

  // ── Validation ───────────────────────────────────────────────────────────────

  function validate(): string | null {
    if (!name.trim()) return "Rule name is required.";
    if (criteria.length === 0) return "At least one criterion is required.";
    if (actions.length === 0) return "At least one action is required.";
    for (const c of criteria) {
      if (c.operator !== "is_empty" && c.operator !== "is_not_empty") {
        if (c.operator === "between") {
          if (!c.values[0]?.trim() || !c.values[1]?.trim()) return "Both values are required for \"is between\".";
        } else {
          if (!c.values.some((v) => v.trim())) return `A value is required for the "${c.field}" criterion.`;
        }
      }
    }
    for (const a of actions) {
      if (a.clear && CLEARABLE_ACTIONS.has(a.type)) continue;
      if (a.clear) return `The "${a.type}" action cannot clear its value.`;
      if (!VALUELESS_ACTIONS.has(a.type) && !a.value?.trim()) return `A value is required for the "${a.type}" action.`;
    }
    return null;
  }

  // ── Save ─────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (submissionRef.current) return;
    submissionRef.current = true;
    try {
      setError(null);
      setApplyResult(null);

      const validationError = validate();
      if (validationError) { setError(validationError); return; }

      const payload = {
        name: name.trim(),
        isActive: true,
        stopOnMatch,
        criteria,
        actions,
      };
      let savedRule: Rule;
      let atomicApplyResult: RuleCreateAndApplyResponse["applied"] | null = null;

      if (isEditing && rule) {
        savedRule = await updateRule.mutateAsync({ id: rule.id, payload });
      } else {
        const created = await createRule.mutateAsync(
          retroactive ? { ...payload, apply: true, scope: retroScope } : payload,
        );
        if (isRuleCreateAndApplyResponse(created)) {
          savedRule = created.rule;
          atomicApplyResult = created.applied;
        } else {
          savedRule = created;
        }
      }

      if (retroactive) {
        const applyResponse = atomicApplyResult ?? (isEditing
          ? await applyRulesMutation.mutateAsync({
            ruleIds: [savedRule.id],
            scope: retroScope,
          })
          : null);
        if (!applyResponse) {
          throw new Error("Rule creation did not return an application result.");
        }
        setApplyResult(
          `Rule applied — ${applyResponse.matchedInvoices} invoice${applyResponse.matchedInvoices !== 1 ? "s" : ""} matched, ${applyResponse.actionsApplied} action${applyResponse.actionsApplied !== 1 ? "s" : ""} applied.`
        );
        // Brief pause so user sees the result before the dialog closes
        await new Promise((r) => setTimeout(r, 1800));
      }

      onSaved?.();
      onOpenChange(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      setError(msg);
    } finally {
      submissionRef.current = false;
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:w-[90vw] md:w-[85vw] lg:max-w-7xl p-0 gap-0 overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[88vh]">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <DialogHeader className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4 border-b shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/15 shrink-0">
              <Zap className="h-4.5 w-4.5 text-primary" />
            </div>
            <DialogTitle className="text-base sm:text-lg font-semibold">
              {isEditing ? "Edit rule" : "Create rule"}
            </DialogTitle>
          </div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Give this rule a descriptive name…"
            className="text-sm h-10"
            disabled={isPending || ruleOptionsUnavailable}
          />
        </DialogHeader>

        {ruleOptionsUnavailable ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <p className="text-sm font-semibold text-destructive">Rule options unavailable — try again</p>
            <p className="text-xs text-muted-foreground">
              The rule builder cannot load its field, operator, and action catalogs right now. Close and reopen this dialog once the connection is restored.
            </p>
          </div>
        ) : (
        <>
        {/* ── Two-panel body ──────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row flex-1 overflow-hidden min-h-0">

          {/* Left — Criteria */}
          <div className="flex-1 flex flex-col px-4 py-4 sm:px-6 sm:py-5 border-b sm:border-b-0 sm:border-r overflow-y-auto min-w-0">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                When invoice matches all of…
              </p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                Every criterion below must be true for this rule to trigger.
              </p>
            </div>

            <div className="space-y-3 flex-1">
              {criteria.map((criterion, i) => (
                <RuleCriterionRow
                  key={i}
                  criterion={criterion}
                  onChange={(updated) => updateCriterion(i, updated)}
                  onRemove={() => removeCriterion(i)}
                  showRemove={criteria.length > 1}
                />
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 w-full border-dashed text-muted-foreground hover:text-foreground hover:border-border/80 gap-2 py-5"
              onClick={addCriterion}
              disabled={isPending}
            >
              <Plus className="h-4 w-4" />
              Add criterion
            </Button>
          </div>

          {/* Right — Actions */}
          <div className="flex-1 flex flex-col px-4 py-4 sm:px-6 sm:py-5 overflow-y-auto min-w-0">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Then do all of…
              </p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                All actions below will run when the criteria match.
              </p>
            </div>

            <div className="space-y-3 flex-1">
              {actions.map((action, i) => (
                <RuleActionRow
                  key={i}
                  action={action}
                  onChange={(updated) => updateAction(i, updated)}
                  onRemove={() => removeAction(i)}
                  showRemove={actions.length > 1}
                />
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 w-full border-dashed text-muted-foreground hover:text-foreground hover:border-border/80 gap-2 py-5"
              onClick={addAction}
              disabled={isPending}
            >
              <Plus className="h-4 w-4" />
              Add action
            </Button>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="shrink-0">
          <Separator />
          <div className="px-4 py-3 sm:px-6 sm:py-4 bg-muted/20 space-y-3">

            {/* Options row */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-x-6 sm:gap-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  id="stopOnMatch"
                  checked={stopOnMatch}
                  onCheckedChange={(v) => setStopOnMatch(!!v)}
                  disabled={isPending}
                />
                <span className="text-xs text-muted-foreground">
                  Stop processing further rules after this match
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  id="retroactive"
                  checked={retroactive}
                  onCheckedChange={(v) => setRetroactive(!!v)}
                  disabled={isPending}
                />
                <span className="text-xs text-muted-foreground">
                  Apply to existing invoices
                </span>
              </label>

              {retroactive && (
                <Select
                  value={retroScope}
                  onValueChange={(v) => setRetroScope(v as "pending" | "all")}
                >
                  <SelectTrigger className="h-7 text-xs w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending only</SelectItem>
                    <SelectItem value="all">All invoices</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Error / apply result feedback */}
            {(error || applyResult) && (
              <p
                className={cn(
                  "text-xs rounded-md px-3 py-2",
                  error
                    ? "bg-destructive/10 text-destructive"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                )}
              >
                {error ?? applyResult}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={isPending}
              >
                {isPending
                  ? applyRulesMutation.isPending
                    ? "Applying…"
                    : "Saving…"
                  : isEditing
                  ? "Save changes"
                  : "Save rule"}
              </Button>
            </div>
          </div>
        </div>
        </>
        )}

      </DialogContent>
    </Dialog>
  );
}
