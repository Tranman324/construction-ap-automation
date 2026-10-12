"use client";

import { ShieldCheck, UserX } from "lucide-react";

import { AdminFieldHelp } from "@/modules/platform-admin/components/AdminFieldHelp";
import { formatAdminRoleName } from "@/modules/platform-admin/lib/adminRoles";
import type { AdminRole } from "@/modules/platform-admin/types/admin";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { Switch } from "@/modules/shared/components/ui/switch";

export interface InlineFeedback {
  tone: "success" | "error";
  message: string;
}

interface UserRoleAssignmentSectionProps {
  roles: AdminRole[];
  selectedRoleId: string;
  onRoleChange: (roleId: string) => void;
  requiresEmailConfirmation: boolean;
  approvalConfirmation: string;
  onApprovalConfirmationChange: (value: string) => void;
  roleDisabledReason: string;
  roleSaveDisabled: boolean;
  isSaving: boolean;
  onSave: () => void;
  feedback: InlineFeedback | null;
}

interface UserAccessStatusSectionProps {
  isActive: boolean;
  statusDisabledReason: string;
  isSaving: boolean;
  onDeactivate: () => void;
  onReactivate: () => void;
  feedback: InlineFeedback | null;
}

function InlineFeedbackMessage({ feedback }: { feedback: InlineFeedback | null }) {
  if (!feedback) {
    return null;
  }

  return (
    <p
      className={`text-xs ${feedback.tone === "success" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}
    >
      {feedback.message}
    </p>
  );
}

export function UserRoleAssignmentSection({
  roles,
  selectedRoleId,
  onRoleChange,
  requiresEmailConfirmation,
  approvalConfirmation,
  onApprovalConfirmationChange,
  roleDisabledReason,
  roleSaveDisabled,
  isSaving,
  onSave,
  feedback,
}: UserRoleAssignmentSectionProps) {
  return (
    <section className="space-y-4 rounded-xl border border-border/50 bg-background/70 p-4">
      <div className="space-y-1">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Role assignment
        </h3>
        <p className="text-xs text-muted-foreground">Assign a baseline role before using overrides for exceptions.</p>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <label htmlFor="user-role-assignment" className="text-sm font-medium text-foreground">Role</label>
          <AdminFieldHelp label="Role" description="Sets the user's baseline access before any direct permission overrides are applied." />
        </div>
        <select
          id="user-role-assignment"
          aria-label="Role assignment"
          value={selectedRoleId}
          onChange={(event) => onRoleChange(event.target.value)}
          disabled={!!roleDisabledReason}
          title={roleDisabledReason || undefined}
          className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:bg-muted/45 disabled:text-muted-foreground disabled:opacity-100"
        >
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {formatAdminRoleName(role.name)}
            </option>
          ))}
        </select>
      </div>
      {requiresEmailConfirmation ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <label htmlFor="role-confirmation-input" className="text-sm font-medium text-foreground">
              Type approved to confirm elevated admin access.
            </label>
            <AdminFieldHelp label="Approval confirmation" description="Confirms you intentionally selected a role with administrator-level access." />
          </div>
          <Input
            id="role-confirmation-input"
            data-testid="role-confirmation-input"
            value={approvalConfirmation}
            onChange={(event) => onApprovalConfirmationChange(event.target.value)}
            placeholder="approved"
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button data-testid="role-save-button" size="sm" onClick={onSave} disabled={roleSaveDisabled} title={roleDisabledReason || undefined}>
          {isSaving ? "Saving..." : "Save role"}
        </Button>
        {roleDisabledReason ? <p className="text-xs text-muted-foreground">{roleDisabledReason}</p> : null}
      </div>
      <InlineFeedbackMessage feedback={feedback} />
    </section>
  );
}

export function UserAccessStatusSection({
  isActive,
  statusDisabledReason,
  isSaving,
  onDeactivate,
  onReactivate,
  feedback,
}: UserAccessStatusSectionProps) {
  return (
    <section className="space-y-3 rounded-xl border border-border/50 bg-background/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
            <UserX className="h-4 w-4 text-primary" />
            User access
          </h3>
          <p className="text-xs text-muted-foreground">Deactivation requires confirmation; reactivation can be applied inline.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <AdminFieldHelp label="User active status" description="Shows whether this user can currently sign in; changes are made with the action button below." />
          <Switch checked={isActive} disabled aria-label="User active status" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {isActive ? (
          <Button
            data-testid="deactivate-user-button"
            size="sm"
            variant="outline"
            onClick={onDeactivate}
            disabled={!!statusDisabledReason || isSaving}
            title={statusDisabledReason || undefined}
          >
            Deactivate user
          </Button>
        ) : (
          <Button
            data-testid="reactivate-user-button"
            size="sm"
            variant="outline"
            onClick={onReactivate}
            disabled={!!statusDisabledReason || isSaving}
            title={statusDisabledReason || undefined}
          >
            {isSaving ? "Saving..." : "Reactivate user"}
          </Button>
        )}
        {statusDisabledReason ? <p className="text-xs text-muted-foreground">{statusDisabledReason}</p> : null}
      </div>
      <InlineFeedbackMessage feedback={feedback} />
    </section>
  );
}