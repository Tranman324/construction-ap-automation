"use client";

import { useState } from "react";

import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { Field } from "@/modules/shared/components/patterns/Field";
import { getInvoiceFieldState } from "@/modules/shared/components/patterns/invoiceFieldState";
import type { ResolvedFilingValue } from "@/modules/accounting/modules/invoices/types/invoice";

interface WarrantyClassificationEditorProps {
  providerKind: ResolvedFilingValue<string> | null | undefined;
  warrantyType: ResolvedFilingValue<string> | null | undefined;
  canEdit: boolean;
  pending: boolean;
  error: string | null;
  onSave: (payload: { providerKind?: string | null; warrantyType?: string | null }) => void | Promise<void>;
}

export function WarrantyClassificationEditor({
  providerKind,
  warrantyType,
  canEdit,
  pending,
  error,
  onSave,
}: WarrantyClassificationEditorProps) {
  const canonicalKey = `${providerKind?.value ?? ""}\u0000${warrantyType?.value ?? ""}`;
  const [draft, setDraft] = useState({
    key: canonicalKey,
    provider: providerKind?.value ?? "",
    type: warrantyType?.value ?? "",
  });
  const values = draft.key === canonicalKey
    ? draft
    : { key: canonicalKey, provider: providerKind?.value ?? "", type: warrantyType?.value ?? "" };
  const providerDirty = values.provider.trim() !== (providerKind?.value ?? "").trim();
  const typeDirty = values.type.trim() !== (warrantyType?.value ?? "").trim();
  const hasChanges = providerDirty || typeDirty;

  const save = async () => {
    const canonicalProvider = (providerKind?.value ?? "").trim();
    const canonicalType = (warrantyType?.value ?? "").trim();
    const draftProvider = values.provider.trim();
    const draftType = values.type.trim();
    const payload: { providerKind?: string | null; warrantyType?: string | null } = {};
    if (draftProvider !== canonicalProvider) payload.providerKind = draftProvider || null;
    if (draftType !== canonicalType) payload.warrantyType = draftType || null;
    if (Object.keys(payload).length === 0) return;
    await onSave(payload);
  };

  const clearProvider = async () => {
    try {
      await onSave({ providerKind: null });
    } catch {
      // Keep the canonical draft visible; the parent surfaces the retained mutation error.
    }
  };

  const clearWarrantyType = async () => {
    try {
      await onSave({ warrantyType: null });
    } catch {
      // Keep the canonical draft visible; the parent surfaces the retained mutation error.
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Provider kind" htmlFor="warranty-provider-kind" required
          hint={!canEdit ? "Managed by the server; you do not have permission to edit it." : undefined}
          invoiceState={getInvoiceFieldState({
            value: values.provider,
            baseline: providerKind?.value ?? "",
            manuallyEdited: providerKind?.provenance === "manual" || providerDirty,
            ownedElsewhere: !canEdit,
            required: true,
          })}>
          <Input id="warranty-provider-kind" aria-label="Provider kind" value={values.provider} disabled={!canEdit || pending}
            onChange={(event) => setDraft({ key: canonicalKey, provider: event.target.value, type: values.type })} />
        </Field>
        <Field label="Warranty type" htmlFor="warranty-type" required
          hint={!canEdit ? "Managed by the server; you do not have permission to edit it." : undefined}
          invoiceState={getInvoiceFieldState({
            value: values.type,
            baseline: warrantyType?.value ?? "",
            manuallyEdited: warrantyType?.provenance === "manual" || typeDirty,
            ownedElsewhere: !canEdit,
            required: true,
          })}>
          <Input id="warranty-type" aria-label="Warranty type" value={values.type} disabled={!canEdit || pending}
            onChange={(event) => setDraft({ key: canonicalKey, provider: values.provider, type: event.target.value })} />
        </Field>
      </div>
      {canEdit && (providerKind?.provenance === "manual" || warrantyType?.provenance === "manual") ? (
        <div className="flex flex-wrap gap-3">
          {providerKind?.provenance === "manual" ? <Button type="button" variant="link" size="sm" className="h-auto px-0" disabled={pending} onClick={() => void clearProvider()}>Clear manual provider kind</Button> : null}
          {warrantyType?.provenance === "manual" ? <Button type="button" variant="link" size="sm" className="h-auto px-0" disabled={pending} onClick={() => void clearWarrantyType()}>Clear manual warranty type</Button> : null}
        </div>
      ) : null}
      {canEdit && hasChanges ? <Button type="button" size="sm" disabled={pending} onClick={() => void save()}>{pending ? "Saving classification…" : "Save classification"}</Button> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
