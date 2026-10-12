"use client";

import { ExternalLink, FileText } from "lucide-react";

import type { ClassificationType } from "@/modules/accounting/modules/invoices/types/invoice";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

export interface DocumentHeaderFileRecord {
  id: string;
  classification: ClassificationType;
  file: string | null;
}

export interface DocumentHeaderFileLinkProps {
  record: DocumentHeaderFileRecord;
  className?: string;
}

export function DocumentHeaderFileLink({
  record,
  className,
}: DocumentHeaderFileLinkProps) {
  const fileName = record.file?.trim() || "No file";
  const canOpen = record.classification !== "no-attachment" && Boolean(record.file);
  const fileHref = `/api/backend/invoices/${record.id}/file`;

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span
        className="min-w-0 truncate font-mono text-xs font-semibold text-foreground"
        title={fileName}
      >
        {fileName}
      </span>
      {canOpen ? (
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
        >
          <a
            href={fileHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${fileName} in a new tab`}
            title="Open file in another tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 rounded-md text-muted-foreground"
          aria-label="Open file in a new tab"
          title="Open file in another tab"
          disabled
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      )}
    </span>
  );
}
