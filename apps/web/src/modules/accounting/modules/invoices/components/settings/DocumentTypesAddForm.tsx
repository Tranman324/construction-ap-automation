"use client";

import { type ReactNode, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

import {
  type AddTypeDraft,
  validateAddType,
} from "@/modules/accounting/modules/invoices/components/settings/documentTypesModel";
import type {
  ClassificationAssociation,
  ClassificationInfo,
} from "@/modules/accounting/modules/invoices/types/api";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";

interface DocumentTypesAddFormProps {
  associations: readonly ClassificationAssociation[];
  existingRows: readonly ClassificationInfo[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (draft: AddTypeDraft) => void;
}

const EMPTY_DRAFT: AddTypeDraft = {
  name: "",
  label: "",
  opensAs: "",
};

export function DocumentTypesAddForm({
  associations,
  existingRows,
  pending,
  onCancel,
  onSubmit,
}: DocumentTypesAddFormProps) {
  const [draft, setDraft] = useState<AddTypeDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<ReturnType<typeof validateAddType>["errors"]>({});
  const selectedAssociation = associations.find((association) => association.key === draft.opensAs);

  function submit() {
    const validation = validateAddType(draft, existingRows);
    setErrors(validation.errors);
    if (!validation.valid) return;
    onSubmit({
      name: draft.name.trim(),
      label: draft.label.trim(),
      opensAs: draft.opensAs,
    });
  }

  return (
    <div className="mx-5 mt-4 rounded-lg border bg-muted/25 p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(180px,0.9fr)]">
        <Field label="Name" error={errors.name}>
          <Input
            aria-label="Document type name"
            placeholder="subcontractor-agreement"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </Field>
        <Field label="Label" error={errors.label}>
          <Input
            aria-label="Document type label"
            placeholder="Subcontractor Agreement"
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
        </Field>
        <Field label="Opens As" error={errors.opensAs}>
          <Select value={draft.opensAs} onValueChange={(opensAs) => setDraft({ ...draft, opensAs })}>
            <SelectTrigger aria-label="New type opens as" className="w-full">
              <SelectValue placeholder="Choose destination...">
                {selectedAssociation?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {associations.map((association) => (
                <SelectItem key={association.key} value={association.key}>
                  <span className="flex flex-col items-start">
                    <span className="font-medium">{association.label}</span>
                    <span className="text-xs text-muted-foreground">{association.description}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
          <X className="h-4 w-4" />
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={pending} onClick={submit}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create Type
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
      {error ? <span className="block text-destructive">{error}</span> : null}
    </label>
  );
}
