"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";

import { DocumentPanelRenderer } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanelRenderer";
import { createFallbackDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/fallbackDocumentSpec";
import type { DocumentPanelShortcutAction } from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";
import { useDocSpec } from "@/modules/accounting/modules/invoices/hooks/useDocSpec";
import type { AuditEntry } from "@/modules/accounting/modules/invoices/types/api";
import type { CollaborationRouteFamily } from "@/modules/accounting/modules/invoices/hooks/collaborationRoutes";
import type {
  DocumentAction,
  DocumentFormState,
  DocumentPanelNavigation,
  DocumentPanelUndoControl,
  DocumentSpecDefinition,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import { cn } from "@/modules/shared/lib/utils";

interface DocumentPanelShellProps {
  record: Invoice;
  actions?: readonly DocumentAction[];
  className?: string;
  leadingContent?: ReactNode;
  emailSupplement?: ReactNode;
  navigation?: DocumentPanelNavigation;
  undoControl?: DocumentPanelUndoControl;
  onRegisterPendingSave?: (handler: (() => Promise<void>) | null) => void;
  onPrimaryActionChange?: (action: DocumentPanelShortcutAction | null) => void;
  auditEntries?: readonly AuditEntry[];
  serverBackedActivity?: boolean;
  canComment?: boolean;
  canEmail?: boolean;
  readOnly?: boolean;
  isTrash?: boolean;
  lockedReason?: string;
  unreadReplies?: number;
  unreadComments?: number;
  onActivityViewed?: (state: { unreadReplies: number; unreadComments: number }) => void;
  focusSignal?: number;
  routeFamily?: CollaborationRouteFamily;
}

interface DocumentPanelWithSpecProps<TFormState extends DocumentFormState> extends DocumentPanelShellProps {
  spec: DocumentSpecDefinition<Invoice, TFormState>;
}

interface DocumentPanelProps<TFormState extends DocumentFormState> extends DocumentPanelShellProps {
  spec?: DocumentSpecDefinition<Invoice, TFormState>;
}

function getDocumentPanelRecordKey(record: Invoice): string {
  return [
    record.id,
    record.classification,
    record.filed ? "filed" : "unfiled",
    record.filedAt ?? "",
    record.filedDestination ?? "",
    record.filingNote ?? "",
    record.holdReason ?? "",
    record.spFileUrl ?? "",
    record.sharePointItemId ?? "",
    record.sharePointFilename ?? "",
    record.reconciled ? "reconciled" : "unreconciled",
    record.reconciledAt ?? "",
    ...(record.statementAttributes ? [
      record.statementAttributes.statementPeriod.value ?? "",
      record.statementAttributes.statementPeriod.source ?? "",
      String(record.statementAttributes.balance.value ?? ""),
      record.statementAttributes.balance.source ?? "",
    ] : ["statement-attributes-unavailable"]),
    ...(record.reconcile ? [
      record.reconcile.canReconcile ? "can-reconcile" : "cannot-reconcile",
      record.reconcile.permittedActions.join(","),
      ...record.reconcile.blockers.map((blocker) => `${blocker.code}:${blocker.lineId ?? ""}:${blocker.message}`),
    ] : ["reconcile-unavailable"]),
    record.waiverOnDocument ? "waiver-on-document" : "waiver-clear",
    record.waiverAutoLinkSkipReason ?? "waiver-auto-link-skip-reason-unavailable",
    record.linkedLienWaiverId ?? "",
    record.lienWaiverRequired === true ? "waiver-required" : record.lienWaiverRequired === false ? "waiver-not-required" : "waiver-required-unknown",
    record.lienWaiverStatus ?? "waiver-status-unavailable",
    ...(record.classification === "coi" ? [
      record.compliance?.vendorCode.value ?? "",
      record.compliance?.expiration.value.expirationDate ?? "",
    ] : []),
    ...(record.coiOverrides ?? []).map((override) => `${override.checkId}:${override.id}:${override.revokedAt ?? "active"}`),
  ].join("|");
}

function DocumentPanelInner<TFormState extends DocumentFormState>({
  record,
  actions,
  spec,
  className,
  leadingContent,
  emailSupplement,
  navigation,
  undoControl,
  onRegisterPendingSave,
  onPrimaryActionChange,
  auditEntries,
  serverBackedActivity,
  canComment,
  canEmail,
  readOnly,
  isTrash,
  lockedReason,
  unreadReplies,
  unreadComments,
  onActivityViewed,
  focusSignal,
  routeFamily,
}: DocumentPanelWithSpecProps<TFormState>) {
  const docSpec = useDocSpec({
    spec,
    record,
    // Candidate-only refetches must refresh clean filename drafts. Keep this
    // opt-in so Receipt/fallback and non-filing panels retain their lifecycle.
    recordKey: JSON.stringify([
      getDocumentPanelRecordKey(record),
      ...(["other-document", "warranty-document", "subcontract-document", "lien-waiver-document"].includes(spec.id)
        ? [record.filing?.fileName?.value ?? ""] : []),
    ]),
    recordId: record.id,
  });
  const { output } = docSpec;

  useEffect(() => {
    onRegisterPendingSave?.(docSpec.flushPendingChanges);
    return () => onRegisterPendingSave?.(null);
  }, [docSpec.flushPendingChanges, onRegisterPendingSave]);

  return (
    <section className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <DocumentPanelRenderer
        key={record.id}
        documentId={record.id}
        output={output}
        actions={actions}
        navigation={navigation}
        undoControl={undoControl}
        leadingContent={leadingContent}
        email={record.email}
        emailSupplement={emailSupplement}
        onPrimaryActionChange={onPrimaryActionChange}
        auditEntries={auditEntries}
        serverBackedActivity={serverBackedActivity}
        canComment={canComment}
        canEmail={canEmail}
        readOnly={readOnly}
        isTrash={isTrash}
        lockedReason={lockedReason}
        unreadReplies={unreadReplies}
        unreadComments={unreadComments}
        onActivityViewed={onActivityViewed}
        focusSignal={focusSignal}
        routeFamily={routeFamily}
      />
    </section>
  );
}

export function DocumentPanel<TFormState extends DocumentFormState>({
  spec,
  ...props
}: DocumentPanelProps<TFormState>) {
  const fallbackSpec = useMemo(() => createFallbackDocumentSpec(), []);
  if (spec) {
    return <DocumentPanelInner {...props} spec={spec} />;
  }
  return <DocumentPanelInner {...props} spec={fallbackSpec} />;
}
