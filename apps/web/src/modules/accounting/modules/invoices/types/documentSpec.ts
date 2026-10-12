import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { LucideIcon } from "lucide-react";

import type { FileDocumentResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { ClassificationType } from "@/modules/accounting/modules/invoices/types/invoice";

export type DocumentTone = "neutral" | "info" | "ok" | "warn" | "bad";
export type DocumentActionTone = "primary" | "neutral" | "destructive";
export type DocumentRendererMode = "scroll" | "tabs" | "checklist";
export type DocumentTabStyle = "compact" | "invoice-detail";
export type DocumentMatchState = "matched" | "missing" | "diff" | "neutral";
export type DocumentChecklistState = "done" | "warning" | "blocked" | "todo";
export type DocumentFormState = Record<string, unknown>;

/** Filing metadata forwarded to POST /api/invoices/:id/file (2026-07-01) */
export interface DocumentFilingMeta {
  destination?: string;
  /** Drive-relative absolute folder path for direct upload (bypasses job folder resolution) */
  destinationAbsolute?: string;
  /** Confirmation of the server-authoritative SharePoint filename candidate. */
  filename?: string;
  note?: string;
  holdReason?: string;
  uploadToSharePoint?: boolean;
}

export type DocumentFilingResult = FileDocumentResponse | void;

export interface DocumentAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  tone?: DocumentActionTone;
  disabled?: boolean;
  disabledReason?: string;
  pending?: boolean;
  onClick: () => void | Promise<void>;
}

export interface DocumentPanelNavigation {
  canSkip?: boolean;
  onSkip?: () => void;
  onDiscard?: () => void;
  discardDisabled?: boolean;
  discardPending?: boolean;
}

export interface DocumentPanelUndoControl {
  label?: string;
  disabled: boolean;
  pending?: boolean;
  tooltip: string;
  onUndo?: () => void | Promise<void>;
}

export interface DocumentPanelHeader {
  kindLabel: string;
  title: string;
  subtitle?: string;
  statusLabel?: string;
  statusTone?: DocumentTone;
  statusPulse?: boolean;
  externalStatusLabel?: string;
  externalStatusTone?: DocumentTone;
  externalStatusPulse?: boolean;
  readyLabel?: string;
}

export interface DocumentTab {
  id: string;
  label: string;
  icon?: LucideIcon;
}

export interface DocumentSection {
  id: string;
  title: string;
  icon?: LucideIcon;
  tabId?: string;
  flagged?: boolean;
  flagIndicator?: "dot";
  action?: ReactNode;
  children: ReactNode;
}

export interface DocumentAlert {
  id: string;
  tone: Exclude<DocumentTone, "neutral">;
  label: string;
  detail?: string;
  icon?: LucideIcon;
  action?: DocumentAction;
  /** Associates this unresolved item with a document-panel tab badge. */
  tabId?: string;
  /** The section holding the fix; "Review details" scrolls it into view. */
  sectionId?: string;
  /** A `data-document-field-id` inside the section that receives focus; otherwise the first invalid field. */
  fieldId?: string;
  /** Purely informational: offers "Dismiss" even when the alert has a review target. Never set on blockers. */
  dismissible?: boolean;
  /** Waiting rows remain visible but use the shared blue waiting treatment. */
  waiting?: boolean;
}

export interface DocumentChecklistItem {
  id: string;
  label: string;
  hint?: string;
  sectionId?: string;
  state: DocumentChecklistState;
}

export interface DocumentKeyValueRow {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

export interface DocumentSpecOutput {
  header: DocumentPanelHeader;
  sections: DocumentSection[];
  preferredRenderer?: DocumentRendererMode;
  tabs?: DocumentTab[];
  tabStyle?: DocumentTabStyle;
  alerts?: DocumentAlert[];
  checklist?: DocumentChecklistItem[];
  primaryAction?: DocumentAction;
  secondaryActions?: DocumentAction[];
  footerNote?: string;
  isFallback?: boolean;
}

export interface DocumentSpecContext<TRecord, TFormState extends DocumentFormState> {
  record: TRecord;
  form: TFormState;
  setForm: Dispatch<SetStateAction<TFormState>>;
  patchForm: (patch: Partial<TFormState>) => void;
}

export interface DocumentSpecDefinition<TRecord, TFormState extends DocumentFormState> {
  id: string;
  label: string;
  classifications?: readonly ClassificationType[];
  fallback?: boolean;
  initForm: (record: TRecord) => TFormState;
  build: (context: DocumentSpecContext<TRecord, TFormState>) => DocumentSpecOutput;
  flushPendingChanges?: (context: DocumentSpecContext<TRecord, TFormState>) => void | Promise<void>;
}

export interface DocumentChecklistProgress {
  total: number;
  done: number;
  remaining: number;
}

export function isDocumentActionDisabled(
  action: Pick<DocumentAction, "disabled" | "pending"> | null | undefined,
): boolean {
  return Boolean(action?.disabled || action?.pending);
}

/** "Review details" has somewhere to go only when the alert names a section or tab. */
export function hasDocumentAlertTarget(alert: Pick<DocumentAlert, "sectionId" | "tabId">): boolean {
  return Boolean(alert.sectionId || alert.tabId);
}

/** Opted-in notifications, and any alert with neither an action nor a review target, can be dismissed. */
export function isDocumentAlertDismissible(alert: Pick<DocumentAlert, "action" | "dismissible" | "sectionId" | "tabId">): boolean {
  return Boolean(alert.dismissible) || (!alert.action && !hasDocumentAlertTarget(alert));
}

/** A notice, not a blocker: dismissible under the rule above and not a waiting row. Drives the info tone and "To review". */
export function isDocumentAlertNotice(alert: Pick<DocumentAlert, "action" | "dismissible" | "sectionId" | "tabId" | "waiting">): boolean {
  return !alert.waiting && isDocumentAlertDismissible(alert);
}

/** True when there is at least one item and every item is a notice. Callers pass anything else (e.g. panel notices) as non-notices. */
export function isNoticeOnly(items: readonly { notice?: boolean }[]): boolean {
  return items.length > 0 && items.every((item) => item.notice === true);
}

/** Like `PanelNotice.revision`: a dismissal holds only while the alert's content is unchanged. */
export function getDocumentAlertRevision(alert: Pick<DocumentAlert, "id" | "label" | "detail">): string {
  return JSON.stringify([alert.id, alert.label, alert.detail ?? ""]);
}

export function getDocumentChecklistProgress(
  items: readonly DocumentChecklistItem[],
): DocumentChecklistProgress {
  const done = items.filter((item) => item.state === "done").length;
  return {
    total: items.length,
    done,
    remaining: Math.max(items.length - done, 0),
  };
}
