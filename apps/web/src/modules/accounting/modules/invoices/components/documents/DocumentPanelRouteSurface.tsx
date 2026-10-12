"use client";

import type { ReactNode } from "react";

import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import { DocumentClassificationControl } from "@/modules/accounting/modules/invoices/components/documents/DocumentClassificationControl";
import { DocumentAttachmentDropZone } from "@/modules/accounting/modules/invoices/components/documents/DocumentAttachmentDropZone";
import { FlagToggleGlyph } from "@/modules/accounting/modules/invoices/components/documents/FlagToggleGlyph";
import {
  useDocumentPanelRouteSpecs,
} from "@/modules/accounting/modules/invoices/components/documents/documentPanelRouteSpecs";
import type { DocumentPanelShortcutAction } from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";
import { DEFAULT_MAPPINGS } from "@/modules/accounting/modules/invoices/hooks/queries";
import { getOpensAs, getSurface } from "@/modules/accounting/modules/invoices/lib/documentRouting";
import type {
  AddStatementLinePayload,
  AddStatementLineResponse,
  AuditEntry,
  ClassificationInfo,
  DeleteStatementLineResponse,
  InvoiceUpdatePayload,
  RematchStatementLinesResponse,
  ReconcileDocumentResponse,
  ResolveStatementLinePayload,
  StatementLineResolutionResponse,
  UpdateStatementLinePayload,
  UpdateStatementLineResponse,
  UploadCoiToSpectrumPayload,
  UploadCoiToSpectrumResponse,
} from "@/modules/accounting/modules/invoices/types/api";
import type {
  DocumentAction,
  DocumentFormState,
  DocumentFilingMeta,
  DocumentFilingResult,
  DocumentPanelNavigation,
  DocumentPanelUndoControl,
  DocumentSpecDefinition,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { CollaborationRouteFamily } from "@/modules/accounting/modules/invoices/hooks/collaborationRoutes";
import { getCollaborationState } from "@/modules/accounting/modules/invoices/components/activity/collaborationState";
import { requestCollaborationCompose } from "@/modules/accounting/modules/invoices/components/activity/ActivityPanel";
import { useDocumentPanelKeyboardShortcuts } from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";
import { useRef } from "react";

const EMPTY_DOCUMENT_ACTIONS: readonly DocumentAction[] = [];

export interface DocumentPanelRouteSurfaceProps {
  record: Invoice;
  /** Soft-deleted global-search entries render as inspection-only. */
  readOnly?: boolean;
  splitDocumentAction?: DocumentAction;
  className?: string;
  classifications?: readonly ClassificationInfo[];
  allowInvoiceClassification?: boolean;
  auditEntries?: readonly AuditEntry[];
  serverBackedActivity?: boolean;
  canComment?: boolean;
  canEmail?: boolean;
  unreadReplies?: number;
  unreadComments?: number;
  onActivityViewed?: (state: { unreadReplies: number; unreadComments: number }) => void;
  focusSignal?: number;
  routeFamily?: CollaborationRouteFamily;
  navigation?: DocumentPanelNavigation;
  onReclassify?: (classification: string) => void;
  reclassifyPending?: boolean;
  reclassifyDisabled?: boolean;
  onDiscard?: (record: Invoice) => void;
  discardPending?: boolean;
  discardDisabled?: boolean;
  onFile?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onFileToProject?: (record: Invoice, meta?: DocumentFilingMeta) => DocumentFilingResult | Promise<DocumentFilingResult>;
  onUpdateDocument?: (record: Invoice, payload: InvoiceUpdatePayload) => Invoice | void | Promise<Invoice | void>;
  filePending?: boolean;
  fileToProjectPending?: boolean;
  onReconcile?: (record: Invoice) => ReconcileDocumentResponse | Promise<ReconcileDocumentResponse>;
  reconcilePending?: boolean;
  onAddStatementLine?: (record: Invoice, payload: AddStatementLinePayload) => AddStatementLineResponse | Promise<AddStatementLineResponse>;
  onUpdateStatementLine?: (record: Invoice, lineId: string, payload: UpdateStatementLinePayload) => UpdateStatementLineResponse | Promise<UpdateStatementLineResponse>;
  onDeleteStatementLine?: (record: Invoice, lineId: string) => DeleteStatementLineResponse | Promise<DeleteStatementLineResponse>;
  onRematchStatementLines?: (record: Invoice) => RematchStatementLinesResponse | Promise<RematchStatementLinesResponse>;
  onResolveStatementLine?: (record: Invoice, lineId: string, payload: ResolveStatementLinePayload) => StatementLineResolutionResponse | Promise<StatementLineResolutionResponse>;
  onUnresolveStatementLine?: (record: Invoice, lineId: string) => StatementLineResolutionResponse | Promise<StatementLineResolutionResponse>;
  rematchStatementLinesPending?: boolean;
  onUploadToSpectrum?: (record: Invoice, payload: UploadCoiToSpectrumPayload) => UploadCoiToSpectrumResponse | void | Promise<UploadCoiToSpectrumResponse | void>;
  uploadToSpectrumPending?: boolean;
  onViewDocument?: (record: Invoice) => void;
  onLienWaiverLinkComplete?: (record: Invoice) => void;
  extraSecondaryActions?: readonly DocumentAction[];
  undoControl?: DocumentPanelUndoControl;
  onRegisterPendingSave?: (handler: (() => Promise<void>) | null) => void;
  onPrimaryActionChange?: (action: DocumentPanelShortcutAction | null) => void;
}

export function DocumentPanelRouteSurface({
  record,
  readOnly = false,
  splitDocumentAction,
  className,
  classifications,
  allowInvoiceClassification,
  auditEntries,
  serverBackedActivity = false,
  canComment = false,
  canEmail = false,
  unreadReplies = 0,
  unreadComments = 0,
  onActivityViewed,
  focusSignal = 0,
  routeFamily = "document",
  navigation,
  onReclassify,
  reclassifyPending,
  reclassifyDisabled,
  onDiscard,
  discardPending,
  discardDisabled,
  onFile,
  onFileToProject,
  onUpdateDocument,
  filePending,
  fileToProjectPending,
  onReconcile,
  reconcilePending,
  onAddStatementLine,
  onUpdateStatementLine,
  onDeleteStatementLine,
  onRematchStatementLines,
  onResolveStatementLine,
  onUnresolveStatementLine,
  rematchStatementLinesPending,
  onUploadToSpectrum,
  uploadToSpectrumPending,
  onViewDocument,
  onLienWaiverLinkComplete,
  extraSecondaryActions = EMPTY_DOCUMENT_ACTIONS,
  undoControl,
  onRegisterPendingSave,
  onPrimaryActionChange,
}: DocumentPanelRouteSurfaceProps) {
  const shortcutRef = useRef(null);
  useDocumentPanelKeyboardShortcuts({
    primaryActionRef: shortcutRef,
    undoAction: null,
    previousAction: null,
    nextAction: null,
    downloadAction: { label: "Download PDF", available: () => Boolean(document.querySelector("a[download]")), run: () => document.querySelector<HTMLAnchorElement>("a[download]")?.click() },
    commentAction: canComment ? { label: "Comment", run: () => requestCollaborationCompose(record.id, "comment") } : null,
    replyAction: canEmail ? { label: "Reply", run: () => requestCollaborationCompose(record.id, "reply") } : null,
    forwardAction: canEmail ? { label: "Forward", run: () => requestCollaborationCompose(record.id, "forward") } : null,
  });
  const {
    panelNavigation,
    receiptSpec,
    statementSpec,
    coiSpec,
    w9Spec,
    otherSpec,
    simpleFilingSpec,
    subcontractSpec,
    warrantySpec,
    lienWaiverSpec,
  } = useDocumentPanelRouteSpecs({
    record,
    splitDocumentAction: readOnly ? undefined : splitDocumentAction,
    classifications,
    navigation: readOnly ? undefined : navigation,
    onReclassify: readOnly ? undefined : onReclassify,
    reclassifyPending,
    reclassifyDisabled,
    onDiscard: readOnly ? undefined : onDiscard,
    discardPending,
    discardDisabled,
    onFile: readOnly ? undefined : onFile,
    onFileToProject: readOnly ? undefined : onFileToProject ?? onFile,
    onUpdateDocument: readOnly ? undefined : onUpdateDocument,
    filePending,
    fileToProjectPending: fileToProjectPending ?? filePending,
    onReconcile: readOnly ? undefined : onReconcile,
    reconcilePending,
    onAddStatementLine: readOnly ? undefined : onAddStatementLine,
    onUpdateStatementLine: readOnly ? undefined : onUpdateStatementLine,
    onDeleteStatementLine: readOnly ? undefined : onDeleteStatementLine,
    onRematchStatementLines: readOnly ? undefined : onRematchStatementLines,
    onResolveStatementLine: readOnly ? undefined : onResolveStatementLine,
    onUnresolveStatementLine: readOnly ? undefined : onUnresolveStatementLine,
    rematchStatementLinesPending,
    onUploadToSpectrum: readOnly ? undefined : onUploadToSpectrum,
    uploadToSpectrumPending,
    onViewDocument: readOnly ? undefined : onViewDocument,
    onLienWaiverLinkComplete: readOnly ? undefined : onLienWaiverLinkComplete,
  });

  const leadingContent: ReactNode = (
    <div className="flex flex-wrap items-center gap-2">
      <DocumentClassificationControl
        record={record}
        classifications={classifications}
        allowInvoiceClassification={allowInvoiceClassification}
        disabled={readOnly || reclassifyDisabled}
        pending={reclassifyPending}
        onReclassify={readOnly ? undefined : onReclassify}
      />
      {!readOnly && <FlagToggleGlyph record={record} shortcutEnabled />}
    </div>
  );
  const collaborationState = getCollaborationState(record, { readOnly });
  const panelProps = {
    record,
    actions: readOnly ? EMPTY_DOCUMENT_ACTIONS : extraSecondaryActions,
    className,
    emailSupplement: readOnly ? undefined : <DocumentAttachmentDropZone record={record} />,
    leadingContent,
    navigation: panelNavigation,
    undoControl: readOnly ? undefined : undoControl,
    onRegisterPendingSave: readOnly ? undefined : onRegisterPendingSave,
    onPrimaryActionChange: readOnly ? undefined : onPrimaryActionChange,
    auditEntries: auditEntries ?? [],
    serverBackedActivity,
    canComment,
    canEmail,
    readOnly: collaborationState.readOnly,
    isTrash: collaborationState.isTrash,
    lockedReason: collaborationState.lockedReason,
    unreadReplies,
    unreadComments,
    onActivityViewed,
    focusSignal,
    routeFamily,
  };
  // Route specs contain classification-specific controls (for example COI
  // overrides) that do not all flow through the route callbacks above. A
  // disabled fieldset is the final DOM-level mutation gate for this
  // inspection-only surface, including those wrapped controls.
  const renderPanel = <TFormState extends DocumentFormState>(spec: DocumentSpecDefinition<Invoice, TFormState>) => {
    const panel = <DocumentPanel {...panelProps} spec={spec} />;
    return readOnly
      ? <fieldset disabled className="contents" aria-label="Read-only document">{panel}</fieldset>
      : panel;
  };
  const opensAs = getOpensAs(record.classification, classifications ?? DEFAULT_MAPPINGS);

  if (opensAs === "receipt") {
    return renderPanel(receiptSpec);
  }

  if (opensAs === "statement") {
    return renderPanel(statementSpec);
  }

  if (opensAs === "coi") {
    return renderPanel(coiSpec);
  }

  if (opensAs === "w9") {
    return renderPanel(w9Spec);
  }

  if (opensAs === "subcontract") {
    return renderPanel(subcontractSpec);
  }

  if (opensAs === "warranty") {
    return renderPanel(warrantySpec);
  }

  if (opensAs === "lien-waiver") {
    return renderPanel(lienWaiverSpec);
  }

  if (getSurface(opensAs) === "generic_panel") {
    return renderPanel(otherSpec);
  }

  return renderPanel(simpleFilingSpec);
}
