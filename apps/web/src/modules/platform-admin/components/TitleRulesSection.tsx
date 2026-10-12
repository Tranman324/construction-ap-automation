"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { AdminInlineNotice } from "@/modules/platform-admin/components/AdminInlineNotice";
import { TitleRuleDeleteDialog } from "@/modules/platform-admin/components/TitleRuleDeleteDialog";
import { TitleRuleEditor } from "@/modules/platform-admin/components/TitleRuleEditor";
import { TitleRulePreviewPanel } from "@/modules/platform-admin/components/TitleRulePreviewPanel";
import { TitleRulesList } from "@/modules/platform-admin/components/TitleRulesList";
import { TitleRulesListSkeleton } from "@/modules/platform-admin/components/TitleRulesListSkeleton";
import {
  useCreateAdminTitleRule,
  useDeleteAdminTitleRule,
  useUpdateAdminTitleRule,
} from "@/modules/platform-admin/hooks/mutations";
import { useAdminRoles, useAdminTitleRules } from "@/modules/platform-admin/hooks/queries";
import type { TitleRule, TitleRuleCreatePayload } from "@/modules/platform-admin/types/admin";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/modules/shared/components/ui/card";
import { isApiError } from "@/modules/shared/lib/api";
import { usePermissions } from "@/modules/shared/hooks/usePermissions";

function getRuleMessage(error: Error, intent: "save" | "delete") {
  if (isApiError(error) && error.status === 409) {
    return "A conflicting title rule already exists. Review the pattern and priority, then try again.";
  }

  if (error.message.trim().length > 0) {
    return error.message;
  }

  return intent === "delete" ? "Failed to delete title rule." : "Failed to save title rule.";
}

export function TitleRulesSection() {
  const rulesQuery = useAdminTitleRules();
  const rolesQuery = useAdminRoles();
  const createRule = useCreateAdminTitleRule();
  const updateRule = useUpdateAdminTitleRule();
  const deleteRule = useDeleteAdminTitleRule();
  const { hasPermission } = usePermissions();
  const canManageTitleRules = hasPermission("platform.manage_title_rules");

  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [selectedRule, setSelectedRule] = useState<TitleRule | null>(null);
  const [rulePendingDelete, setRulePendingDelete] = useState<TitleRule | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; message: string } | null>(null);

  const rules = useMemo(
    () => [...(rulesQuery.data ?? [])].sort((left, right) => right.priority - left.priority),
    [rulesQuery.data],
  );
  const roles = rolesQuery.data ?? [];
  const isMutating = createRule.isPending || updateRule.isPending || deleteRule.isPending;
  const createRuleDisabledReason = !canManageTitleRules
    ? "Requires platform.manage_title_rules"
    : roles.length === 0
      ? "Create a role before adding title rules."
      : "";

  function handleEditorSubmit(payload: TitleRuleCreatePayload) {
    if (editorMode === "edit" && selectedRule) {
      updateRule.mutate(
        { ruleId: selectedRule.id, payload },
        {
          onSuccess: () => {
            setNotice({ tone: "success", message: `Updated ${payload.pattern}.` });
            setEditorMode(null);
            setSelectedRule(null);
          },
          onError: (error) => {
            setNotice({ tone: "error", message: getRuleMessage(error, "save") });
          },
        },
      );
      return;
    }

    createRule.mutate(payload, {
      onSuccess: () => {
        setNotice({ tone: "success", message: `Created ${payload.pattern}.` });
        setEditorMode(null);
      },
      onError: (error) => {
        setNotice({ tone: "error", message: getRuleMessage(error, "save") });
      },
    });
  }

  function handleDeleteConfirm() {
    if (!rulePendingDelete) {
      return;
    }

    deleteRule.mutate(
      { ruleId: rulePendingDelete.id },
      {
        onSuccess: () => {
          setNotice({ tone: "success", message: `Deleted ${rulePendingDelete.pattern}.` });
          setRulePendingDelete(null);
        },
        onError: (error) => {
          setNotice({ tone: "error", message: getRuleMessage(error, "delete") });
          setRulePendingDelete(null);
        },
      },
    );
  }

  return (
    <section data-testid="admin-section-rules" className="space-y-4">
      <Card className="border-border/60 bg-card/90 shadow-sm shadow-primary/5 backdrop-blur-sm">
        <CardHeader className="gap-3 border-b border-border/50 px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <CardTitle className="text-xl font-bold text-foreground">Title matching rules</CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                Priorities resolve from highest to lowest so onboarding defaults stay predictable and reviewable.
              </CardDescription>
            </div>
            <div className="space-y-2 text-right">
              <Button
                onClick={() => setEditorMode("create")}
                disabled={!canManageTitleRules || roles.length === 0 || isMutating}
                title={createRuleDisabledReason || undefined}
              >
                <Plus className="h-4 w-4" />
                Create rule
              </Button>
              {createRuleDisabledReason ? (
                <p className="text-xs text-muted-foreground">{createRuleDisabledReason}</p>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 py-6">
          {notice ? <AdminInlineNotice message={notice.message} tone={notice.tone} /> : null}
          {rulesQuery.error ? <AdminInlineNotice message={rulesQuery.error.message} tone="error" /> : null}

          {rulesQuery.isLoading ? <TitleRulesListSkeleton /> : null}

          {!rulesQuery.isLoading && !rulesQuery.error ? (
            <TitleRulesList
              rules={rules}
              canManageTitleRules={canManageTitleRules}
              isMutating={isMutating}
              onEdit={(rule) => {
                setSelectedRule(rule);
                setEditorMode("edit");
                setNotice(null);
              }}
              onDelete={setRulePendingDelete}
            />
          ) : null}
        </CardContent>
      </Card>

      <TitleRulePreviewPanel />

      <TitleRuleEditor
        mode={editorMode ?? "create"}
        open={editorMode !== null}
        rule={selectedRule}
        roles={roles}
        isPending={createRule.isPending || updateRule.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setEditorMode(null);
            setSelectedRule(null);
          }
        }}
        onSubmit={handleEditorSubmit}
      />

      <TitleRuleDeleteDialog
        open={rulePendingDelete !== null}
        rule={rulePendingDelete}
        isPending={deleteRule.isPending}
        onConfirm={handleDeleteConfirm}
        onOpenChange={(open) => !open && setRulePendingDelete(null)}
      />
    </section>
  );
}