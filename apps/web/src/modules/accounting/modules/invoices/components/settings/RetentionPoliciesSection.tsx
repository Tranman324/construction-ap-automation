"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Lock, Pencil, Plus, Save, Trash2, X } from "lucide-react";

import { useClassifications, useRetentionRules, useRuleOptions } from "@/modules/accounting/modules/invoices/hooks/queries";
import { useCreateRetentionRule, useDeleteRetentionRule, useUpdateRetentionRule } from "@/modules/accounting/modules/invoices/hooks/mutations";
import type { RetentionRule } from "@/modules/accounting/modules/invoices/types/api";
import { RetentionClassificationBadge, RetentionStatusBadge } from "@/modules/accounting/modules/invoices/components/settings/RetentionBadges";
import {
  retentionStatusOptions,
  clampDays,
  formatRetentionTimestamp,
  hasDuplicateRetentionRule,
  isWildcardClassification,
  sortRetentionRules,
  type RetentionDraft,
  type SelectOption,
} from "@/modules/accounting/modules/invoices/components/settings/retentionPolicyModel";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { Button } from "@/modules/shared/components/ui/button";
import { Checkbox } from "@/modules/shared/components/ui/checkbox";
import { Input } from "@/modules/shared/components/ui/input";
import { Skeleton } from "@/modules/shared/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/modules/shared/components/ui/table";
import { cn } from "@/modules/shared/lib/utils";

const DEFAULT_CREATE_DRAFT: RetentionDraft = {
  classification: "*",
  status: "submitted",
  retentionDays: 30,
  deletePdf: true,
  deleteBox: true,
};

export function RetentionPoliciesSection() {
  const { data: rules, isLoading } = useRetentionRules();
  const { classifications } = useClassifications();
  const { data: ruleOptions, isError: ruleOptionsError, isLoading: ruleOptionsLoading } = useRuleOptions();
  const statusOptions = useMemo(() => retentionStatusOptions(ruleOptions), [ruleOptions]);
  const statusLabels = useMemo(() => Object.fromEntries(statusOptions.map((option) => [option.value, option.label])), [statusOptions]);
  const classificationLabels = useMemo(() => {
    const record: Record<string, string> = {};
    for (const classification of classifications) record[classification.name] = classification.label;
    return record;
  }, [classifications]);
  const classificationOptions = useMemo<SelectOption[]>(
    () => [
      { value: "*", label: "All Types" },
      ...classifications
        .filter((classification) => classification.status === "active")
        .map((classification) => ({ value: classification.name, label: classification.label })),
    ],
    [classifications],
  );
  const createRule = useCreateRetentionRule();
  const updateRule = useUpdateRetentionRule();
  const deleteRule = useDeleteRetentionRule();
  const [adding, setAdding] = useState(false);
  const [createDraft, setCreateDraft] = useState<RetentionDraft>(DEFAULT_CREATE_DRAFT);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Omit<RetentionDraft, "classification" | "status"> | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const sortedRules = useMemo(() => sortRetentionRules(rules ?? [], statusOptions), [rules, statusOptions]);

  function resetCreateForm() {
    setAdding(false);
    setCreateDraft(DEFAULT_CREATE_DRAFT);
    setCreateError(null);
  }

  function startEdit(rule: RetentionRule) {
    setEditingId(rule.id);
    setEditDraft({ retentionDays: clampDays(rule.retentionDays), deletePdf: rule.deletePdf, deleteBox: rule.deleteBox });
    setEditError(null);
    setAdding(false);
  }

  function submitCreate() {
    const allRules = rules ?? [];
    if (hasDuplicateRetentionRule(allRules, createDraft.classification, createDraft.status)) {
      setCreateError("A rule for this classification and status already exists.");
      return;
    }
    setCreateError(null);
    createRule.mutate(
      {
        classification: createDraft.classification,
        status: createDraft.status,
        retention_days: clampDays(createDraft.retentionDays),
        delete_pdf: createDraft.deletePdf,
        delete_box: createDraft.deleteBox,
      },
      { onSuccess: resetCreateForm, onError: (error: Error) => setCreateError(error.message || "Failed to create retention rule.") },
    );
  }

  function saveEdit() {
    if (!editingId || !editDraft) return;
    setEditError(null);
    updateRule.mutate(
      {
        id: editingId,
        payload: {
          retention_days: clampDays(editDraft.retentionDays),
          delete_pdf: editDraft.deletePdf,
          delete_box: editDraft.deleteBox,
        },
      },
      { onSuccess: cancelEdit, onError: (error: Error) => setEditError(error.message || "Failed to update retention rule.") },
    );
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
    setEditError(null);
  }

  return (
    <PermissionGate requires="accounting.invoices.manage_retention">
      <section className="rounded-lg border bg-card">
        <header className="flex items-start justify-between gap-3 border-b px-4 py-4">
          <div>
            <h3 className="text-sm font-semibold">Retention Policies</h3>
            <p className="mt-1 text-xs text-muted-foreground">Manage automatic purge windows by classification and terminal status.</p>
          </div>
          <Button size="sm" className="gap-2" disabled={adding} onClick={() => { setAdding(true); setCreateError(null); }}>
            <Plus className="h-4 w-4" /> Add Rule
          </Button>
        </header>
        <div className="mx-4 mt-4 flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p><strong>Pending documents are never auto-purged.</strong> Retention only acts after a document reaches a terminal status.</p>
        </div>
        {ruleOptionsError || ruleOptionsLoading || !ruleOptions ? <p className="px-4 py-3 text-sm text-destructive">Retention status options unavailable</p> : <>
          {adding ? <CreateForm draft={createDraft} error={createError} pending={createRule.isPending} classificationOptions={classificationOptions} statusOptions={statusOptions} onChange={setCreateDraft} onCancel={resetCreateForm} onSave={submitCreate} /> : null}
          {isLoading ? <LoadingRows /> : <RetentionTable rules={sortedRules} classificationLabels={classificationLabels} statusLabels={statusLabels} editingId={editingId} editDraft={editDraft} pending={updateRule.isPending || deleteRule.isPending} confirmDeleteId={confirmDeleteId} onStartEdit={startEdit} onDraftChange={setEditDraft} onCancelEdit={cancelEdit} onSaveEdit={saveEdit} onConfirmDelete={setConfirmDeleteId} onDelete={(id) => deleteRule.mutate({ id }, { onSuccess: () => setConfirmDeleteId(null) })} />}
        </>}
        {editError ? <p className="px-4 pb-4 text-xs text-destructive">{editError}</p> : null}
      </section>
    </PermissionGate>
  );
}

