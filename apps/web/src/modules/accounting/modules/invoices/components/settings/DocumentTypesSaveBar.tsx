"use client";

import { useEffect } from "react";
import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react";

import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

export type DocumentTypesSaveState = "idle" | "saving" | "saved" | "error";

interface DocumentTypesSaveBarProps {
  dirtyCount: number;
  saveState: DocumentTypesSaveState;
  pending: boolean;
  saveDisabled?: boolean;
  onCancel: () => void;
  onClearState?: () => void;
  onSave: () => void;
}

export function DocumentTypesSaveBar({
  dirtyCount,
  saveState,
  pending,
  saveDisabled = false,
  onCancel,
  onClearState,
  onSave,
}: DocumentTypesSaveBarProps) {
  useEffect(() => {
    if (saveState !== "saved" || !onClearState) return undefined;
    const timer = window.setTimeout(onClearState, 3000);
    return () => window.clearTimeout(timer);
  }, [onClearState, saveState]);

  if (dirtyCount === 0 && saveState === "idle") return null;
  const dirty = dirtyCount > 0;

  return (
    <div className="flex items-center gap-3 border-t px-5 py-3">
      <span
        className={cn(
          "inline-flex items-center gap-2 text-sm font-medium",
          saveState === "error" && "text-destructive",
          saveState === "saved" && "text-emerald-700 dark:text-emerald-300",
        )}
      >
        {saveState === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {saveState === "saved" ? <CheckCircle2 className="h-4 w-4" /> : null}
        {saveState === "error" ? <AlertCircle className="h-4 w-4" /> : null}
        {dirty && saveState !== "saving" ? <span className="h-2 w-2 rounded-full bg-amber-500" /> : null}
        {statusLabel(dirtyCount, saveState)}
      </span>
      <span className="flex-1" />
      <Button type="button" variant="ghost" size="sm" disabled={!dirty || pending} onClick={onCancel}>
        Cancel
      </Button>
      <Button type="button" size="sm" disabled={!dirty || pending || saveDisabled} onClick={onSave}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save Changes
      </Button>
    </div>
  );
}

function statusLabel(dirtyCount: number, saveState: DocumentTypesSaveState): string {
  if (saveState === "saving") return "Saving changes...";
  if (saveState === "saved") return "All changes saved";
  if (saveState === "error") return "Save failed";
  return `${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"}`;
}
