"use client";
import { PanelNotice } from "./PanelNotice";

import { useState, type ReactNode } from "react";
import { Check, CheckCircle2, CircleAlert, CircleDashed, Loader2, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  formatDocumentDate,
  formatDocumentMoney,
  type StatementLineState,
  type StatementStats,
} from "@/modules/accounting/modules/invoices/components/documents/documentSpecLocalModels";
import type { StatementLineResolutionType, UpdateStatementLinePayload } from "@/modules/accounting/modules/invoices/types/api";
import type { StatementLineStatus } from "@/modules/accounting/modules/invoices/types/invoice";
import { Badge } from "@/modules/shared/components/ui/badge";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";
import { cn } from "@/modules/shared/lib/utils";

export interface StatementAddLineDraft {
  invoiceNumber: string;
  date: string;
  amount: string;
  error: string | null;
  pending: boolean;
}

export interface StatementLinesPanelProps {
  lines: readonly StatementLineState[];
  draft: StatementAddLineDraft;
  onResolveLine: (line: StatementLineState, resolutionType: StatementLineResolutionType) => void | Promise<void>;
  onUnresolveLine?: (line: StatementLineState) => void | Promise<void>;
  onDraftChange: (patch: Partial<StatementAddLineDraft>) => void;
  onAddLine?: () => void;
  canManageLines?: boolean;
  vendorCode?: string;
  onEditLine?: (
    lineId: string,
    payload: UpdateStatementLinePayload,
    line: StatementLineState,
  ) => void | Promise<void>;
  onDeleteLine?: (line: StatementLineState) => void | Promise<void>;
  onRecheckLines?: () => void | Promise<void>;
  recheckPending?: boolean;
  extractionFailed?: boolean;
}

const statusMeta: Record<StatementLineStatus, { label: string; className: string; icon: LucideIcon }> = {
  matched: {
    label: "Spectrum",
    icon: CheckCircle2,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300",
  },
  in_toolbox_not_spectrum: {
    label: "Toolbox",
    icon: CircleDashed,
    className: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-300",
  },
  not_received: {
    label: "Add to AP",
    icon: CircleAlert,
    className: "border-border bg-muted/40 text-muted-foreground",
  },
  amount_differs: {
    label: "Accept AP",
    icon: CircleAlert,
    className: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300",
  },
};

const PROTECTED_LINE_TOOLTIP = "Unmatch this line before editing";

interface StatementLineEditDraft {
  lineId: string;
  invoiceNumber: string;
  date: string;
  amount: string;
  error: string | null;
  pending: boolean;
}

function getResolvedLabel(line: StatementLineState): string | null {
  if (!line.resolved) return null;
  return line.matchState === "amount_differs" ? "Using AP amount" : "Accepted line";
}

function getLineActionLabel(line: StatementLineState): string | null {
  if (line.clear === true) return null;
  if (line.matchState === "amount_differs") return line.apAmount === null
    ? "Accept AP"
    : `Accept AP ${formatDocumentMoney(line.apAmount)}`;
  if (line.matchState === "not_received") return "Add to AP";
  return null;
}

function isProtectedLine(line: StatementLineState): boolean {
  return line.matchState === "matched" || line.matchState === "in_toolbox_not_spectrum";
}

