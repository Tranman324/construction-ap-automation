"use client";

import { AlertTriangle, Save } from "lucide-react";

import type { PermissionMatrixFeedback } from "@/modules/platform-admin/components/PermissionMatrix";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

interface PermissionMatrixSaveBarProps {
  isDirty: boolean;
  isSaving: boolean;
  controlsDisabled: boolean;
  disabledReason?: string;
  feedback?: PermissionMatrixFeedback | null;
  onReset: () => void;
  onSave: () => void;
}

export function PermissionMatrixSaveBar({
  isDirty,
  isSaving,
  controlsDisabled,
  disabledReason,
  feedback,
  onReset,
  onSave,
}: PermissionMatrixSaveBarProps) {
  return (
    <div
      data-testid="permission-matrix-save-bar"
      className={cn(
        "sticky bottom-3 z-10 rounded-2xl border px-4 py-4 transition-colors supports-[backdrop-filter]:backdrop-blur-sm sm:px-5",
        isDirty
          ? "border-primary/25 bg-primary/[0.06] shadow-sm shadow-primary/5"
          : "border-border/60 bg-muted/35",
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {isDirty ? <AlertTriangle className="h-4 w-4 text-primary" /> : null}
            {isDirty ? "Unsaved permission changes" : "Permission baseline is current"}
          </div>
          <p className="text-sm text-muted-foreground">
            {isDirty
              ? "Save replaces the full permission list for this role."
              : "Module actions and save controls stay visible for quick edits."}
          </p>
          {feedback ? (
            <p role={feedback.tone === "error" ? "alert" : "status"} className="text-sm text-foreground">
              {feedback.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onReset} disabled={!isDirty || isSaving}>
            Reset all
          </Button>
          <Button onClick={onSave} disabled={!isDirty || controlsDisabled} title={controlsDisabled ? disabledReason : undefined}>
            <Save className="h-4 w-4" />
            {isSaving ? "Saving..." : "Save permissions"}
          </Button>
        </div>
      </div>
    </div>
  );
}