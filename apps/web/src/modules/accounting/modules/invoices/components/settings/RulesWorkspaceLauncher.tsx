"use client";

import { ListChecks } from "lucide-react";
import { useState } from "react";

import { useRules } from "@/modules/accounting/modules/invoices/hooks/useRules";
import { RuleStatStrip } from "@/modules/accounting/modules/invoices/components/settings/RuleStatStrip";
import { buildRuleWorkspaceStats } from "@/modules/accounting/modules/invoices/components/settings/ruleWorkspaceModel";
import { RulesWorkspaceModal } from "@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceModal";
import { Button } from "@/modules/shared/components/ui/button";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";

export function RulesWorkspaceLauncher() {
  const { data, isLoading } = useRules();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const rules = data?.rules ?? [];
  const stats = buildRuleWorkspaceStats(rules);

  return (
    <>
      <div className="flex-1 overflow-y-auto p-5">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ListChecks className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">Auto-coding rules</h3>
                  <p className="text-xs text-muted-foreground">
                    Manage rule priority, criteria, actions, and active state in the workspace.
                  </p>
                </div>
              </div>
            </div>
            <Button size="sm" className="shrink-0" onClick={() => setWorkspaceOpen(true)}>
              Open workspace
            </Button>
          </div>

          <div className="mt-4">
            {isLoading ? <Skeleton className="h-20 rounded-lg" /> : <RuleStatStrip stats={stats} />}
          </div>
        </div>
      </div>

      <RulesWorkspaceModal open={workspaceOpen} onOpenChange={setWorkspaceOpen} />
    </>
  );
}