function parseEditAmount(value: string): number | null {
  const amount = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function getEditPayload(
  line: StatementLineState,
  draft: StatementLineEditDraft,
): { payload: UpdateStatementLinePayload | null; error: string | null } {
  const invoiceNumber = draft.invoiceNumber.trim();
  const amount = parseEditAmount(draft.amount);
  const payload: UpdateStatementLinePayload = {};

  if (!invoiceNumber) return { payload: null, error: "Invoice number is required." };
  if (amount === null) return { payload: null, error: "Enter a valid amount." };
  if (invoiceNumber !== line.invoiceNumber) payload.invoiceNumber = invoiceNumber;
  if ((draft.date || null) !== (line.date || null)) payload.date = draft.date || null;
  if (amount !== line.statementAmount) payload.amount = amount;
  if (Object.keys(payload).length === 0) {
    return { payload: null, error: "Change at least one field before saving." };
  }

  return { payload, error: null };
}

function getLineIdentity(line: StatementLineState): string {
  return `${line.invoiceNumber} (${formatDocumentMoney(line.statementAmount)})`;
}

export function StatementLineStatusChip({ line }: { line: StatementLineState }) {
  const resolvedLabel = getResolvedLabel(line);
  const meta = resolvedLabel ? { ...statusMeta.matched, label: resolvedLabel } : statusMeta[line.matchState];
  const Icon = meta.icon;
  const chip = (
    <Badge
      variant="outline"
      className={cn("gap-1 border", meta.className)}
      title={line.matchState === "amount_differs" ? `Statement shows ${formatDocumentMoney(line.statementAmount)} - Spectrum/Toolbox has a different amount.` : undefined}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  );

  if (line.matchState !== "amount_differs" || resolvedLabel) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="top">
        Statement shows {formatDocumentMoney(line.statementAmount)} - Spectrum/Toolbox has a different amount.
      </TooltipContent>
    </Tooltip>
  );
}

