"use client";

import { AlertTriangle, CheckCircle2, Circle, FileText, Loader2, UploadCloud } from "lucide-react";
import type { ReactNode } from "react";
import { PanelNotice } from "./PanelNotice";

import type { W9Option } from "@/modules/accounting/modules/invoices/components/documents/w9DocumentData";
import { deriveW9Progress, maskW9Phone, maskW9TaxId, maskW9Zip, type W9ProgressState, type W9ProgressStatus, type W9TaxIdType, type W9ValidationResult } from "@/modules/accounting/modules/invoices/components/documents/w9DocumentModel";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { cn } from "@/modules/shared/lib/utils";

export interface W9IdentityFieldsProps {
  vendorName: string;
  vendorCode: string;
  vendorType: string;
  taxClass: string;
  taxIdType: W9TaxIdType;
  taxId: string;
  validation: W9ValidationResult;
  vendorTypes: readonly W9Option[];
  taxClasses: readonly W9Option[];
  onChange: (patch: W9IdentityPatch) => void;
}

export interface W9IdentityPatch {
  vendorName?: string;
  vendorType?: string;
  taxClass?: string;
  taxIdType?: W9TaxIdType;
  taxId?: string;
}

export interface W9ContactFieldsProps {
  contactName: string;
  contactEmail: string;
  phone: string;
  fax: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  states: readonly W9Option[];
  onChange: (patch: W9ContactPatch) => void;
}