function CreateForm({ draft, error, pending, classificationOptions, statusOptions, onChange, onCancel, onSave }: { draft: RetentionDraft; error: string | null; pending: boolean; classificationOptions: SelectOption[]; statusOptions: SelectOption[]; onChange: (draft: RetentionDraft) => void; onCancel: () => void; onSave: () => void }) {
  return (
    <div className="m-4 rounded-lg border bg-muted/25 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Classification" value={draft.classification} options={classificationOptions} onChange={(classification) => onChange({ ...draft, classification })} />
        <SelectField label="Status" value={draft.status} options={statusOptions} onChange={(status) => onChange({ ...draft, status })} />
        <label className="space-y-1 text-xs font-medium text-muted-foreground">Retention Days<Input type="number" min={1} value={draft.retentionDays} onChange={(event) => onChange({ ...draft, retentionDays: clampDays(event.target.value) })} /></label>
        <DeleteToggles deletePdf={draft.deletePdf} deleteBox={draft.deleteBox} onChange={(patch) => onChange({ ...draft, ...patch })} />
      </div>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={pending} onClick={onSave}>{pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}Create</Button>
      </div>
    </div>
  );
}

function RetentionTable({ rules, classificationLabels, statusLabels, editingId, editDraft, pending, confirmDeleteId, onStartEdit, onDraftChange, onCancelEdit, onSaveEdit, onConfirmDelete, onDelete }: { rules: RetentionRule[]; classificationLabels: Record<string, string>; statusLabels: Record<string, string>; editingId: number | null; editDraft: Omit<RetentionDraft, "classification" | "status"> | null; pending: boolean; confirmDeleteId: number | null; onStartEdit: (rule: RetentionRule) => void; onDraftChange: (draft: Omit<RetentionDraft, "classification" | "status"> | null) => void; onCancelEdit: () => void; onSaveEdit: () => void; onConfirmDelete: (id: number | null) => void; onDelete: (id: number) => void }) {
  if (rules.length === 0) return <p className="p-4 text-sm text-muted-foreground">No retention rules configured.</p>;
  return (
    <div className="mt-4 overflow-x-auto border-t">
      <Table>
        <TableHeader><TableRow><TableHead>Classification</TableHead><TableHead>Status</TableHead><TableHead>Days</TableHead><TableHead>Delete</TableHead><TableHead>Updated</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
        <TableBody>{rules.map((rule) => <RetentionRow key={rule.id} rule={rule} classificationLabels={classificationLabels} statusLabels={statusLabels} editing={editingId === rule.id} draft={editingId === rule.id ? editDraft : null} pending={pending} confirmDelete={confirmDeleteId === rule.id} onStartEdit={() => onStartEdit(rule)} onDraftChange={onDraftChange} onCancelEdit={onCancelEdit} onSaveEdit={onSaveEdit} onConfirmDelete={() => onConfirmDelete(rule.id)} onDelete={() => onDelete(rule.id)} />)}</TableBody>
      </Table>
    </div>
  );
}

