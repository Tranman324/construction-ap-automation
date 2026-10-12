"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useUndoInvoiceAction } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { useInvoiceActions } from "@/modules/accounting/modules/invoices/hooks/queries";
import type {
  InvoiceActionMetadata,
  InvoiceUndoableAction,
  UndoActionResponse,
  UndoActionErrorCode,
} from "@/modules/accounting/modules/invoices/types/api";
import type { DocumentPanelUndoControl } from "@/modules/accounting/modules/invoices/types/documentSpec";
import { toast } from "@/modules/shared/components/ui/toaster";
import { isApiError } from "@/modules/shared/lib/api";

interface UseDocumentPanelUndoOptions {
  enabled?: boolean;
}

interface UndoFailureToast {
  title: string;
  description: string;
}

export interface RecentUndoTarget {
  invoiceId: string;
  actionId: string;
  timestamp: string;
  description: string;
  targetLabel?: string;
}

interface UseRecentDocumentUndoOptions {
  onUndoSuccess?: (target: RecentUndoTarget, data: UndoActionResponse) => void;
}

const MAX_RECENT_UNDO_TARGETS = 5;
export const UNDO_WINDOW_MS = 300_000;
let recentDocumentUndoTargets: RecentUndoTarget[] = [];
const recentDocumentUndoListeners = new Set<() => void>();

function getRecentDocumentUndoSnapshot(): RecentUndoTarget[] {
  const activeTargets = recentDocumentUndoTargets.filter((target) => !isUndoTargetExpired(target.timestamp));
  if (activeTargets.length !== recentDocumentUndoTargets.length) {
    recentDocumentUndoTargets = activeTargets;
  }
  return recentDocumentUndoTargets;
}

function subscribeRecentDocumentUndo(listener: () => void): () => void {
  recentDocumentUndoListeners.add(listener);
  return () => recentDocumentUndoListeners.delete(listener);
}

function setRecentDocumentUndoTargets(
  updater: (current: RecentUndoTarget[]) => RecentUndoTarget[],
): void {
  recentDocumentUndoTargets = updater(
    recentDocumentUndoTargets.filter((target) => !isUndoTargetExpired(target.timestamp)),
  )
    .filter((target) => !isUndoTargetExpired(target.timestamp))
    .slice(-MAX_RECENT_UNDO_TARGETS);
  recentDocumentUndoListeners.forEach((listener) => listener());
}

export function __resetRecentDocumentUndoTargetsForTests(): void {
  recentDocumentUndoTargets = [];
  recentDocumentUndoListeners.forEach((listener) => listener());
}

const UNDO_ERROR_CODES = new Set<UndoActionErrorCode | "UNDO_WINDOW_EXPIRED">([
  "ACTION_NOT_FOUND",
  "ALREADY_UNDONE",
  "ACTION_NOT_UNDOABLE",
  "STATE_CHANGED_SINCE_ACTION",
  "UNDO_WINDOW_EXPIRED",
]);

