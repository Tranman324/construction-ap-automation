"use client";

import { FileQuestion } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";

export interface TabEmptyProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function TabEmpty({
  title = "No documents",
  description = "This invoice doesn't have any attached documents yet.",
  actionLabel,
  onAction,
}: TabEmptyProps) {
  return (
    <div className="flex h-full min-h-48 items-center justify-center p-6 text-center" data-testid="tab-empty">
      <div className="flex max-w-sm flex-col items-center gap-2">
        <FileQuestion aria-hidden="true" className="size-10 text-muted-foreground/55" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
        {actionLabel && onAction ? (
          <Button type="button" size="sm" variant="outline" onClick={onAction}>{actionLabel}</Button>
        ) : null}
      </div>
    </div>
  );
}
