"use client";

import { AlertTriangle, Archive, BookText, CheckCircle2, ListChecks } from "lucide-react";

import {
  getStatementVendor,
  getStatementStats,
  linesFromStatementLines,
} from "@/modules/accounting/modules/invoices/components/documents/documentSpecLocalModels";
import {
  getStatementLinesAfterAdd,
  getStatementLinesAfterDelete,
  getStatementLinesAfterRematch,
  getStatementLinesAfterResolution,
  getStatementLinesAfterUpdate,
  initStatementDocumentForm,
  parseStatementLinePayload,
  type StatementDocumentFormState,
} from "@/modules/accounting/modules/invoices/components/documents/statementDocumentLogic";
import { StatementDetailsFields } from "@/modules/accounting/modules/invoices/components/documents/statementDocumentViews";
import { mutationErrorMessage } from "@/modules/accounting/modules/invoices/lib/mutationErrorMessage";
import {
  StatementLineRollup,
  StatementLinesPanel,
  type StatementAddLineDraft,
} from "@/modules/accounting/modules/invoices/components/documents/statementLineViews";
import { toast } from "@/modules/shared/components/ui/toaster";
import { isApiError } from "@/modules/shared/lib/api";
import type { StatementLineState } from "@/modules/accounting/modules/invoices/components/documents/documentSpecLocalModels";
import type {
  AddStatementLinePayload,
  AddStatementLineResponse,
  DeleteStatementLineResponse,
  InvoiceUpdateResponse,
  InvoiceUpdatePayload,
  RematchStatementLinesResponse,
  ReconcileDocumentResponse,
  ResolveStatementLinePayload,
  StatementLineResolutionResponse,
  StatementLineResolutionType,
  StatementLineStatusChange,
  UpdateStatementLinePayload,
  UpdateStatementLineResponse,
  UpdateStatementAttributesPayload,
  UpdateStatementAttributesResponse,
} from "@/modules/accounting/modules/invoices/types/api";
import type {
  DocumentAction,
  DocumentFilingMeta,
  DocumentFilingResult,
  DocumentSpecDefinition,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice, StatementLineStatus } from "@/modules/accounting/modules/invoices/types/invoice";

export interface StatementDocumentSpecOptions {
  secondaryActions?: readonly DocumentAction[];
  onFileDocument?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  /** Persists reconciliation via POST /api/invoices/:id/reconcile */
  onReconcile?: (record: Invoice) => ReconcileDocumentResponse | Promise<ReconcileDocumentResponse>;
  onAddStatementLine?: (
    record: Invoice,
    payload: AddStatementLinePayload,
  ) => AddStatementLineResponse | Promise<AddStatementLineResponse>;
  onUpdateStatementLine?: (
    record: Invoice,
    lineId: string,
    payload: UpdateStatementLinePayload,
  ) => UpdateStatementLineResponse | Promise<UpdateStatementLineResponse>;
  onDeleteStatementLine?: (
    record: Invoice,
    lineId: string,
  ) => DeleteStatementLineResponse | Promise<DeleteStatementLineResponse>;
  onRematchStatementLines?: (record: Invoice) => RematchStatementLinesResponse | Promise<RematchStatementLinesResponse>;
  onResolveStatementLine?: (record: Invoice, lineId: string, payload: ResolveStatementLinePayload) => StatementLineResolutionResponse | Promise<StatementLineResolutionResponse>;
  onUnresolveStatementLine?: (record: Invoice, lineId: string) => StatementLineResolutionResponse | Promise<StatementLineResolutionResponse>;
  onUpdateDocument?: (record: Invoice, payload: InvoiceUpdatePayload) => InvoiceUpdateResponse | Invoice | void | Promise<InvoiceUpdateResponse | Invoice | void>;
  onUpdateStatementAttributes?: (record: Invoice, payload: UpdateStatementAttributesPayload) => UpdateStatementAttributesResponse | Promise<UpdateStatementAttributesResponse>;
  canEditStatementAttributes?: boolean;
  filePending?: boolean;
  reconcilePending?: boolean;
  rematchStatementLinesPending?: boolean;
}

