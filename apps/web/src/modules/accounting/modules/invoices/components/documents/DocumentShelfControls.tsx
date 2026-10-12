"use client";

import { cn } from "@/modules/shared/lib/utils";

export const DOCUMENT_STATUSES = ["all", "pending", "reviewed", "discarded"] as const;
export type DocumentShelfStatus = (typeof DOCUMENT_STATUSES)[number];

interface DocumentShelfControlsProps {
  documentStatus: DocumentShelfStatus;
  onParamChange: (key: string, value: string | undefined) => void;
}

export function DocumentShelfControls({
  documentStatus,
  onParamChange,
}: DocumentShelfControlsProps) {
  return (
    <div className="border-b px-4 py-3">
      <div className="flex gap-0.5" aria-label="Document status">
        {DOCUMENT_STATUSES.map((status) => (
          <button
            type="button"
            key={status}
            onClick={() => onParamChange("docStatus", status === "all" ? undefined : status)}
            className={cn(
              "rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium capitalize transition-colors",
              documentStatus === status
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
