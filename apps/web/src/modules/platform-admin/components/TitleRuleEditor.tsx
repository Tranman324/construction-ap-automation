"use client";

import { useMemo, useState } from "react";

import { AdminFieldHelp } from "@/modules/platform-admin/components/AdminFieldHelp";
import type { AdminRole, TitleRule, TitleRuleCreatePayload, TitleRuleMatchType } from "@/modules/platform-admin/types/admin";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/shared/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/modules/shared/components/ui/sheet";
import { Switch } from "@/modules/shared/components/ui/switch";

interface TitleRuleEditorProps {
  mode: "create" | "edit";
  open: boolean;
  rule?: TitleRule | null;
  roles: AdminRole[];
  isPending?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: TitleRuleCreatePayload) => void;
}

interface TitleRuleEditorFormProps {
  mode: "create" | "edit";
  initialPattern: string;
  initialMatchType: TitleRuleMatchType;
  initialRoleId: string;
  initialPriority: string;
  initialIsActive: boolean;
  roles: AdminRole[];
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (payload: TitleRuleCreatePayload) => void;
}

const MATCH_TYPE_OPTIONS: Array<{ value: TitleRuleMatchType; label: string }> = [{ value: "equals", label: "Equals" }, { value: "contains", label: "Contains" }, { value: "starts_with", label: "Starts with" }];

function TitleRuleEditorForm({
  mode,
  initialPattern,
  initialMatchType,
  initialRoleId,
  initialPriority,
  initialIsActive,
  roles,
  isPending,
  onCancel,
  onSubmit,
}: TitleRuleEditorFormProps) {
  const [pattern, setPattern] = useState(initialPattern);
  const [matchType, setMatchType] = useState<TitleRuleMatchType>(initialMatchType);
  const [roleId, setRoleId] = useState(initialRoleId);
  const [priority, setPriority] = useState(initialPriority);
  const [isActive, setIsActive] = useState(initialIsActive);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    const trimmedPattern = pattern.trim();
    const parsedPriority = Number.parseInt(priority, 10);

    if (trimmedPattern.length === 0) { setError("Pattern is required."); return; }
    if (roleId.trim().length === 0) { setError("Select a role before saving a title rule."); return; }
    if (!Number.isFinite(parsedPriority)) { setError("Priority must be a whole number."); return; }

    setError(null);
    onSubmit({
      pattern: trimmedPattern,
      match_type: matchType,
      role_id: roleId,
      priority: parsedPriority,
      is_active: isActive,
    });
  }

  return (
    <>
      <SheetHeader className="border-b border-border/50 pb-4">
        <SheetTitle>{mode === "create" ? "Create title rule" : "Edit title rule"}</SheetTitle>
        <SheetDescription>Match incoming job titles to the correct role using a clear pattern, priority, and activation state.</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <label htmlFor="title-rule-pattern" className="text-sm font-medium text-foreground">Pattern</label>
            <AdminFieldHelp label="Pattern" description="The job-title text the rule compares against during automatic role matching." />
          </div>
          <Input
            id="title-rule-pattern"
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            disabled={isPending}
            placeholder="Project Executive"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-foreground">Match type</span>
              <AdminFieldHelp label="Match type" description="Controls whether the job title must equal, contain, or start with the pattern." />
            </div>
            <Select value={matchType} onValueChange={(value) => setMatchType(value as TitleRuleMatchType)}>
              <SelectTrigger className="w-full" disabled={isPending}>
                <SelectValue placeholder="Select a match type" />
              </SelectTrigger>
              <SelectContent>
                {MATCH_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-foreground">Role</span>
              <AdminFieldHelp label="Title rule role" description="The role assigned when this title rule is the highest-priority active match." />
            </div>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger className="w-full" disabled={isPending || roles.length === 0}>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((roleOption) => (
                  <SelectItem key={roleOption.id} value={roleOption.id}>
                    {roleOption.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <label htmlFor="title-rule-priority" className="text-sm font-medium text-foreground">Priority</label>
              <AdminFieldHelp label="Priority" description="Higher numbers win when multiple active rules match the same job title." />
            </div>
            <Input
              id="title-rule-priority"
              type="number"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/50 bg-background/70 px-4 py-3 text-sm text-foreground">
            <span className="space-y-1">
              <span className="flex items-center gap-1.5 font-medium">
                Active rule
                <AdminFieldHelp label="Active rule" description="Only active rules participate in automatic role matching and preview results." />
              </span>
              <span className="block text-xs text-muted-foreground">Only active rules are considered during title matching.</span>
            </span>
            <Switch checked={isActive} onCheckedChange={setIsActive} disabled={isPending} aria-label="Active rule" />
          </div>
        </div>

        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        ) : null}
      </div>

      <SheetFooter className="border-t border-border/50 p-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={isPending}>
          {isPending ? "Saving..." : mode === "create" ? "Create rule" : "Save changes"}
        </Button>
      </SheetFooter>
    </>
  );
}

export function TitleRuleEditor({
  mode,
  open,
  rule,
  roles,
  isPending = false,
  onOpenChange,
  onSubmit,
}: TitleRuleEditorProps) {
  const defaultRoleId = useMemo(() => roles[0]?.id ?? "", [roles]);
  const editorKey = `${open ? "open" : "closed"}:${mode}:${rule?.id ?? "new"}:${defaultRoleId}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <TitleRuleEditorForm
          key={editorKey}
          mode={mode}
          initialPattern={rule?.pattern ?? ""}
          initialMatchType={rule?.match_type ?? "contains"}
          initialRoleId={rule?.role_id ?? defaultRoleId}
          initialPriority={String(rule?.priority ?? 100)}
          initialIsActive={rule?.is_active ?? true}
          roles={roles}
          isPending={isPending}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </SheetContent>
    </Sheet>
  );
}