function getStatementLineStatusLabel(status: StatementLineStatus): string {
  switch (status) {
    case "matched":
      return "matched";
    case "in_toolbox_not_spectrum":
      return "in Toolbox";
    case "not_received":
      return "not received";
    case "amount_differs":
      return "amount differs";
    default:
      return status;
  }
}

function getStatementLineMutationError(error: unknown): string {
  if (isApiError(error) && error.status === 409 && error.code === "LINE_STATUS_PROTECTED") {
    return "Unmatch this line before editing.";
  }
  return mutationErrorMessage(error, "Statement line could not be saved.");
}

function getStatusChangedSuffix(status: StatementLineStatus): string {
  return status === "matched" ? " \u2713" : "";
}

function toastStatusChanges(
  changes: readonly StatementLineStatusChange[],
  noChangeTitle?: string,
) {
  if (changes.length === 0) {
    if (noChangeTitle) toast.success(noChangeTitle);
    return;
  }
  const first = changes[0];
  const newStatus = first.status[1];
  toast.success(`${changes.length} ${changes.length === 1 ? "line" : "lines"} updated: ${first.invoiceNumber} now ${getStatementLineStatusLabel(newStatus)}${getStatusChangedSuffix(newStatus)}`, {
    description: changes.length > 1 ? "Statement matching was refreshed." : undefined,
  });
}

function getLinesFromInvoiceResponse(response: Invoice | void): StatementLineState[] | null {
  const lines = response?.statementLines ?? response?.extracted?.statementLines ?? null;
  return lines ? linesFromStatementLines(lines) : null;
}