function ProtectedIconButton({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" title={PROTECTED_LINE_TOOLTIP}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled
            aria-label={label}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{PROTECTED_LINE_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}

export function StatementLineRollup({ stats }: { stats: StatementStats }) {
  const unresolved = stats.unresolved > 0;
  return (
    <div className={cn(
      "flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md px-3 py-2 text-xs text-muted-foreground",
      unresolved && "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-300",
    )}>
      <span>Located <strong className="font-mono">{stats.cleared}/{stats.total}</strong></span>
      <span>Discrepancies <strong className="font-mono">{stats.openDiffs}</strong></span>
      <span>Missing <strong className="font-mono">{stats.openMissing}</strong></span>
      {unresolved && (
        <span className="inline-flex items-center gap-1 font-medium">
          <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
          Not yet tied out
        </span>
      )}
    </div>
  );
}

export function StatementLinesPanel({
  lines,
  draft,
  onResolveLine,
  onUnresolveLine,
  onDraftChange,
  onAddLine,
  canManageLines = false,
  vendorCode = "",
  onEditLine,
  onDeleteLine,
  onRecheckLines,
  recheckPending = false,
  extractionFailed = false,
}: StatementLinesPanelProps) {
  const [editDraft, setEditDraft] = useState<StatementLineEditDraft | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);
  const [resolutionPendingId, setResolutionPendingId] = useState<string | null>(null);
  const columnsClass = canManageLines
    ? "min-w-[34rem] grid-cols-[5.5rem_minmax(9rem,1fr)_minmax(10rem,auto)_minmax(4rem,auto)]"
    : "min-w-[28rem] grid-cols-[5.5rem_minmax(9rem,1fr)_minmax(10rem,auto)]";

  function startEdit(line: StatementLineState) {
    setConfirmDeleteId(null);
    setEditDraft({
      lineId: line.id,
      invoiceNumber: line.invoiceNumber,
      date: line.date || "",
      amount: String(line.statementAmount),
      error: null,
      pending: false,
    });
  }

  async function saveEdit(line: StatementLineState) {
    if (!editDraft || editDraft.lineId !== line.id || !onEditLine) return;
    const { payload, error } = getEditPayload(line, editDraft);
    if (error || !payload) {
      setEditDraft({ ...editDraft, error });
      return;
    }

    setEditDraft({ ...editDraft, pending: true, error: null });
    try {
      await onEditLine(line.id, payload, line);
      setEditDraft(null);
    } catch (error) {
      setEditDraft({
        ...editDraft,
        pending: false,
        error: error instanceof Error ? error.message : "Statement line could not be updated.",
      });
    }
  }

  async function deleteLine(line: StatementLineState) {
    if (!onDeleteLine) return;
    setDeletePendingId(line.id);
    try {
      await onDeleteLine(line);
      setConfirmDeleteId(null);
    } finally {
      setDeletePendingId(null);
    }
  }

  async function updateResolution(line: StatementLineState) {
    const resolutionType: StatementLineResolutionType = line.matchState === "amount_differs"
      ? "use_ap_amount"
      : "accept_line";
    setResolutionPendingId(line.id);
    try {
      if (line.resolved) await onUnresolveLine?.(line);
      else await onResolveLine(line, resolutionType);
    } catch {
      // The document spec owns the user-facing error toast; preserve the row as-is.
    } finally {
      setResolutionPendingId(null);
    }
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!vendorCode && (
            <PanelNotice id="statement-vendor-missing" label="Assign a vendor">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
              <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Assign a vendor to check these invoices against Spectrum.</span>
            </div>
            </PanelNotice>
          )}
          {canManageLines && onRecheckLines && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto h-8 gap-1.5"
              disabled={!vendorCode || recheckPending || lines.length === 0}
              onClick={() => void onRecheckLines()}
            >
              {recheckPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Re-check Lines
            </Button>
          )}
        </div>
        <div className="overflow-x-auto rounded-lg border border-border" role="table" aria-label="Statement lines">
          <div className={cn("grid gap-2 bg-muted/40 px-3 py-2 text-2xs font-semibold uppercase tracking-widest text-muted-foreground", columnsClass)} role="row">
            <span role="columnheader">Date</span>
            <span role="columnheader">Invoice</span>
            <span className="text-right" role="columnheader">Amount</span>
            {canManageLines && <span className="text-right" role="columnheader">Actions</span>}
          </div>
          {lines.length === 0 && (
            <PanelNotice id="statement-lines-empty" label="No statement lines extracted">
            <div className="border-t border-border/60 px-4 py-6 text-center" role="row">
              <p className="text-sm font-medium text-foreground">No statement lines extracted</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {extractionFailed
                  ? "Statement extraction failed. Reprocess the document or add lines manually."
                  : "Extraction found no invoice lines. Add a line manually to begin reconciliation."}
              </p>
            </div>
            </PanelNotice>
          )}
          {lines.map((line) => {
            const actionLabel = getLineActionLabel(line);
            const protectedLine = isProtectedLine(line);
            const editing = editDraft?.lineId === line.id;
            const confirmingDelete = confirmDeleteId === line.id;
            if (editing && editDraft) {
              return (
                <div key={line.id} className="border-t border-border/60 px-3 py-3" role="row">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_auto]">
                    <label className="space-y-1 text-xs font-medium text-muted-foreground">
                      <span>Invoice number</span>
                      <Input
                        value={editDraft.invoiceNumber}
                        onChange={(event) => setEditDraft({ ...editDraft, invoiceNumber: event.target.value, error: null })}
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-muted-foreground">
                      <span>Date</span>
                      <Input
                        type="date"
                        value={editDraft.date}
                        onChange={(event) => setEditDraft({ ...editDraft, date: event.target.value, error: null })}
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-muted-foreground">
                      <span>Amount</span>
                      <Input
                        inputMode="decimal"
                        value={editDraft.amount}
                        onChange={(event) => setEditDraft({ ...editDraft, amount: event.target.value, error: null })}
                      />
                    </label>
                    <span className="flex items-end justify-end gap-1">
                      <Button
                        type="button"
                        size="icon"
                        className="h-8 w-8"
                        disabled={editDraft.pending}
                        aria-label={`Save changes for ${line.invoiceNumber}`}
                        onClick={() => void saveEdit(line)}
                      >
                        {editDraft.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={editDraft.pending}
                        aria-label={`Cancel edit for ${line.invoiceNumber}`}
                        onClick={() => setEditDraft(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </span>
                  </div>
                  {editDraft.error && <p className="mt-2 text-xs text-destructive">{editDraft.error}</p>}
                </div>
              );
            }
            return (
              <div key={line.id} className={cn(
                "grid items-center gap-2 border-t border-border/60 px-3 py-2 text-sm",
                columnsClass,
                line.clear === true && "bg-emerald-50/50 dark:bg-emerald-950/10",
              )} role="row">
                <span className="text-xs text-muted-foreground" role="cell">{formatDocumentDate(line.date)}</span>
                <span className="flex min-w-0 items-center gap-2" role="cell">
                  <span className="truncate font-mono text-xs text-foreground">{line.invoiceNumber}</span>
                  {(line.matchState === "matched" || line.matchState === "in_toolbox_not_spectrum" || line.resolved) && (
                    <StatementLineStatusChip line={line} />
                  )}
                </span>
                <span className="flex items-center justify-end gap-2 text-right" role="cell">
                  {(actionLabel || (line.resolved && onUnresolveLine)) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-7 shrink-0 px-2 text-xs",
                          line.matchState === "amount_differs"
                            ? "border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300"
                            : "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300",
                        )}
                        title={line.matchState === "amount_differs"
                          ? `Statement shows ${formatDocumentMoney(line.statementAmount)} - Spectrum/Toolbox has a different amount.`
                          : undefined}
                        disabled={resolutionPendingId === line.id}
                        onClick={() => void updateResolution(line)}
                      >
                        {line.resolved ? "Undo acceptance" : actionLabel}
                      </Button>
                  )}
                  {line.clear === true && <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />}
                  <span className="font-mono text-xs text-foreground">{formatDocumentMoney(line.statementAmount)}</span>
                </span>
                {canManageLines && (
                  <span className="flex justify-end" role="cell">
                    {confirmingDelete ? (
                      <span className="flex flex-col items-end gap-1">
                        <span className="text-right text-2xs text-muted-foreground">
                          Remove {getLineIdentity(line)}?
                        </span>
                        <span className="inline-flex gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="h-7 px-2 text-xs"
                            disabled={deletePendingId === line.id}
                            onClick={() => void deleteLine(line)}
                          >
                            {deletePendingId === line.id ? "Removing" : "Confirm"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={deletePendingId === line.id}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </Button>
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex gap-1">
                        {protectedLine ? (
                          <ProtectedIconButton label={`Edit ${line.invoiceNumber}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </ProtectedIconButton>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={!onEditLine}
                            aria-label={`Edit ${line.invoiceNumber}`}
                            onClick={() => startEdit(line)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {protectedLine ? (
                          <ProtectedIconButton label={`Remove ${line.invoiceNumber}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </ProtectedIconButton>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            disabled={!onDeleteLine}
                            aria-label={`Remove ${line.invoiceNumber}`}
                            onClick={() => {
                              setEditDraft(null);
                              setConfirmDeleteId(line.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </span>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {canManageLines && onAddLine && (
          <form className="rounded-lg border border-border bg-muted/20 p-3" onSubmit={(event) => { event.preventDefault(); onAddLine(); }}>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_auto]">
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                <span>Invoice number</span>
                <Input value={draft.invoiceNumber} onChange={(event) => onDraftChange({ invoiceNumber: event.target.value })} />
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                <span>Date</span>
                <Input type="date" value={draft.date} onChange={(event) => onDraftChange({ date: event.target.value })} />
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                <span>Amount</span>
                <Input inputMode="decimal" value={draft.amount} onChange={(event) => onDraftChange({ amount: event.target.value })} />
              </label>
              <Button type="submit" size="sm" className="self-end" disabled={draft.pending}>Add Line</Button>
            </div>
            {draft.error && <p className="mt-2 text-xs text-destructive">{draft.error}</p>}
          </form>
        )}
      </div>
    </TooltipProvider>
  );
}
