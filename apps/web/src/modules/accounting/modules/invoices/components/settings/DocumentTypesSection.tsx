"use client";

import { type ReactNode, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { DocumentTypesAddForm } from "@/modules/accounting/modules/invoices/components/settings/DocumentTypesAddForm";
import {
  DocumentTypesSaveBar,
  type DocumentTypesSaveState,
} from "@/modules/accounting/modules/invoices/components/settings/DocumentTypesSaveBar";
import { DocumentTypesTable } from "@/modules/accounting/modules/invoices/components/settings/DocumentTypesTable";
import {
  type AddTypeDraft,
  buildChangedClassificationPayload,
  canEditClassificationLabel,
  cloneClassificationRows,
  documentTypesSignature,
  errorMessageFromUnknown,
  getDirtyClassificationNames,
  needsInput,
  upsertClassificationRow,
  validateClassificationLabel,
} from "@/modules/accounting/modules/invoices/components/settings/documentTypesModel";
import { useCreateClassification, useUpdateClassifications } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { useClassifications } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

export function DocumentTypesSection() {
  const { classifications, availableAssociations, error, isError, isLoading } = useClassifications();
  const fetchedRows = useMemo(() => cloneClassificationRows(classifications), [classifications]);
  const fetchedSignature = useMemo(() => documentTypesSignature(fetchedRows), [fetchedRows]);

  return (
    <DocumentTypesSectionBody
      key={fetchedSignature}
      initialRows={fetchedRows}
      availableAssociations={availableAssociations}
      queryError={isError ? error : null}
      isLoading={isLoading}
    />
  );
}

function DocumentTypesSectionBody({
  initialRows,
  availableAssociations,
  queryError,
  isLoading,
}: {
  initialRows: readonly ClassificationInfo[];
  availableAssociations: ReturnType<typeof useClassifications>["availableAssociations"];
  queryError: unknown;
  isLoading: boolean;
}) {
  const createClassification = useCreateClassification();
  const updateClassifications = useUpdateClassifications();
  const [rows, setRows] = useState<ClassificationInfo[]>(() => cloneClassificationRows(initialRows));
  const [baselineRows, setBaselineRows] = useState<ClassificationInfo[]>(() => cloneClassificationRows(initialRows));
  const [adding, setAdding] = useState(false);
  const [saveState, setSaveState] = useState<DocumentTypesSaveState>("idle");
  const pending = createClassification.isPending || updateClassifications.isPending;

  const dirtyNames = getDirtyClassificationNames(rows, baselineRows);
  const needsInputCount = rows.filter(needsInput).length;
  const labelErrors = rows.reduce<Record<string, string>>((errors, row) => {
    if (!canEditClassificationLabel(row)) return errors;
    const error = validateClassificationLabel(row.label);
    if (error) errors[row.name] = error;
    return errors;
  }, {});
  const hasLabelErrors = Object.keys(labelErrors).length > 0;

  function updateRow(name: string, patch: Partial<Pick<ClassificationInfo, "label" | "opensAs" | "status">>) {
    setSaveState("idle");
    setRows((current) => current.map((row) => (row.name === name ? { ...row, ...patch } : row)));
  }

  function cancelChanges() {
    setRows(cloneClassificationRows(baselineRows));
    setSaveState("idle");
  }

  function saveChanges() {
    if (hasLabelErrors) return;
    const payload = buildChangedClassificationPayload(rows, baselineRows);
    if (payload.updates.length === 0) return;
    setSaveState("saving");
    updateClassifications.mutate(payload, {
      onSuccess: (response) => {
        const nextRows = response.classifications.length > 0 ? response.classifications : rows;
        setRows(cloneClassificationRows(nextRows));
        setBaselineRows(cloneClassificationRows(nextRows));
        setSaveState("saved");
        toast.success("Document type mappings saved", {
          description: `${payload.updates.length} ${payload.updates.length === 1 ? "change" : "changes"} saved.`,
        });
      },
      onError: (error: Error) => {
        setSaveState("error");
        toast.error("Failed to save document types", {
          description: errorMessageFromUnknown(error, "Please try again."),
        });
      },
    });
  }

  function createType(draft: AddTypeDraft) {
    createClassification.mutate(draft, {
      onSuccess: (created) => {
        setRows((current) => upsertClassificationRow(current, created));
        setBaselineRows((current) => upsertClassificationRow(current, created));
        setAdding(false);
        toast.success("Document type added", { description: created.label });
      },
      onError: (error: Error) => {
        toast.error("Failed to add document type", {
          description: errorMessageFromUnknown(error, "Please try again."),
        });
      },
    });
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-[17px] font-bold leading-6">Document Types</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">Backend classifications → Toolbox rendering surface.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
            <MetaPill>{rows.length} mappings</MetaPill>
            <MetaPill tone={needsInputCount > 0 ? "amber" : "muted"}>{needsInputCount} Needs Input</MetaPill>
            {isLoading ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Loading</span> : null}
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-2" disabled={adding} onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          Add Type
        </Button>
      </header>

      {adding ? (
        <DocumentTypesAddForm
          associations={availableAssociations}
          existingRows={rows}
          pending={createClassification.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={createType}
        />
      ) : null}

      {queryError ? (
        <div className="mx-5 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Showing fallback document types.</p>
              <p className="text-xs opacity-80">{errorMessageFromUnknown(queryError, "Classifications could not be loaded.")}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="overflow-hidden rounded-lg border bg-card">
          <DocumentTypesTable
            rows={rows}
            baselineRows={baselineRows}
            associations={availableAssociations}
            pending={pending}
            labelErrors={labelErrors}
            onLabelChange={(name, label) => updateRow(name, { label })}
            onOpensAsChange={(name, opensAs) => updateRow(name, { opensAs })}
            onToggleStatus={(name) => {
              const row = rows.find((item) => item.name === name);
              if (!row) return;
              updateRow(name, { status: row.status === "active" ? "disabled" : "active" });
            }}
          />
        </div>
      </div>

      <DocumentTypesSaveBar
        dirtyCount={dirtyNames.length}
        saveState={saveState}
        pending={updateClassifications.isPending}
        saveDisabled={hasLabelErrors}
        onCancel={cancelChanges}
        onClearState={() => setSaveState("idle")}
        onSave={saveChanges}
      />
    </section>
  );
}

function MetaPill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "amber" }) {
  return (
    <span className={cn("rounded-md px-2 py-1 font-mono uppercase", tone === "amber" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground")}>
      {children}
    </span>
  );
}