export function createStatementDocumentSpec(
  options: StatementDocumentSpecOptions = {},
): DocumentSpecDefinition<Invoice, StatementDocumentFormState> {
  const vendorSaveSequences = new Map<string, number>();
  const statementAttributeSaveSequences = new Map<string, number>();
  return {
    id: "statement-document",
    label: "Statement",
    classifications: ["statement"],
    initForm: initStatementDocumentForm,
    flushPendingChanges: async ({ record, form }) => {
      if (!options.onUpdateDocument) return;
      const payload: InvoiceUpdatePayload = {};
      const initialVendorCode = record.matching?.vendor?.vendorCode ?? "";
      if (form.vendorCode !== initialVendorCode) payload.vendorCode = form.vendorCode;
      if (Object.keys(payload).length === 0) return;
      try {
        await options.onUpdateDocument(record, payload);
      } catch (error) {
        toast.error("Statement update failed", {
          description: mutationErrorMessage(error, "Statement changes could not be saved."),
        });
      }
    },
    build: ({ record, form, setForm, patchForm }) => {
      const stats = getStatementStats(form.lines);
      const reconciliationBlockers = form.reconcile?.blockers ?? [{
        code: "RECONCILIATION_STATE_UNAVAILABLE",
        message: "Reconciliation status is unavailable. Refresh this statement before reconciling.",
      }];
      const canReconcile = Boolean(form.reconcile?.permittedActions.includes("reconcile"));
      const vendorName = getStatementVendor(record);
      const initialVendorCode = record.matching?.vendor?.vendorCode ?? "";

      async function reconcileStatement() {
        if (form.reconciled || form.reconciling || !canReconcile) return;
        patchForm({ reconciling: true, reconcileError: null });
        try {
          const response = await options.onReconcile?.(record);
          if (!response?.invoice) throw new Error("Reconcile endpoint returned no statement.");
          toast.success("Statement reconciled", {
            description: `${vendorName} ${form.statementPeriod} matched by invoice number.`,
          });
          // The mutation seeds the exact invoice cache. The route re-renders this
          // panel from that canonical record rather than copying business state
          // from the response into the component form.
          patchForm({ reconciling: false });
        } catch (error) {
          const message = mutationErrorMessage(error, "Reconciliation failed.");
          patchForm({ reconciling: false, reconcileError: message });
          toast.error("Reconcile statement", {
            description: message,
          });
        }
      }

      async function shelveStatement() {
        if (form.filed || form.filing || !options.onFileDocument) return;
        patchForm({ filing: true });
        try {
          await options.onFileDocument(record);
          toast.success("Shelve", {
            description: `${vendorName} statement moved to the document shelf.`,
          });
          patchForm({ filed: true, filing: false });
        } catch (error) {
          patchForm({ filing: false });
          toast.error("Shelve", {
            description: mutationErrorMessage(error, "Statement could not be shelved."),
          });
        }
      }

      async function updateVendorCode(vendorCode: string) {
        const requestSequence = (vendorSaveSequences.get(record.id) ?? 0) + 1;
        vendorSaveSequences.set(record.id, requestSequence);
        try {
          const response = await options.onUpdateDocument?.(record, { vendorCode });
          if (!response || requestSequence !== vendorSaveSequences.get(record.id)) return;
          const nextLines = getLinesFromInvoiceResponse(response);
          setForm((current) => ({
            ...current,
            vendorCode: response.matching?.vendor?.vendorCode ?? "",
            ...(nextLines ? { lines: nextLines } : {}),
            reconcile: response.reconcile ?? null,
            vendorUpdateError: null,
          }));
          toastStatusChanges("statusChanges" in response ? response.statusChanges ?? [] : []);
        } catch (error) {
          if (requestSequence !== vendorSaveSequences.get(record.id)) return;
          const message = mutationErrorMessage(error, "Vendor could not be saved.");
          patchForm({ vendorUpdateError: message });
          toast.error("Vendor update", {
            description: message,
          });
        }
      }

      async function persistStatementAttributes(payload: UpdateStatementAttributesPayload) {
        if (!options.onUpdateStatementAttributes) return;
        const requestSequence = (statementAttributeSaveSequences.get(record.id) ?? 0) + 1;
        statementAttributeSaveSequences.set(record.id, requestSequence);
        patchForm({ statementAttributeSaveState: "saving", statementAttributeError: null });
        try {
          const response = await options.onUpdateStatementAttributes(record, payload);
          if (requestSequence !== statementAttributeSaveSequences.get(record.id)) return;
          const attributes = response.invoice.statementAttributes;
          if (!attributes) throw new Error("Statement attribute response is unavailable.");
          setForm((current) => {
            const hasNewerDraft = current.statementPeriod !== form.statementPeriod
              || current.statementBalance !== form.statementBalance;
            return {
              ...current,
              statementAttributes: attributes,
              ...(payload.statementPeriod !== undefined && current.statementPeriod === form.statementPeriod
                ? { statementPeriod: attributes.statementPeriod.value ?? "" }
                : {}),
              ...(payload.balance !== undefined && current.statementBalance === form.statementBalance
                ? { statementBalance: attributes.balance.value === null ? "" : attributes.balance.value.toFixed(2) }
                : {}),
              statementAttributeError: null,
              statementAttributeSaveState: hasNewerDraft ? current.statementAttributeSaveState : "saved",
            };
          });
        } catch (error) {
          if (requestSequence !== statementAttributeSaveSequences.get(record.id)) return;
          patchForm({
            statementAttributeError: mutationErrorMessage(error, "Statement attributes could not be saved."),
            statementAttributeSaveState: "error",
          });
        }
      }

      async function persistStatementPeriod(value: string) {
        if (!value.trim()) return;
        await persistStatementAttributes({ statementPeriod: value.trim() });
      }

      async function persistResolvedStatementBalance(value: string) {
        const balance = Number(value.replace(/[$,]/g, ""));
        if (!Number.isFinite(balance)) {
          patchForm({ statementAttributeError: "Enter a valid statement balance.", statementAttributeSaveState: "error" });
          return;
        }
        await persistStatementAttributes({ balance });
      }

      async function resolveLine(line: StatementLineState, resolutionType: StatementLineResolutionType) {
        if (!options.onResolveStatementLine) return;
        try {
          const response = await options.onResolveStatementLine(record, line.id, { resolutionType });
          setForm((current) => ({
            ...current,
            lines: getStatementLinesAfterResolution(response),
            reconcile: response?.invoice?.reconcile ?? null,
          }));
          toast.success(`Line ${line.invoiceNumber} resolved`);
        } catch (error) {
          toast.error("Statement line resolution failed", {
            description: mutationErrorMessage(error, "Statement line could not be resolved."),
          });
          throw error;
        }
      }

      async function unresolveLine(line: StatementLineState) {
        if (!options.onUnresolveStatementLine) return;
        try {
          const response = await options.onUnresolveStatementLine(record, line.id);
          setForm((current) => ({
            ...current,
            lines: getStatementLinesAfterResolution(response),
            reconcile: response?.invoice?.reconcile ?? null,
          }));
          toast.success(`Line ${line.invoiceNumber} reopened`);
        } catch (error) {
          toast.error("Statement line resolution failed", {
            description: mutationErrorMessage(error, "Statement line could not be reopened."),
          });
          throw error;
        }
      }

      async function addLine() {
        const { payload, error } = parseStatementLinePayload(form);
        if (error || !payload) {
          patchForm({ addLineError: error });
          return;
        }
        if (!options.onAddStatementLine) {
          patchForm({ addLineError: "Add-line endpoint is unavailable." });
          return;
        }

        patchForm({ addingLine: true, addLineError: null });
        const submittedDraft = {
          invoiceNumber: form.newLineInvoiceNumber,
          date: form.newLineDate,
          amount: form.newLineAmount,
        };
        try {
          const response = await options.onAddStatementLine(record, payload);
          setForm((current) => ({
            ...current,
            lines: getStatementLinesAfterAdd(response),
            reconcile: response?.invoice?.reconcile ?? null,
            ...(current.newLineInvoiceNumber === submittedDraft.invoiceNumber ? { newLineInvoiceNumber: "" } : {}),
            ...(current.newLineDate === submittedDraft.date ? { newLineDate: "" } : {}),
            ...(current.newLineAmount === submittedDraft.amount ? { newLineAmount: "" } : {}),
            addLineError: null,
            addingLine: false,
          }));
          toast.success("Statement line added", {
            description: `${payload.invoiceNumber} queued for rematch.`,
          });
        } catch (error) {
          patchForm({
            addingLine: false,
            addLineError: mutationErrorMessage(error, "Statement line could not be added."),
          });
        }
      }

      async function updateLine(
        lineId: string,
        payload: UpdateStatementLinePayload,
        line: StatementLineState,
      ) {
        if (!options.onUpdateStatementLine) return;
        try {
          const response = await options.onUpdateStatementLine(record, lineId, payload);
          setForm((current) => ({
            ...current,
            lines: getStatementLinesAfterUpdate(response),
            reconcile: response?.invoice?.reconcile ?? null,
          }));
          const updatedLine = response?.updatedLine;
          if (updatedLine && updatedLine.status !== line.matchState) {
            toast.success(`Line ${updatedLine.invoiceNumber} now ${getStatementLineStatusLabel(updatedLine.status)}`, {
              description: "Statement matching was refreshed.",
            });
          }
        } catch (error) {
          const message = getStatementLineMutationError(error);
          toast.error("Statement line update failed", {
            description: message,
          });
          throw new Error(message);
        }
      }

      async function deleteLine(line: StatementLineState) {
        if (!options.onDeleteStatementLine) return;
        try {
          const response = await options.onDeleteStatementLine(record, line.id);
          setForm((current) => ({
            ...current,
            lines: getStatementLinesAfterDelete(response),
            reconcile: response?.invoice?.reconcile ?? null,
          }));
          toast.success("Statement line removed", {
            description: `${line.invoiceNumber} was removed from the statement.`,
          });
        } catch (error) {
          const message = getStatementLineMutationError(error);
          toast.error("Statement line remove failed", {
            description: message,
          });
          throw new Error(message);
        }
      }

      async function rematchLines() {
        if (!options.onRematchStatementLines || form.lines.length === 0 || form.rematchingLines || options.rematchStatementLinesPending) return;
        patchForm({ rematchingLines: true, rematchError: null });
        try {
          const response = await options.onRematchStatementLines(record);
          setForm((current) => ({
            ...current,
            lines: getStatementLinesAfterRematch(response),
            reconcile: response?.invoice?.reconcile ?? null,
            rematchingLines: false,
          }));
          toastStatusChanges(response?.statusChanges ?? [], "No changes - statuses current.");
        } catch (error) {
          const message = mutationErrorMessage(error, "Statement lines could not be checked.");
          patchForm({ rematchingLines: false, rematchError: message });
          toast.error("Re-check lines failed", {
            description: message,
          });
        }
      }

      const draft: StatementAddLineDraft = {
        invoiceNumber: form.newLineInvoiceNumber,
        date: form.newLineDate,
        amount: form.newLineAmount,
        error: form.addLineError,
        pending: form.addingLine,
      };

      const reconcileAction: DocumentAction = {
        id: "reconcile-statement",
        label: form.reconciled ? "Reconciled" : "Reconcile Invoices",
        icon: form.reconciled ? CheckCircle2 : ListChecks,
        disabled: form.reconciled || form.reconciling || Boolean(options.reconcilePending) || !canReconcile || !options.onReconcile,
        pending: form.reconciling || options.reconcilePending,
        onClick: reconcileStatement,
      };
      const shelveAction: DocumentAction = {
        id: "shelve-statement",
        label: "Shelve",
        icon: Archive,
        disabled: form.filed || form.filing || Boolean(options.filePending) || !options.onFileDocument,
        pending: form.filing || options.filePending,
        onClick: shelveStatement,
      };
      const primaryAction = !form.reconciled && !form.filed && !canReconcile
        ? shelveAction
        : reconcileAction;
      const statementLineAlerts = reconciliationBlockers.map((blocker, index) => {
        const line = blocker.lineId
          ? form.lines.find((candidate) => candidate.id === blocker.lineId)
          : undefined;
        const resolutionType: StatementLineResolutionType | null = line?.matchState === "amount_differs"
          ? "use_ap_amount"
          : line?.matchState === "not_received"
            ? "accept_line"
            : null;
        const actionLabel = line?.matchState === "amount_differs" ? "Accept AP" : "Add to AP";
        return {
          id: `statement-reconcile-${blocker.lineId ?? index}`,
          sectionId: "lines",
          tone: "warn" as const,
          label: line?.invoiceNumber ?? "Statement line unresolved",
          detail: blocker.message,
          icon: AlertTriangle,
          ...(line && resolutionType ? {
            action: {
              id: `resolve-${line.id}`,
              label: actionLabel,
              onClick: async () => {
                try {
                  await resolveLine(line, resolutionType);
                } catch {
                  // resolveLine owns the user-facing toast; the served blocker stays visible.
                }
              },
            },
          } : {}),
        };
      });

      return {
        header: {
          kindLabel: "Statement",
          title: vendorName,
          subtitle: record.file,
          statusLabel: form.reconciled ? "Reconciled" : form.filed ? "Shelved" : canReconcile ? "Ready to reconcile" : `${stats.cleared}/${stats.total} matched`,
          statusTone: form.filed || form.reconciled || canReconcile ? "ok" : "warn",
          readyLabel: form.reconciled ? "Reconciled" : form.filed ? "Shelved" : "Ready",
        },
        alerts: [
          ...(form.reconcileError ? [{
            id: "statement-reconcile-error",
            sectionId: "lines",
            tone: "bad" as const,
            label: "Reconciliation failed",
            detail: form.reconcileError,
            icon: AlertTriangle,
          }] : []),
          ...(form.vendorUpdateError ? [{
            id: "statement-vendor-update-error",
            sectionId: "summary",
            tone: "bad" as const,
            label: "Vendor update failed",
            detail: form.vendorUpdateError,
            icon: AlertTriangle,
          }] : []),
          ...(form.rematchError ? [{
            id: "statement-rematch-error",
            sectionId: "lines",
            tone: "bad" as const,
            label: "Re-check lines failed",
            detail: form.rematchError,
            icon: AlertTriangle,
          }] : []),
          ...statementLineAlerts,
        ],
        sections: [
          {
            id: "summary",
            title: "Account Summary",
            icon: BookText,
            children: (
              <div className="space-y-3">
                <StatementDetailsFields
                  vendorCode={form.vendorCode}
                  vendorName={vendorName}
                  vendorManual={Boolean(form.vendorCode) && form.vendorCode !== initialVendorCode}
                  statementPeriod={form.statementPeriod}
                  statementBalance={form.statementBalance}
                  statementPeriodSource={form.statementAttributes?.statementPeriod.source ?? null}
                  statementBalanceSource={form.statementAttributes?.balance.source ?? null}
                  canEditStatementAttributes={Boolean(options.canEditStatementAttributes && options.onUpdateStatementAttributes)}
                  statementAttributeError={form.statementAttributeError}
                  statementAttributeSaveState={form.statementAttributeSaveState}
                  onVendorCodeChange={(vendorCode) => void updateVendorCode(vendorCode)}
                  onStatementPeriodChange={(statementPeriod) => patchForm({ statementPeriod, statementAttributeError: null, statementAttributeSaveState: "idle" })}
                  onStatementPeriodBlur={(statementPeriod) => void persistStatementPeriod(statementPeriod)}
                  onStatementBalanceChange={(statementBalance) => patchForm({ statementBalance, statementAttributeError: null, statementAttributeSaveState: "idle" })}
                  onStatementBalanceBlur={(statementBalance) => void persistResolvedStatementBalance(statementBalance)}
                />
                <StatementLineRollup stats={stats} />
              </div>
            ),
          },
          {
            id: "lines",
            title: "Statement Lines",
            icon: ListChecks,
            flagged: reconciliationBlockers.length > 0,
            children: (
              <StatementLinesPanel
                lines={form.lines}
                draft={draft}
                onResolveLine={resolveLine}
                onUnresolveLine={unresolveLine}
                onDraftChange={(patch) => patchForm({
                  newLineInvoiceNumber: patch.invoiceNumber ?? form.newLineInvoiceNumber,
                  newLineDate: patch.date ?? form.newLineDate,
                  newLineAmount: patch.amount ?? form.newLineAmount,
                  addLineError: patch.error === undefined ? null : patch.error,
                  addingLine: patch.pending ?? form.addingLine,
                })}
                onAddLine={addLine}
                canManageLines={Boolean(options.onAddStatementLine)}
                vendorCode={form.vendorCode}
                onEditLine={options.onUpdateStatementLine ? updateLine : undefined}
                onDeleteLine={options.onDeleteStatementLine ? deleteLine : undefined}
                onRecheckLines={options.onRematchStatementLines ? rematchLines : undefined}
                recheckPending={form.rematchingLines || Boolean(options.rematchStatementLinesPending)}
                extractionFailed={Boolean(record.error)}
              />
            ),
          },
        ],
        primaryAction,
        secondaryActions: [
          ...(options.secondaryActions ?? []),
          {
            id: "reconcile-statement-menu",
            label: form.reconciled ? "Reconciled" : "Reconcile Invoices",
            icon: form.reconciled ? CheckCircle2 : ListChecks,
            tone: "neutral",
            disabled: form.reconciled || form.reconciling || Boolean(options.reconcilePending) || !canReconcile || !options.onReconcile,
            pending: form.reconciling || options.reconcilePending,
            onClick: reconcileStatement,
          },
        ],
      };
    },
  };
}