function RetentionRow({ rule, classificationLabels, statusLabels, editing, draft, pending, confirmDelete, onStartEdit, onDraftChange, onCancelEdit, onSaveEdit, onConfirmDelete, onDelete }: { rule: RetentionRule; classificationLabels: Record<string, string>; statusLabels: Record<string, string>; editing: boolean; draft: Omit<RetentionDraft, "classification" | "status"> | null; pending: boolean; confirmDelete: boolean; onStartEdit: () => void; onDraftChange: (draft: Omit<RetentionDraft, "classification" | "status"> | null) => void; onCancelEdit: () => void; onSaveEdit: () => void; onConfirmDelete: () => void; onDelete: () => void }) {
  const wildcard = isWildcardClassification(rule.classification);
  return (
    <TableRow className={cn(wildcard && "bg-primary/5", editing && "bg-muted/40")}>
      <TableCell><RetentionClassificationBadge classification={rule.classification} labels={classificationLabels} /></TableCell>
      <TableCell><RetentionStatusBadge status={rule.status} labels={statusLabels} /></TableCell>
      <TableCell>{editing && draft ? <Input className="h-9 w-24" type="number" min={1} value={draft.retentionDays} onChange={(event) => onDraftChange({ ...draft, retentionDays: clampDays(event.target.value) })} /> : <span className="font-mono text-sm font-semibold">{rule.retentionDays}</span>} <span className="text-xs text-muted-foreground">days</span></TableCell>
      <TableCell>{editing && draft ? <DeleteToggles deletePdf={draft.deletePdf} deleteBox={draft.deleteBox} onChange={(patch) => onDraftChange({ ...draft, ...patch })} /> : <span className="text-xs text-muted-foreground">{rule.deletePdf ? "PDF" : "No PDF"} / {rule.deleteBox ? "Box" : "No Box"}</span>}</TableCell>
      <TableCell><div className="text-xs leading-tight"><p className="font-mono">{formatRetentionTimestamp(rule.updatedAt)}</p><p className="text-muted-foreground">{rule.updatedBy || "system"}</p></div></TableCell>
      <TableCell className="text-right">{editing ? <EditActions pending={pending} onSave={onSaveEdit} onCancel={onCancelEdit} /> : <RowActions wildcard={wildcard} confirmDelete={confirmDelete} pending={pending} onEdit={onStartEdit} onConfirmDelete={onConfirmDelete} onDelete={onDelete} />}</TableCell>
    </TableRow>
  );
}

function DeleteToggles({ deletePdf, deleteBox, onChange }: { deletePdf: boolean; deleteBox: boolean; onChange: (patch: { deletePdf?: boolean; deleteBox?: boolean }) => void }) {
  return <div className="flex flex-wrap gap-3"><label className="inline-flex items-center gap-2 text-xs"><Checkbox checked={deletePdf} onCheckedChange={(checked) => onChange({ deletePdf: checked === true })} />PDF</label><label className="inline-flex items-center gap-2 text-xs"><Checkbox checked={deleteBox} onCheckedChange={(checked) => onChange({ deleteBox: checked === true })} />Box</label></div>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-xs font-medium text-muted-foreground">{label}<select className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function EditActions({ pending, onSave, onCancel }: { pending: boolean; onSave: () => void; onCancel: () => void }) {
  return <span className="inline-flex gap-1"><Button size="icon" className="h-8 w-8" disabled={pending} onClick={onSave} aria-label="Save retention rule"><Save className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="h-8 w-8" disabled={pending} onClick={onCancel} aria-label="Cancel retention edit"><X className="h-4 w-4" /></Button></span>;
}

function RowActions({ wildcard, confirmDelete, pending, onEdit, onConfirmDelete, onDelete }: { wildcard: boolean; confirmDelete: boolean; pending: boolean; onEdit: () => void; onConfirmDelete: () => void; onDelete: () => void }) {
  if (confirmDelete) return <Button size="sm" variant="destructive" disabled={pending} onClick={onDelete}>Confirm</Button>;
  return <span className="inline-flex gap-1"><Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit} aria-label="Edit retention rule"><Pencil className="h-4 w-4" /></Button>{wildcard ? <span className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground" title="Default retention rule cannot be deleted"><Lock className="h-4 w-4" /></span> : <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onConfirmDelete} aria-label="Delete retention rule"><Trash2 className="h-4 w-4" /></Button>}</span>;
}

function LoadingRows() {
  return <div className="space-y-2 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>;
}
