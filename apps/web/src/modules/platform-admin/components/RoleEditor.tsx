"use client";

import { useState } from "react";

import type {
  AdminRole,
  AdminRoleCreatePayload,
} from "@/modules/platform-admin/types/admin";
import { formatAdminRoleName, normalizeAdminRoleName } from "@/modules/platform-admin/lib/adminRoles";
import { AdminFieldHelp } from "@/modules/platform-admin/components/AdminFieldHelp";
import { Button } from "@/modules/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/modules/shared/components/ui/dialog";
import { Input } from "@/modules/shared/components/ui/input";
import { Textarea } from "@/modules/shared/components/ui/textarea";

interface RoleEditorProps {
  mode: "create" | "edit";
  open: boolean;
  role?: AdminRole | null;
  isPending?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: AdminRoleCreatePayload) => void;
}

interface RoleEditorFormProps {
  mode: "create" | "edit";
  initialName: string;
  initialDescription: string;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (payload: AdminRoleCreatePayload) => void;
}

function normalizeDescription(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function RoleEditorForm({
  mode,
  initialName,
  initialDescription,
  isPending,
  onCancel,
  onSubmit,
}: RoleEditorFormProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    const trimmedName = name.trim();

    if (trimmedName.length === 0) {
      setError("Role name is required.");
      return;
    }

    setError(null);
    onSubmit({
      name: normalizeAdminRoleName(trimmedName),
      description: normalizeDescription(description),
    });
  }

  const heading = mode === "create" ? "Create role" : "Edit role";
  const submitLabel = mode === "create" ? "Create role" : "Save changes";

  return (
    <>
      <DialogHeader>
        <DialogTitle>{heading}</DialogTitle>
        <DialogDescription>
          Keep role names operational and descriptions focused on when the role should be assigned.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <label htmlFor="role-editor-name" className="text-sm font-medium text-foreground">Role name</label>
            <AdminFieldHelp label="Role name" description="The display name shown anywhere this access profile can be assigned." />
          </div>
          <Input
            id="role-editor-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isPending}
            placeholder="Operations Lead"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <label htmlFor="role-editor-description" className="text-sm font-medium text-foreground">Description</label>
            <AdminFieldHelp label="Role description" description="Optional operational context explaining when this role should be assigned." />
          </div>
          <Textarea
            id="role-editor-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={isPending}
            placeholder="Optional context for when this role should be used."
          />
        </div>

        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={isPending}>
          {isPending ? "Saving..." : submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

export function RoleEditor({
  mode,
  open,
  role,
  isPending = false,
  onOpenChange,
  onSubmit,
}: RoleEditorProps) {
  const editorKey = `${open ? "open" : "closed"}:${mode}:${role?.id ?? "new"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={!isPending}>
        <RoleEditorForm
          key={editorKey}
          mode={mode}
          initialName={role ? formatAdminRoleName(role.name) : ""}
          initialDescription={role?.description ?? ""}
          isPending={isPending}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}