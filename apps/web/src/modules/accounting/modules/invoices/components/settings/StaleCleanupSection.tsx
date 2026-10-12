"use client";

import { useMemo, useState } from "react";
import { Info, Lock, Pencil, Plus, Save, Trash2, X } from "lucide-react";

import { useClassifications } from "@/modules/accounting/modules/invoices/hooks/queries";
import { RetentionClassificationBadge } from "@/modules/accounting/modules/invoices/components/settings/RetentionBadges";
import {
  clampDays,
  hasDuplicateStaleRule,
  initialStaleCleanupRules,
  isWildcardClassification,
  sortStaleCleanupRules,
  type StaleCleanupDraft,
  type StaleCleanupRule,
} from "@/modules/accounting/modules/invoices/components/settings/retentionPolicyModel";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import { Switch } from "@/modules/shared/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/modules/shared/components/ui/table";
import { cn } from "@/modules/shared/lib/utils";

const DEFAULT_DRAFT: StaleCleanupDraft = { classification: "receipt", days: 60 };

export function StaleCleanupSection() {
  const { classifications } = useClassifications();
  const classificationLabels = useMemo(() => {
    const record: Record<string, string> = {};
    for (const classification of classifications) record[classification.name] = classification.label;
    return record;
  }, [classifications]);
  const staleClassificationOptions = useMemo(
    () =>
      classifications
        .filter((classification) => classification.status === "active" && classification.name !== "invoice")
        .map((classification) => ({ value: classification.name, label: classification.label })),
    [classifications],
  );
  const [rules, setRules] = useState<StaleCleanupRule[]>(() => initialStaleCleanupRules());
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<StaleCleanupDraft>(DEFAULT_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftDays, setDraftDays] = useState(1);
  const sortedRules = useMemo(() => sortStaleCleanupRules(rules), [rules]);

  function startEdit(rule: StaleCleanupRule) {
    setEditingId(rule.id);
    setDraftDays(rule.days);
    setAdding(false);
    setError(null);
  }

  function saveEdit(id: string) {
    // TODO: Wire stale cleanup rules to the backend once an API exists.
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, days: clampDays(draftDays), updatedAt: "Edited locally", updatedBy: "You" } : rule));
    setEditingId(null);
  }

  function toggleEnabled(id: string) {
    // TODO: Wire stale cleanup rules to the backend once an API exists.
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, enabled: !rule.enabled, updatedAt: "Edited locally", updatedBy: "You" } : rule));
  }

  function submitAdd() {
    if (hasDuplicateStaleRule(rules, addDraft.classification)) {
      setError("A stale cleanup rule for this classification already exists.");
      return;
    }
    // TODO: Wire stale cleanup rules to the backend once an API exists.
    setRules((current) => [
      ...current,
      { id: `stale-${addDraft.classification}`, classification: addDraft.classification, days: clampDays(addDraft.days), enabled: true, updatedAt: "Added locally", updatedBy: "You" },
    ]);
    setAddDraft(DEFAULT_DRAFT);
    setAdding(false);
    setError(null);
  }

  function deleteRule(id: string) {
    // TODO: Wire stale cleanup rules to the backend once an API exists.
    setRules((current) => current.filter((rule) => rule.id !== id));
  }

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-4">
        <div>
          <h3 className="text-sm font-semibold">Stale Document Cleanup</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Auto-discard non-invoice documents left pending, then let retention rules purge them.
          </p>
        </div>
        <Button size="sm" variant={adding ? "outline" : "default"} className="gap-2" onClick={() => { setAdding((open) => !open); setError(null); }}>
          <Plus className="h-4 w-4" />
          Add Rule
        </Button>
      </header>
      <div className="mx-4 mt-4 flex gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p><strong>Invoices are excluded.</strong> Stale cleanup only applies to non-invoice document types.</p>
      </div>
      {adding ? (
        <div className="m-4 rounded-lg border bg-muted/25 p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto] sm:items-end">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Classification
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground" value={addDraft.classification} onChange={(event) => { setAddDraft({ ...addDraft, classification: event.target.value }); setError(null); }}>
                {staleClassificationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Days
              <Input type="number" min={1} value={addDraft.days} onChange={(event) => setAddDraft({ ...addDraft, days: clampDays(event.target.value) })} />
            </label>
            <div className="flex gap-2">
              <Button size="sm" onClick={submitAdd}><Save className="mr-1 h-4 w-4" />Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Classification</TableHead><TableHead>Pending Window</TableHead><TableHead>Enabled</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {sortedRules.map((rule) => {
              const editing = editingId === rule.id;
              const wildcard = isWildcardClassification(rule.classification);
              return (
                <TableRow key={rule.id} className={cn(wildcard && "bg-primary/5", !rule.enabled && "opacity-60")}>
                  <TableCell><RetentionClassificationBadge classification={rule.classification} wildcardLabel="All Non-Invoice Types" labels={classificationLabels} /></TableCell>
                  <TableCell>{editing ? <Input className="h-9 w-24" type="number" min={1} value={draftDays} onChange={(event) => setDraftDays(clampDays(event.target.value))} /> : <span className="font-mono text-sm font-semibold">{rule.days}</span>} <span className="text-xs text-muted-foreground">days</span></TableCell>
                  <TableCell><Switch checked={rule.enabled} onCheckedChange={() => toggleEnabled(rule.id)} aria-label={`${rule.classification} stale cleanup enabled`} /></TableCell>
                  <TableCell className="text-right">{editing ? <EditActions onSave={() => saveEdit(rule.id)} onCancel={() => setEditingId(null)} /> : <RowActions wildcard={wildcard} onEdit={() => startEdit(rule)} onDelete={() => deleteRule(rule.id)} />}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function EditActions({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return <span className="inline-flex gap-1"><Button size="icon" className="h-8 w-8" onClick={onSave} aria-label="Save stale cleanup rule"><Save className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="h-8 w-8" onClick={onCancel} aria-label="Cancel stale cleanup edit"><X className="h-4 w-4" /></Button></span>;
}

function RowActions({ wildcard, onEdit, onDelete }: { wildcard: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <span className="inline-flex gap-1">
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit} aria-label="Edit stale cleanup rule"><Pencil className="h-4 w-4" /></Button>
      {wildcard ? <span className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground" title="Default cleanup rule cannot be deleted"><Lock className="h-4 w-4" /></span> : <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onDelete} aria-label="Delete stale cleanup rule"><Trash2 className="h-4 w-4" /></Button>}
    </span>
  );
}