export interface W9ContactPatch {
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  fax?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

const selectClassName =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const requiredEmptyClassName =
  "border-amber-300 bg-amber-50/70 text-amber-900 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-200";
const progressTone: Record<W9ProgressStatus, string> = {
  done: "border-emerald-200 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300",
  active: "border-primary/30 bg-primary/10 text-primary",
  todo: "border-border bg-card text-muted-foreground",
  error: "border-red-200 bg-red-50/80 text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300",
};

function FieldLabel({ children, optional }: { children: string; optional?: boolean }) {
  return <span className="text-sm font-medium text-foreground">{children}{!optional && <span className="text-destructive"> *</span>}</span>;
}

function optionSelect(label: string, value: string, options: readonly W9Option[], onChange: (value: string) => void, optional = false, fieldId?: string) {
  return (
    <label className="space-y-1.5">
      <FieldLabel optional={optional}>{label}</FieldLabel>
      <select data-document-field-id={fieldId} className={cn(selectClassName, !optional && !value && requiredEmptyClassName)} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={!optional && !value}>
        <option value="">Select {label.toLowerCase()}...</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function W9IdentityFields(props: W9IdentityFieldsProps) {
  const { validation, onChange } = props;
  const vendorNameMissing = !props.vendorName.trim();
  const taxIdMissing = props.taxId.length === 0;
  return (
    <div className="space-y-3">
      <label className="space-y-1.5">
        <FieldLabel>Vendor name</FieldLabel>
        <Input data-document-field-id="vendor-name" required aria-invalid={vendorNameMissing} className={cn(vendorNameMissing && requiredEmptyClassName, "aria-invalid:border-amber-300 aria-invalid:ring-amber-200/50 dark:aria-invalid:border-amber-800")} maxLength={30} value={props.vendorName} onChange={(event) => onChange({ vendorName: event.target.value })} placeholder="Acadia Drywall Systems" />
        <span className="block text-xs text-muted-foreground">Max 30 characters — the vendor code is generated from this.</span>
      </label>
      {validation.nameOk && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          Vendor code preview <span className="rounded-md bg-muted px-2 py-0.5 font-mono font-semibold text-foreground">{props.vendorCode}</span> · final code assigned by Spectrum.
        </p>
      )}
      {optionSelect("Vendor type", props.vendorType, props.vendorTypes, (vendorType) => onChange({ vendorType }), false, "vendor-type")}
      <p className="-mt-1 text-xs text-muted-foreground">Drives insurance + 1099 requirements.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {optionSelect("Tax classification", props.taxClass, props.taxClasses, (taxClass) => onChange({ taxClass }), false, "tax-class")}
        <div className="space-y-1.5">
          <FieldLabel>Tax ID type</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            {(["ssn", "feid"] as const).map((type) => (
              <Button key={type} type="button" variant="outline" size="sm" className={cn("h-9 justify-start gap-2", props.taxIdType === type && "border-primary bg-primary/5 text-primary ring-1 ring-primary")} aria-pressed={props.taxIdType === type} onClick={() => onChange({ taxIdType: type })}>
                <span className={cn("h-4 w-4 rounded-full border-2", props.taxIdType === type ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--background)]" : "border-muted-foreground/40")} aria-hidden="true" />
                {type.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <label className="space-y-1.5">
        <FieldLabel>Tax ID number</FieldLabel>
        <Input
          data-document-field-id="tax-id"
          className={cn("font-mono", taxIdMissing && requiredEmptyClassName, "aria-invalid:border-amber-300 aria-invalid:ring-amber-200/50 dark:aria-invalid:border-amber-800")}
          inputMode="numeric"
          required
          value={maskW9TaxId(props.taxId, props.taxIdType)}
          onChange={(event) => onChange({ taxId: event.target.value })}
          placeholder={props.taxIdType === "ssn" ? "XXX-XX-XXXX" : "XX-XXXXXXX"}
          aria-invalid={!validation.taxIdOk}
        />
        {props.taxId.length > 0 && !validation.taxIdOk && <span className="block text-xs text-destructive">Enter a complete 9-digit ID.</span>}
        <span className="block text-xs text-muted-foreground">Format {props.taxIdType === "ssn" ? "XXX-XX-XXXX" : "XX-XXXXXXX"}.</span>
      </label>
    </div>
  );
}

export function W9ContactFields(props: W9ContactFieldsProps) {
  const onChange = props.onChange;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5"><FieldLabel optional>Contact name</FieldLabel><Input maxLength={20} value={props.contactName} onChange={(event) => onChange({ contactName: event.target.value })} placeholder="Full name" /></label>
        <label className="space-y-1.5"><FieldLabel optional>Contact email</FieldLabel><Input type="email" value={props.contactEmail} onChange={(event) => onChange({ contactEmail: event.target.value })} placeholder="name@company.example" /></label>
        <label className="space-y-1.5"><FieldLabel optional>Phone</FieldLabel><Input className="font-mono" value={maskW9Phone(props.phone)} onChange={(event) => onChange({ phone: event.target.value })} placeholder="(404) 555-0100" /></label>
        <label className="space-y-1.5"><FieldLabel optional>Fax</FieldLabel><Input className="font-mono" value={maskW9Phone(props.fax)} onChange={(event) => onChange({ fax: event.target.value })} placeholder="(404) 555-0101" /></label>
      </div>
      <label className="space-y-1.5"><FieldLabel optional>Address line 1</FieldLabel><Input maxLength={30} value={props.addressLine1} onChange={(event) => onChange({ addressLine1: event.target.value })} placeholder="Street address" /></label>
      <label className="space-y-1.5"><FieldLabel optional>Address line 2</FieldLabel><Input maxLength={30} value={props.addressLine2} onChange={(event) => onChange({ addressLine2: event.target.value })} placeholder="Suite, unit (optional)" /></label>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_5.5rem_7rem]">
        <label className="space-y-1.5"><FieldLabel optional>City</FieldLabel><Input maxLength={25} value={props.city} onChange={(event) => onChange({ city: event.target.value })} placeholder="City" /></label>
        {optionSelect("State", props.state, props.states, (state) => onChange({ state }), true)}
        <label className="space-y-1.5"><FieldLabel optional>ZIP</FieldLabel><Input className="font-mono" value={maskW9Zip(props.zip)} onChange={(event) => onChange({ zip: event.target.value })} placeholder="30301" /></label>
      </div>
    </div>
  );
}

export function W9DocumentStatus({ fileName }: { fileName: string }) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-center sm:flex-row sm:text-left">
      <UploadCloud className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 sm:flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{fileName}</p>
        <p className="text-xs text-muted-foreground">Attached — drag a replacement PDF to swap</p>
      </div>
      <Badge variant="outline" className="font-mono">PDF</Badge>
    </div>
  );
}

export function W9ProgressPanel({ progress, failureContent }: { progress: W9ProgressState; failureContent?: ReactNode }) {
  const summary = deriveW9Progress(progress);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${summary.percent}%` }} />
        </div>
        <span className="font-mono text-xs font-semibold text-muted-foreground">{summary.percent}%</span>
      </div>
      <div className="space-y-2">
        {summary.lines.map((line) => {
          const Icon = line.status === "done" ? CheckCircle2 : line.status === "active" ? Loader2 : line.status === "error" ? AlertTriangle : Circle;
          const card = (
            <div key={line.id} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", progressTone[line.status])}>
              <Icon className={cn("h-4 w-4", line.status === "active" && "animate-spin")} aria-hidden="true" />
              <span>{line.label}</span>
            </div>
          );
          return line.status === "error" ? (
            <PanelNotice key={line.id} id={`w9-${line.id}-failed`} label="W-9 upload failed">
              {card}{failureContent}
            </PanelNotice>
          ) : card;
        })}
      </div>
    </div>
  );
}

export function W9CollapsedContactSummary({ email, phone }: { email: string; phone: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
      <FileText className="h-4 w-4" aria-hidden="true" />
      <span className="min-w-0 truncate">{email || phone ? [email, maskW9Phone(phone)].filter(Boolean).join(" - ") : "No contact details entered"}</span>
    </div>
  );
}