function timestampValue(timestamp: string | null): number {
  if (!timestamp) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function isUndoTargetExpired(timestamp: string | null): boolean {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed > UNDO_WINDOW_MS;
}

function getNewestExpiredUndoableAction(
  actions: readonly InvoiceUndoableAction[] | undefined,
): InvoiceUndoableAction | null {
  return (actions ?? []).reduce<InvoiceUndoableAction | null>((current, action) => {
    if (!action.undoable || action.undoneAt !== null) return current;
    if (!isUndoTargetExpired(action.timestamp)) return current;
    if (!current) return action;
    return timestampValue(action.timestamp) > timestampValue(current.timestamp) ? action : current;
  }, null);
}

export function getCurrentUndoableAction(
  actions: readonly InvoiceUndoableAction[] | undefined,
): InvoiceUndoableAction | null {
  return (actions ?? []).reduce<InvoiceUndoableAction | null>((current, action) => {
    if (!action.undoable || action.undoneAt !== null) return current;
    if (isUndoTargetExpired(action.timestamp)) return current;
    if (!current) return action;
    return timestampValue(action.timestamp) > timestampValue(current.timestamp) ? action : current;
  }, null);
}

function undoStateHasSharePointFile(action: InvoiceUndoableAction): boolean {
  const state = action.afterState;
  return Boolean(
    state &&
    typeof state === "object" &&
    "sp_file_url" in state &&
    typeof state.sp_file_url === "string" &&
    state.sp_file_url.length > 0
  );
}

export function getUndoActionDescription(action: InvoiceUndoableAction): string {
  if (action.type === "invoice.approved") return "Approve";
  if (action.type === "invoice.discarded") return "Discard";
  if (action.type === "invoice.filed") return undoStateHasSharePointFile(action) ? "File to Project" : "Shelve";

  const summary = action.summary?.trim();
  return summary && summary.length > 0 ? summary : action.type;
}

function getUndoSuccessTitle(description: string): string {
  return `${description} undone`;
}

function getUndoControlLabel(description: string): string | undefined {
  return description === "Approve" ? "Undo Approve" : undefined;
}

function getUndoControlTooltip(description: string): string {
  return description === "Approve" ? "Revert to pending." : `Undo: ${description}`;
}

function getUndoSuccessDescription(description: string, targetLabel?: string | null): string {
  const label = targetLabel?.trim();
  if (!label) return `${description} was undone.`;

  if (description === "Discard") return `${label} was restored.`;
  if (description === "Approve") return `${label} was moved back to pending.`;
  if (description === "File to Project") return `${label} was removed from SharePoint and filing state was restored.`;
  if (description === "Shelve") return `${label} was returned to the queue.`;
  return `${description} was undone for ${label}.`;
}

export function getUndoFailureToast(error: unknown): UndoFailureToast {
  const fallback = isApiError(error) ? error.message : "Undo failed. Please refresh and try again.";
  const code = isApiError(error) && UNDO_ERROR_CODES.has(error.code as UndoActionErrorCode)
    ? error.code
    : undefined;

  switch (code) {
    case "UNDO_WINDOW_EXPIRED":
      return {
        title: "Undo window expired",
        description: "Footer undo is available for five minutes after the action.",
      };
    case "STATE_CHANGED_SINCE_ACTION":
      return {
        title: "Undo no longer safe",
        description: "The document changed since that action, so undo is no longer safe.",
      };
    case "ALREADY_UNDONE":
      return {
        title: "Already undone",
        description: "That action has already been undone.",
      };
    case "ACTION_NOT_UNDOABLE":
      return {
        title: "Action cannot be undone",
        description: "That action is not undoable from the footer.",
      };
    case "ACTION_NOT_FOUND":
      return {
        title: "Undo action not found",
        description: "The action could not be found. Refresh the document and try again.",
      };
    default:
      return {
        title: "Undo failed",
        description: fallback,
      };
  }
}

export function useDocumentPanelUndo(
  invoiceId: string,
  options: UseDocumentPanelUndoOptions = {},
): DocumentPanelUndoControl {
  const enabled = Boolean(invoiceId) && (options.enabled ?? true);
  const actionsQuery = useInvoiceActions(invoiceId, { enabled });
  const undoMutation = useUndoInvoiceAction();
  const currentAction = useMemo(
    () => (enabled ? getCurrentUndoableAction(actionsQuery.data?.actions) : null),
    [actionsQuery.data?.actions, enabled],
  );
  const expiredAction = useMemo(
    () => (enabled ? getNewestExpiredUndoableAction(actionsQuery.data?.actions) : null),
    [actionsQuery.data?.actions, enabled],
  );
  const pending = undoMutation.isPending;

  if (!currentAction) {
    const expiredDescription = expiredAction ? getUndoActionDescription(expiredAction) : null;
    return {
      label: expiredDescription ? getUndoControlLabel(expiredDescription) : undefined,
      disabled: true,
      pending,
      tooltip: actionsQuery.isFetching && enabled
        ? "Checking undo history..."
        : expiredAction
          ? "Undo window expired."
          : "There is nothing to undo.",
    };
  }

  const description = getUndoActionDescription(currentAction);
  return {
    label: getUndoControlLabel(description),
    disabled: pending,
    pending,
    tooltip: getUndoControlTooltip(description),
    onUndo: () => {
      if (pending) return;
      undoMutation.mutate(
        { id: invoiceId, actionId: currentAction.id },
        {
          onSuccess: (data) => {
            toast.success(getUndoSuccessTitle(description), {
              description: getUndoSuccessDescription(description, currentAction.target?.label),
            });
            if (data.sharePoint?.warning) {
              toast.warning("SharePoint cleanup warning", {
                description: data.sharePoint.warning,
              });
            }
          },
          onError: (error) => {
            const message = getUndoFailureToast(error);
            toast.error(message.title, { description: message.description });
          },
        },
      );
    },
  };
}

export function useRecentDocumentUndo(
  currentControl: DocumentPanelUndoControl,
  options?: UseRecentDocumentUndoOptions,
) {
  const onUndoSuccess = options?.onUndoSuccess;
  const recentTargets = useSyncExternalStore(
    subscribeRecentDocumentUndo,
    getRecentDocumentUndoSnapshot,
    getRecentDocumentUndoSnapshot,
  );
  const undoMutation = useUndoInvoiceAction();
  const activeRecentTargets = recentTargets.filter((target) => !isUndoTargetExpired(target.timestamp));
  const recentTarget = activeRecentTargets.at(-1) ?? null;

  const rememberAction = useCallback((
    invoiceId: string,
    action: InvoiceActionMetadata | undefined,
    description: string,
    targetLabel?: string,
  ) => {
    const actionId = action?.actionId;
    if (!action?.undoable || !actionId) return;
    const timestamp = action.timestamp ?? new Date().toISOString();
    setRecentDocumentUndoTargets((current) => [
      ...current.filter((target) => target.actionId !== actionId),
      { invoiceId, actionId, timestamp, description, targetLabel },
    ]);
  }, []);

  const clearAction = useCallback((actionId: string) => {
    setRecentDocumentUndoTargets((current) => current.filter((target) => target.actionId !== actionId));
  }, []);

  const undoControl = useMemo<DocumentPanelUndoControl>(() => {
    if (!currentControl.disabled || !recentTarget) return currentControl;

    const pending = undoMutation.isPending;
    return {
      disabled: pending,
      pending,
      tooltip: `Undo: ${recentTarget.description}`,
      onUndo: () => {
        if (pending) return;
        undoMutation.mutate(
          { id: recentTarget.invoiceId, actionId: recentTarget.actionId },
          {
            onSuccess: (data) => {
              clearAction(recentTarget.actionId);
              toast.success(getUndoSuccessTitle(recentTarget.description), {
                description: getUndoSuccessDescription(recentTarget.description, recentTarget.targetLabel),
              });
              if (data.sharePoint?.warning) {
                toast.warning("SharePoint cleanup warning", {
                  description: data.sharePoint.warning,
                });
              }
              onUndoSuccess?.(recentTarget, data);
            },
            onError: (error) => {
              const message = getUndoFailureToast(error);
              toast.error(message.title, { description: message.description });
            },
          },
        );
      },
    };
  }, [clearAction, currentControl, onUndoSuccess, recentTarget, undoMutation]);

  return {
    undoControl,
    rememberAction,
  };
}
