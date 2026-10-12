"use client";

import { useMemo, useState } from "react";
import { PlayCircle, Plus } from "lucide-react";
import { toast } from "sonner";

import type {
  Rule,
  RuleApplyResponse,
  RuleUpdatePayload,
} from "@/modules/accounting/modules/invoices/types/rules";
import { useInvoices } from "@/modules/accounting/modules/invoices/hooks/queries";
import {
  useApplyRules,
  useDeleteRule,
  useReorderRules,
  useRules,
  useUpdateRule,
} from "@/modules/accounting/modules/invoices/hooks/useRules";
import { RuleBuilderModal } from "@/modules/accounting/modules/invoices/components/settings/RuleBuilderModal";
import { RuleStatStrip } from "@/modules/accounting/modules/invoices/components/settings/RuleStatStrip";
import { RulesInlineEditorPane } from "@/modules/accounting/modules/invoices/components/settings/RulesInlineEditorPane";
import { RulesWorkspaceRail } from "@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceRail";
import {
  EmptyWorkspace,
  ErrorWorkspace,
  LoadingWorkspace,
} from "@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceStates";
import {
  buildRuleWorkspaceStats,
  moveRuleIds,
  sortRulesByOrder,
  type RuleMoveDirection,
} from "@/modules/accounting/modules/invoices/components/settings/ruleWorkspaceModel";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

interface RulesWorkspaceSurfaceProps {
  active?: boolean;
  className?: string;
}

export function RulesWorkspaceSurface({ active = true, className }: RulesWorkspaceSurfaceProps) {
  const { data, isLoading, isError, refetch } = useRules();
  const { data: previewData } = useInvoices({ limit: 100, filed: false }, { enabled: active });
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const reorderRules = useReorderRules();
  const applyRules = useApplyRules();
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  const rules = useMemo(() => sortRulesByOrder(data?.rules ?? []), [data?.rules]);
  const selectedRule = rules.find((rule) => rule.id === selectedRuleId) ?? rules[0] ?? null;
  const stats = useMemo(() => buildRuleWorkspaceStats(rules), [rules]);
  const isMutating = updateRule.isPending || deleteRule.isPending || reorderRules.isPending;

  function handleToggleRule(rule: Rule, checked: boolean) {
    updateRule.mutate({ id: rule.id, payload: { isActive: checked } });
  }

  function handleMoveRule(ruleId: string, direction: RuleMoveDirection) {
    const ids = moveRuleIds(rules, ruleId, direction);
    if (ids.length > 0) reorderRules.mutate({ ids });
  }

  function handleSave(rule: Rule, payload: RuleUpdatePayload) {
    updateRule.mutate(
      { id: rule.id, payload },
      { onSuccess: () => toast.success("Rule saved", { description: rule.name }) },
    );
  }

  function handleDelete(rule: Rule) {
    deleteRule.mutate(
      { id: rule.id },
      {
        onSuccess: () => {
          toast.success("Rule deleted", { description: rule.name });
          setSelectedRuleId((current) => (current === rule.id ? null : current));
        },
      },
    );
  }

  function handleApplyPending() {
    setApplyMessage(null);
    applyRules.mutate(
      { scope: "pending" },
      {
        onSuccess: (result: RuleApplyResponse) => {
          const message = `${result.matchedInvoices} matched, ${result.actionsApplied} actions applied`;
          setApplyMessage(message);
          toast.success("Rules applied", { description: message });
        },
        onError: (error: Error) => {
          setApplyMessage(error.message);
          toast.error("Failed to apply rules", { description: error.message });
        },
      },
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="border-b p-4">
        <RuleStatStrip stats={stats} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
        {isLoading ? (
          <LoadingWorkspace />
        ) : isError ? (
          <ErrorWorkspace onRetry={() => { void refetch(); }} />
        ) : rules.length === 0 ? (
          <EmptyWorkspace onCreate={() => setCreateOpen(true)} />
        ) : (
          <>
            <RulesWorkspaceRail
              rules={rules}
              selectedRuleId={selectedRule?.id ?? null}
              searchTerm={searchTerm}
              isMutating={isMutating}
              onSearchTermChange={setSearchTerm}
              onSelectRule={setSelectedRuleId}
              onToggleRule={handleToggleRule}
              onMoveRule={handleMoveRule}
              onDeleteRule={handleDelete}
              onCreateRule={() => setCreateOpen(true)}
            />
            {selectedRule && (
              <RulesInlineEditorPane
                key={selectedRule.id}
                rule={selectedRule}
                isSaving={updateRule.isPending}
                isDeleting={deleteRule.isPending}
                onSave={handleSave}
                onDelete={handleDelete}
              />
            )}
          </>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t bg-muted/20 p-3">
        <span className="text-xs text-muted-foreground">
          {applyMessage ?? `${stats.total} rules - ${stats.active} active`}
        </span>
        <span className="flex-1" />
        <Button variant="outline" size="sm" className="gap-2" onClick={handleApplyPending} disabled={applyRules.isPending || rules.length === 0}>
          <PlayCircle className="h-4 w-4" />
          {applyRules.isPending ? "Applying..." : "Apply to pending"}
        </Button>
        <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New rule
        </Button>
      </footer>

      <RuleBuilderModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        existingRules={rules}
        previewInvoices={previewData?.invoices ?? []}
        onBack={() => setCreateOpen(false)}
        onSaved={() => setApplyMessage(null)}
      />
    </div>
  );
}
