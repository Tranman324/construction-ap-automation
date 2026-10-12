"use client";

import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";
import { Field } from "@/modules/shared/components/patterns/Field";
import { getInvoiceFieldState } from "@/modules/shared/components/patterns/invoiceFieldState";

export interface OtherClassificationFieldProps {
  classifications: readonly ClassificationInfo[];
  value: string;
  disabled?: boolean;
  onChange: (classification: string) => void;
}

export function OtherClassificationField({ classifications, value, disabled, onChange }: OtherClassificationFieldProps) {
  return (
    <Field label="Reclassify as" htmlFor="other-document-classification" optional
      hint="Optional — route this to the right workflow, or keep it as Other."
      invoiceState={getInvoiceFieldState({ value, baseline: "" })}>
      <select id="other-document-classification"
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose a document type…</option>
        {classifications.map((classification) => (
          <option key={classification.name} value={classification.name}>{classification.label}</option>
        ))}
      </select>
    </Field>
  );
}

export interface OtherNoteFieldProps {
  value: string;
  baseline: string;
  onChange: (note: string) => void;
}

export function OtherNoteField({ value, baseline, onChange }: OtherNoteFieldProps) {
  return (
    <Field label="Note" htmlFor="other-document-note" optional
      hint="Optional — context for whoever handles this next."
      invoiceState={getInvoiceFieldState({ value, baseline })}>
      <textarea id="other-document-note"
        className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        value={value} onChange={(event) => onChange(event.target.value)} placeholder="Add a note…" />
    </Field>
  );
}
