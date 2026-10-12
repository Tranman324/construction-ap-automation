"use client";

import { stripFilenameExtension, withOriginalFileExtension } from "./simpleFilingDocumentModel";
import type { Invoice } from "../../types/invoice";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";

export function getFilenameOverride(filename: string, record: Invoice): { filename?: string } {
  const candidate = record.filing?.fileName?.value;
  if (!filename || filename === candidate || filename === stripFilenameExtension(candidate)) return {};
  return { filename: withOriginalFileExtension(filename, record.file) };
}

export function FilingFilenameField({ record, value, onChange, filing, filed }: {
  record: Invoice;
  value: string;
  onChange: (value: string) => void;
  filing: boolean;
  filed: boolean;
}) {
  const suggestedFilename = record.filing?.fileName?.value ?? "";
  const canEditFilename = Boolean(record.filing?.fileName?.permittedActions.includes("edit"));
  const locked = filing || filed || Boolean(record.spFileUrl) || !canEditFilename;
  const id = `filing-filename-${record.id}`;
  return <div className="space-y-1.5 text-xs font-medium text-muted-foreground">
    <span className="flex items-center justify-between gap-2">
      <label htmlFor={id}>File name</label>
      {canEditFilename && value !== suggestedFilename ? <Button type="button" variant="ghost" size="xs"
        disabled={locked} onClick={() => onChange(suggestedFilename)}>Reset</Button> : null}
    </span>
    <Input id={id} value={value} onChange={(event) => onChange(event.target.value)}
      maxLength={128} readOnly={locked} disabled={locked} placeholder="Document name" />
  </div>;
}
