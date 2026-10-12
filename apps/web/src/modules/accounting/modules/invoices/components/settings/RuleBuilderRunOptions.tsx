"use client";

import type { ReactNode } from "react";
import { Power, RefreshCw, StopCircle } from "lucide-react";

import type { RuleBuilderDraft } from "@/modules/accounting/modules/invoices/components/settings/ruleBuilderModel";
import { RuleActiveSwitch } from "@/modules/accounting/modules/invoices/components/settings/RuleWorkspaceAtoms";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";

interface RuleBuilderRunOptionsProps {
  draft: RuleBuilderDraft;
  disabled?: boolean;
  onDraftChange: (draft: RuleBuilderDraft) => void;
}

export function RuleBuilderRunOptions({
  draft,
  disabled = false,
  onDraftChange,
}: RuleBuilderRunOptionsProps) {
  function patchDraft(patch: Partial<RuleBuilderDraft>) {
    onDraftChange({ ...draft, ...patch });
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <RunToggle
          icon={<StopCircle className="h-4 w-4" />}
          label="Stop processing further rules"
          checked={draft.stopOnMatch}
          disabled={disabled}
          onCheckedChange={(checked) => patchDraft({ stopOnMatch: checked })}
        />
        <RunToggle
          icon={<Power className="h-4 w-4" />}
          label="Rule is active"
          checked={draft.isActive}
          disabled={disabled}
          onCheckedChange={(checked) => patchDraft({ isActive: checked })}
        />
        <RunToggle
          icon={<RefreshCw className="h-4 w-4" />}
          label="Apply to existing invoices"
          checked={draft.applyExisting}
          disabled={disabled}
          onCheckedChange={(checked) => patchDraft({ applyExisting: checked })}
        />
        <div className="rounded-lg border bg-card p-3">
          <label className="text-xs font-medium text-muted-foreground">Priority placement</label>
          <Select
            value={draft.placement}
            disabled={disabled}
            onValueChange={(placement) => patchDraft({ placement: placement === "top" ? "top" : "bottom" })}
          >
            <SelectTrigger className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">Run first</SelectItem>
              <SelectItem value="bottom">Run last</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {draft.applyExisting ? (
        <Select
          value={draft.applyScope}
          disabled={disabled}
          onValueChange={(scope) => patchDraft({ applyScope: scope === "all" ? "all" : scope === "queue" ? "queue" : "pending" })}
        >
          <SelectTrigger className="mt-3 max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending only</SelectItem>
            <SelectItem value="queue">Current queue</SelectItem>
            <SelectItem value="all">All invoices</SelectItem>
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

function RunToggle({
  icon,
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </span>
      <RuleActiveSwitch
        checked={checked}
        disabled={disabled}
        label={label}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
