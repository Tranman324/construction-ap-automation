"use client";

import { Suspense, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Activity, BarChart3, Mail, AlertTriangle, Scissors, ShieldCheck } from "lucide-react";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { ClassificationInfo, InvoiceNavItem, InvoiceUpdatePayload } from "@/modules/accounting/modules/invoices/types/api";
import type { DocumentAction, DocumentTone, DocumentPanelUndoControl } from "@/modules/accounting/modules/invoices/types/documentSpec";
import { DEFAULT_MAPPINGS, useDuplicateStatus, useInvoice, useInvoiceNeighbors, useInvoiceEmail, useClassifications, useAuditTrail, usePhaseOptions, useStats, useTrash } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";
import { useAddStatementLine, useDeleteStatementLine, useReclassifyInvoice, useFlagForSplit, useDiscardInvoice, useFileDocument, useReconcileStatement, useRematchStatementLines, useResolveStatementLine, useSaveInvoiceBeforeSpectrumSubmit, useUnapproveInvoice, useUnresolveStatementLine, useUpdateInvoice, useUpdateStatementLine, useUploadCoiToSpectrum } from "@/modules/accounting/modules/invoices/hooks/mutations";
// StatusColor no longer needed — alert pills use inline styles
import { usePermissions } from "@/modules/shared/hooks/usePermissions";
import { isApiError } from "@/modules/shared/lib/api";
import { toast } from "@/modules/shared/components/ui/toaster";

import { Badge } from "@/modules/shared/components/ui/badge";
import { PanelNotice, PanelNoticeProvider, PanelNoticeObserver, type NoticeEntry } from "@/modules/accounting/modules/invoices/components/documents/PanelNotice";
import { Separator } from "@/modules/shared/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";
import {
  ClassificationSelectItem,
  ClassificationSelectValue,
} from "@/modules/accounting/modules/invoices/components/invoices/renderers/ClassificationSelectParts";
import { InvoiceDetailForm, type ApprovalPreview, type InvoiceDetailFormHandle } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailForm";
import { useCreateRuleFromInvoiceAction } from "@/modules/accounting/modules/invoices/components/invoices/CreateRuleFromInvoice";
import { InvoiceActionBar } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceActionBar";
import { InvoiceDetailWorkspace, type InvoiceDetailTab, type InvoiceDetailTabId } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailWorkspace";
import { SpectrumSubmitSection, type ApprovalOverrideValues, type SpectrumSubmitFooterControl } from "@/modules/accounting/modules/invoices/components/invoices/SpectrumSubmitSection";
import { SpectrumSubmitResolveNotice, getSpectrumSubmitResolveIssue } from "@/modules/accounting/modules/invoices/components/invoices/SpectrumSubmitResolveNotice";
import { SpectrumSubmitReturnButton } from "@/modules/accounting/modules/invoices/components/invoices/SpectrumSubmitReturnButton";
import { MultiPhaseAllocationPanel } from "@/modules/accounting/modules/invoices/components/invoices/MultiPhaseAllocationPanel";
import { WaiverPairingSection } from "@/modules/accounting/modules/invoices/components/invoices/WaiverPairingSection";
import { InvoiceResolveTray } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceResolveTray";
import { ActivityPanel, collaborationActionsFor, requestCollaborationCompose, type CollaborationComposeRequest } from "@/modules/accounting/modules/invoices/components/activity/ActivityPanel";
import { hasAllocationAttention, hasMissingWaiverAttention } from "@/modules/accounting/modules/invoices/components/invoices/invoiceDetailPanelState";
import { getInvoiceResolveRows, hasUnresolvedDuplicate, type ClosedPeriodTrayAction } from "@/modules/accounting/modules/invoices/components/invoices/invoiceResolveModel";
import { DuplicateBypassNote } from "@/modules/accounting/modules/invoices/components/invoices/DuplicateBypassNote";
import { SplitProcessingPlaceholder } from "@/modules/accounting/modules/invoices/components/invoices/SplitProcessingPlaceholder";
import { DocumentActionsDropdown } from "@/modules/accounting/modules/invoices/components/documents/DocumentActionsDropdown";
import { DocumentAlertCountPill, DocumentStatPill } from "@/modules/accounting/modules/invoices/components/documents/DocumentAtoms";
import { DocumentHeaderFileLink } from "@/modules/accounting/modules/invoices/components/documents/DocumentHeaderFileLink";
import { FlagToggleGlyph } from "@/modules/accounting/modules/invoices/components/documents/FlagToggleGlyph";
import { DocumentPanelHeader } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanelHeader";
import { InvoiceEmailGlance } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceEmailGlance";
import { DocumentAttachmentDropZone } from "@/modules/accounting/modules/invoices/components/documents/DocumentAttachmentDropZone";
import { DocumentPanelRouteSurface } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanelRouteSurface";
import { RouteLifecycleFrame, useRouteLifecycle } from "@/modules/accounting/modules/invoices/components/documents/routeLifecycle";
import { PanelSkeletonHandoff } from "@/modules/accounting/modules/invoices/components/documents/PanelSkeletonHandoff";
import { PanelState } from "@/modules/accounting/modules/invoices/components/documents/PanelState";
import { TabEmpty } from "@/modules/accounting/modules/invoices/components/documents/TabEmpty";
import { DocumentStateSelector, useDevPanelStateSelector } from "@/modules/accounting/modules/invoices/components/documents/DocumentStateSelector";
import { usePanelPhase } from "@/modules/accounting/modules/invoices/components/documents/usePanelPhase";
import { useSplitWidth } from "@/modules/accounting/modules/invoices/components/documents/useSplitWidth";
import { SplitResizer } from "@/modules/accounting/modules/invoices/components/documents/SplitResizer";
import splitStyles from "@/modules/accounting/modules/invoices/components/documents/SplitResizer.module.css";
import { SourceDocumentViewer } from "@/modules/accounting/modules/invoices/components/documents/SourceDocumentViewer";
import { useDocumentPanelUndo, useRecentDocumentUndo, type RecentUndoTarget } from "@/modules/accounting/modules/invoices/components/documents/documentPanelUndo";
import {
  type DocumentPanelShortcutAction,
  useDocumentPanelKeyboardShortcuts,
} from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";
import {
  isSpectrumSubmitReturnVisit,
  readSpectrumSubmitFailureWorkflowSnapshot,
  subscribeSpectrumSubmitFailureWorkflowSnapshot,
  type SpectrumSubmitFailureWorkflowSnapshot,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitFailureWorkflowModel";
import { deserializeQueueNavContext, getDashboardTabCount, toInvoiceQueryFilters } from "@/modules/accounting/modules/invoices/components/dashboard/invoiceDashboardModel";
import { shouldRenderDocumentPanelRoute, usesInvoiceWorkflow } from "@/modules/accounting/modules/invoices/lib/documentRouting";
import { useSpectrumRefreshAction } from "@/modules/accounting/modules/invoices/hooks/useSpectrumRefreshAction";
import { getCollaborationState } from "@/modules/accounting/modules/invoices/components/activity/collaborationState";
import { useReprocessDocumentAction } from "@/modules/accounting/modules/invoices/hooks/useReprocessDocumentAction";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/modules/shared/components/ui/tooltip";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getApprovedSubmitSavePayload(payload: InvoiceUpdatePayload): InvoiceUpdatePayload {
  const allowed: InvoiceUpdatePayload = {};
  if (payload.invoiceDate !== undefined) allowed.invoiceDate = payload.invoiceDate;
  if (payload.dueDate !== undefined) allowed.dueDate = payload.dueDate;
  if (payload.notes !== undefined) allowed.notes = payload.notes;
  if (payload.routingCode !== undefined) allowed.routingCode = payload.routingCode;
  if (payload.phaseCode !== undefined) allowed.phaseCode = payload.phaseCode;
  if (payload.costType !== undefined) allowed.costType = payload.costType;
  if (payload.glAccount !== undefined) allowed.glAccount = payload.glAccount;
  return allowed;
}

function getDocumentUndoLabel(record: Invoice): string {
  return record.file ?? record.email?.subject ?? record.id;
}

function formatStatusLabel(status: string): string {
  return status
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getInvoiceStatusTone(status: string): DocumentTone {
  if (status === "approved" || status === "submitted" || status === "reviewed") return "ok";
  if (status === "duplicate" || status === "retry-pending" || status === "needs-split") return "warn";
  if (status === "discarded" || status === "rejected") return "neutral";
  if (status === "split-processing" || status === "modified") return "info";
  return "warn";
}

interface NavigationSnapshot {
  key: string;
  items: InvoiceNavItem[];
}

const EMPTY_NAV_ITEMS: InvoiceNavItem[] = [];

function getDefaultNavigationStatus(status: Invoice["status"] | undefined): InvoiceFilters["status"] {
  if (status === "pending" || status === "modified") return "pending";
  if (status === "approved" || status === "submitted") return status;
  if (status === "discarded") return "discarded";
  return "all";
}

function findNavigableNeighbor(
  items: InvoiceNavItem[],
  currentIndex: number,
  direction: -1 | 1,
  activeIds: Set<string>,
): InvoiceNavItem | null {
  for (let index = currentIndex + direction; index >= 0 && index < items.length; index += direction) {
    const candidate = items[index];
    if (candidate && activeIds.has(candidate.id)) return candidate;
  }
  return null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function InvoiceDetailContent() {
  const params = useParams();
  const router = useRouter();
  const routeSearchParams = useSearchParams();
  const id =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id)
      ? params.id[0]
      : "";
  const routeLifecycle = useRouteLifecycle(`invoice:${id}`);
  const { runControlledNavigation } = routeLifecycle;

  // Encoded dashboard URL passed when clicking a row (preserves filters)
  const fromParam = routeSearchParams.get("from");
  const navPanel = routeSearchParams.get("panel") as InvoiceFilters["panel"] | null;
  const navClassification = routeSearchParams.get("classification") ?? undefined;
  const isGlobalSearchNavigation = routeSearchParams.get("globalSearch") === "true";
  const isTrashEntry = routeSearchParams.get("status") === "discarded";
  // Global search can surface a soft-deleted record whose workflow status is
  // still pending/approved/etc. The route status is the list's authoritative
  // Trash marker, so never infer mutability from that stale workflow status.
  const isGlobalTrashEntry = isGlobalSearchNavigation && isTrashEntry;
  const backHref = fromParam ? decodeURIComponent(fromParam) : "/accounting/invoices";
  const showSpectrumSubmitReturn = isSpectrumSubmitReturnVisit(routeSearchParams);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [closedPeriodTrayAction, setClosedPeriodTrayAction] = useState<ClosedPeriodTrayAction | null>(null);
  const [panelNotices, setPanelNotices] = useState<{ invoiceId: string; entries: readonly NoticeEntry[] } | null>(null);
  const recordPanelNotices = useCallback((entries: readonly NoticeEntry[]) => setPanelNotices({ invoiceId: id, entries }), [id]);
  const [activeDetailTabEntry, setActiveDetailTabEntry] = useState<{
    invoiceId: string;
    tab: InvoiceDetailTabId;
  }>({ invoiceId: "", tab: "details" });
  const [reclassifyPending, setReclassifyPending] = useState(false);
  const [approvalOverrides, setApprovalOverrides] = useState<ApprovalOverrideValues | null>(null);
  const [spectrumSubmitControl, setSpectrumSubmitControl] = useState<SpectrumSubmitFooterControl | null>(null);
  const [hasPendingAllocationSave, setHasPendingAllocationSave] = useState(false);
  const [spectrumSubmitWorkflowSnapshot, setSpectrumSubmitWorkflowSnapshot] = useState<SpectrumSubmitFailureWorkflowSnapshot | null>(null);
  const [approvalPreviewEntry, setApprovalPreviewEntry] = useState<{
    invoiceId: string;
    preview: ApprovalPreview | null;
  } | null>(null);
  const [activityUnread, setActivityUnread] = useState<{ invoiceId: string; replies: number; comments: number }>({ invoiceId: "", replies: 0, comments: 0 });
  const [activityComposeFocus, setActivityComposeFocus] = useState(0);
  const [activityComposeRequest, setActivityComposeRequest] = useState<(CollaborationComposeRequest & { documentId: string }) | null>(null);
  const formRef = useRef<InvoiceDetailFormHandle>(null);

  const approvalPreview = approvalPreviewEntry?.invoiceId === id
    ? approvalPreviewEntry.preview
    : null;
  const activeDetailTab = activeDetailTabEntry.invoiceId === id
    ? activeDetailTabEntry.tab
    : "details";
  const handleApprovalPreviewChange = useCallback((preview: ApprovalPreview) => {
    setApprovalPreviewEntry({ invoiceId: id, preview });
  }, [id]);

  const handleDetailTabChange = useCallback((tab: InvoiceDetailTabId) => {
    setActiveDetailTabEntry({ invoiceId: id, tab });
  }, [id]);
  useEffect(() => {
    const onCompose = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId?: string; mode?: "comment" | "reply" | "forward" }>).detail;
      const requestedMode = detail?.mode;
      if (detail?.documentId !== id || !requestedMode) return;
      setActiveDetailTabEntry({ invoiceId: id, tab: "activity" });
      setActivityComposeRequest((current) => ({ documentId: id, mode: requestedMode, sequence: (current?.sequence ?? 0) + 1 }));
      setActivityComposeFocus((value) => value + 1);
    };
    window.addEventListener("document-collaboration-compose", onCompose);
    return () => window.removeEventListener("document-collaboration-compose", onCompose);
  }, [id]);
  const handleSpectrumSubmitControlChange = useCallback((control: SpectrumSubmitFooterControl | null) => {
    setSpectrumSubmitControl(control);
  }, []);
  // NOTE: Do NOT reset approvalOverrides here — SpectrumSubmitSection's own
  // reset effect (keyed on invoice.id) fires as a child effect *before* this
  // parent effect, so nulling here would overwrite the child's freshly-reported
  // values and leave approvalOverrides stuck at null until the next state change.

  const { data: invoice, isLoading, isError, error: invoiceError, refetch: refetchInvoice } = useInvoice(id, { includeDeleted: isTrashEntry });
  // Live duplicate evaluation (pending only). On error, fall back to served state.
  const duplicateStatusQuery = useDuplicateStatus(id, { enabled: invoice?.status === "pending" && !isTrashEntry });
  const liveDuplicateStatus = duplicateStatusQuery.isError ? null : duplicateStatusQuery.data ?? null;
  const { containerRef: splitContainerRef, containerStyle: splitContainerStyle, width: splitWidth, setWidth: setSplitWidth } = useSplitWidth();
  const devPanelState = useDevPanelStateSelector(routeLifecycle.identity, {
    loading: isLoading,
    hasContent: Boolean(invoice),
    isError,
    errorStatus: isApiError(invoiceError) ? invoiceError.status : null,
  });
  const panelPhase = usePanelPhase({
    identity: devPanelState.phaseIdentity,
    ...devPanelState.panelInputs,
  });
  const errorDetail = isApiError(invoiceError) && invoiceError.message.trim()
    ? invoiceError.message
    : invoiceError instanceof Error && invoiceError.message.trim()
      ? invoiceError.message
      : null;
  const { data: emailData } = useInvoiceEmail(id);
  const { data: classifications } = useClassifications();
  const classificationMappings = classifications ?? DEFAULT_MAPPINGS;

  // Allocation-tab visibility = LIVE phase count, not the stale-after-edit
  // `multiPhaseCandidate` flag. Shares the IDENTICAL query key as the panel's own
  // `usePhaseOptions` call (id + subcontract + job), so TanStack dedupes to one
  // request; `placeholderData` holds the last-known phases so the tab flips only
  // when new phase-options confirm. `enabled` = invoice-like AND subcontract present.
  const detailSubcontractNumber = invoice?.matching?.subcontract?.subcontractNumber ?? null;
  const detailJobNumber = invoice?.matching?.job?.jobNumber ?? null;
  const detailPhaseOpts = usePhaseOptions(
    id,
    usesInvoiceWorkflow(invoice?.classification ?? "", classificationMappings) && !!detailSubcontractNumber,
    detailSubcontractNumber,
    detailJobNumber,
  );
  const showAllocationTab = !!detailPhaseOpts.data?.isMultiPhase;
  const { data: auditEntries } = useAuditTrail(id);
  const { data: dashboardStats } = useStats({ filed: false, panel: navPanel ?? undefined });
  const reclassify = useReclassifyInvoice();
  const flagForSplitMutation = useFlagForSplit();
  const discardInvoice = useDiscardInvoice();
  const fileDocument = useFileDocument();
  const updateInvoice = useUpdateInvoice();
  const { mutate: unapproveInvoice, isPending: unapprovePending } = useUnapproveInvoice();
  const reconcileStatement = useReconcileStatement();
  const addStatementLine = useAddStatementLine();
  const updateStatementLine = useUpdateStatementLine();
  const deleteStatementLine = useDeleteStatementLine();
  const rematchStatementLines = useRematchStatementLines();
  const resolveStatementLine = useResolveStatementLine();
  const unresolveStatementLine = useUnresolveStatementLine();
  const uploadCoiToSpectrum = useUploadCoiToSpectrum();
  const saveBeforeSpectrumSubmit = useSaveInvoiceBeforeSpectrumSubmit();
  const { hasAnyPermission } = usePermissions();
  const canComment = hasAnyPermission(["accounting.invoices.view_details"]);
  const canEmail = hasAnyPermission(["accounting.invoices.request_waiver"]);
  const canCreateRule = hasAnyPermission(["accounting.invoices.manage_retention"]);
  const canUploadToSpectrum = hasAnyPermission(["accounting.invoices.submit_spectrum"]);
  const canApproveInvoices = hasAnyPermission(["accounting.invoices.approve"]);
  const pendingPanelSaveRef = useRef<(() => Promise<void>) | null>(null);
  const primaryShortcutActionRef = useRef<DocumentPanelShortcutAction | null>(null);
  const discardNavigationTimerRef = useRef<number | null>(null);
  const duplicateDiscardNavigatedRef = useRef(false);
  useEffect(() => {
    duplicateDiscardNavigatedRef.current = false;
    if (discardNavigationTimerRef.current !== null) {
      window.clearTimeout(discardNavigationTimerRef.current);
      discardNavigationTimerRef.current = null;
    }
    return () => {
      if (discardNavigationTimerRef.current !== null) {
        window.clearTimeout(discardNavigationTimerRef.current);
        discardNavigationTimerRef.current = null;
      }
    };
  }, [id]);
  useEffect(() => {
    setSpectrumSubmitControl(null);
    pendingPanelSaveRef.current = null;
    primaryShortcutActionRef.current = null;
    setHasPendingAllocationSave(false);
  }, [id]);

  useEffect(() => {
    if (!showSpectrumSubmitReturn || !id) return;
    setActiveDetailTabEntry((current) => (
      current.invoiceId === id && current.tab === "details"
        ? current
        : { invoiceId: id, tab: "details" }
    ));
  }, [id, showSpectrumSubmitReturn]);

  useEffect(() => {
    if (!showSpectrumSubmitReturn) {
      setSpectrumSubmitWorkflowSnapshot(null);
      return undefined;
    }

    const refreshSnapshot = () => {
      setSpectrumSubmitWorkflowSnapshot(readSpectrumSubmitFailureWorkflowSnapshot());
    };
    refreshSnapshot();
    return subscribeSpectrumSubmitFailureWorkflowSnapshot(refreshSnapshot);
  }, [showSpectrumSubmitReturn]);

  const registerPendingPanelSave = useCallback((handler: (() => Promise<void>) | null) => {
    pendingPanelSaveRef.current = handler;
  }, []);

  const registerAllocationPendingSave = useCallback((handler: (() => Promise<void>) | null) => {
    pendingPanelSaveRef.current = handler;
    setHasPendingAllocationSave(Boolean(handler));
  }, []);

  const registerPrimaryShortcutAction = useCallback((action: DocumentPanelShortcutAction | null) => {
    primaryShortcutActionRef.current = action;
  }, []);

  const saveInvoiceFormIfNeeded = useCallback((): Promise<void> => new Promise((resolve) => {
    const form = formRef.current;
    if (invoice?.status === "approved") {
      resolve();
      return;
    }
    if (!form?.hasEdits || form.isSaving) {
      resolve();
      return;
    }
    form.triggerSave(
      () => resolve(),
      () => resolve(),
    );
  }), [invoice?.status]);

  const saveInvoiceFormBeforeSpectrumSubmit = useCallback(async (parameterPayload: InvoiceUpdatePayload = {}): Promise<void> => {
    const formPayload = formRef.current?.getPendingPayload() ?? {};
    const payload = getApprovedSubmitSavePayload({
      ...formPayload,
      ...parameterPayload,
    });
    if (Object.keys(payload).length === 0) {
      return;
    }
    await saveBeforeSpectrumSubmit.mutateAsync({ id, payload });
  }, [id, saveBeforeSpectrumSubmit]);

  const saveAllocationBeforeApprove = useCallback(async (): Promise<void> => {
    await pendingPanelSaveRef.current?.();
  }, []);

  const navigateAfterPanelSave = useCallback(async (href: string) => {
    await saveInvoiceFormIfNeeded();
    await pendingPanelSaveRef.current?.();
    await runControlledNavigation(() => router.push(href));
  }, [router, runControlledNavigation, saveInvoiceFormIfNeeded]);

  const navigateTo = useCallback((href: string, options?: { skipPanelSave?: boolean }) => {
    if (options?.skipPanelSave) {
      void runControlledNavigation(() => router.push(href));
      return;
    }
    void navigateAfterPanelSave(href);
  }, [navigateAfterPanelSave, router, runControlledNavigation]);

  // Auto-refetch while the invoice is in split-processing state
  useEffect(() => {
    if (invoice?.status !== "split-processing") return;
    const timer = setInterval(() => void refetchInvoice(), 3_000);
    return () => clearInterval(timer);
  }, [invoice?.status, refetchInvoice]);

  // COI uploads are queued asynchronously by the backend; keep the open
  // detail panel fresh so failed uploads re-enable the retry CTA.
  useEffect(() => {
    if (
      invoice?.classification !== "coi" ||
      (invoice.spectrumUploadStatus !== "queued" && invoice.spectrumUploadStatus !== "processing")
    ) {
      return;
    }
    const timer = setInterval(() => void refetchInvoice(), 3_000);
    return () => clearInterval(timer);
  }, [invoice?.classification, invoice?.spectrumUploadStatus, refetchInvoice]);

  // Sort/filter context carried from the dashboard for prev/next navigation
  const navSort = routeSearchParams.get("sort") as InvoiceFilters["sort"] | null;
  const navSortDir = routeSearchParams.get("sortDir") as InvoiceFilters["sortDir"] | null;
  const navStatus = routeSearchParams.get("status") as InvoiceFilters["status"] | null;
  const navSearch = routeSearchParams.get("search") ?? undefined;
  const navSplitFrom = routeSearchParams.get("splitFrom") ?? undefined;
  const effectiveNavStatus = navStatus ?? getDefaultNavigationStatus(invoice?.status);
  const isTrashNavigation = effectiveNavStatus === "discarded";

  // Build a query string that preserves nav context for prev/next links
  const navParams = new URLSearchParams();
  if (fromParam) navParams.set("from", fromParam);
  if (navSort) navParams.set("sort", navSort);
  if (navSortDir) navParams.set("sortDir", navSortDir);
  if (navPanel) navParams.set("panel", navPanel);
  if (navClassification) navParams.set("classification", navClassification);
  if (navSearch) navParams.set("search", navSearch);
  if (navSplitFrom) navParams.set("splitFrom", navSplitFrom);
  if (effectiveNavStatus) navParams.set("status", effectiveNavStatus);
  const navQs = navParams.size ? `?${navParams.toString()}` : "";
  const splitReviewHref = useMemo(
    () => `/accounting/invoices/splits/${invoice?.id ?? id}${navQs}`,
    [id, invoice?.id, navQs],
  );
  const currentUndoControl = useDocumentPanelUndo(id, {
    enabled: Boolean(invoice) && !isGlobalTrashEntry,
  });
  const handleRecentUndoSuccess = useCallback((target: RecentUndoTarget) => {
    navigateTo(`/accounting/invoices/${target.invoiceId}${navQs}`, { skipPanelSave: true });
  }, [navigateTo, navQs]);
  const recentUndoOptions = useMemo(
    () => ({ onUndoSuccess: handleRecentUndoSuccess }),
    [handleRecentUndoSuccess],
  );
  const {
    undoControl: documentPanelUndo,
    rememberAction: rememberRecentUndoAction,
  } = useRecentDocumentUndo(currentUndoControl, recentUndoOptions);

  // Queue prev/next — server-computed keyset neighbors. Built from the queue
  // context the dashboard serialized into the URL (the SAME shared boundary the
  // list uses: search/panel/classification/sort/sortDir AND splitFrom), then fed
  // to the SAME `toInvoiceQueryFilters`. `effectiveNavStatus` preserves the
  // direct-link status fallback while equaling the URL status for queue nav. This
  // guarantees the neighbors request is byte-identical to the list request, so
  // total/position/next/prev always agree with the rendered rows.
  const navContext = useMemo(
    () => deserializeQueueNavContext((key) => routeSearchParams.get(key)),
    [routeSearchParams],
  );
  const neighborsFilters = useMemo(
    () => toInvoiceQueryFilters(
      { ...navContext.filters, status: effectiveNavStatus },
      navContext.splitFrom,
    ),
    [navContext, effectiveNavStatus],
  );
  const {
    data: neighbors,
    isError: neighborsError,
    isPending: neighborsPending,
  } = useInvoiceNeighbors(id, neighborsFilters, { enabled: !isTrashNavigation && !isGlobalSearchNavigation });

  // A queue advance can only trust "no next document" when the neighbors query
  // actually succeeded; on error/still-loading the fallback exit must be
  // explained rather than silently reading as "end of queue".
  const neighborsUnresolved = !isTrashNavigation && !isGlobalSearchNavigation
    && (neighborsError || neighborsPending);

  // Trash navigation is unchanged: a client-derived list with a stable snapshot.
  const { data: trashInvoices } = useTrash(
    { limit: 200, offset: 0, panel: navPanel ?? undefined },
    { enabled: isTrashNavigation && !isGlobalSearchNavigation },
  );
  const trashNavItems = useMemo<InvoiceNavItem[]>(() => {
    if (!isTrashNavigation) return EMPTY_NAV_ITEMS;
    return (trashInvoices?.invoices ?? []).map((record) => ({
      id: record.id,
      vendorName: record.extracted?.vendorName ?? null,
      invoiceNumber: record.extracted?.invoiceNumber ?? null,
      status: record.status,
      amount: record.extracted?.amount ?? null,
    }));
  }, [isTrashNavigation, trashInvoices?.invoices]);
  const navListKey = [navPanel ?? "", navClassification ?? "", navSort ?? "", navSortDir ?? "", effectiveNavStatus ?? ""].join("|");
  const [navigationSnapshot, setNavigationSnapshot] = useState<NavigationSnapshot>({ key: "", items: [] });

  useEffect(() => {
    setNavigationSnapshot((current) => {
      if (trashNavItems.length === 0) {
        return current.key === navListKey && current.items.length === 0
          ? current
          : { key: navListKey, items: [] };
      }

      const rawContainsCurrent = trashNavItems.some((inv) => inv.id === id);
      const snapshotContainsCurrent = current.key === navListKey && current.items.some((inv) => inv.id === id);
      if (current.key !== navListKey || current.items.length === 0 || (!snapshotContainsCurrent && rawContainsCurrent)) {
        return { key: navListKey, items: trashNavItems };
      }
      return current;
    });
  }, [id, navListKey, trashNavItems]);

  const trashList = navigationSnapshot.key === navListKey && navigationSnapshot.items.length > 0
    ? navigationSnapshot.items
    : trashNavItems;
  const trashActiveIds = useMemo(() => new Set(trashNavItems.map((inv) => inv.id)), [trashNavItems]);
  const trashIndex = trashList.findIndex((inv) => inv.id === id);
  const trashPrev = trashIndex >= 0 ? findNavigableNeighbor(trashList, trashIndex, -1, trashActiveIds) : null;
  const trashNext = trashIndex >= 0 ? findNavigableNeighbor(trashList, trashIndex, 1, trashActiveIds) : null;
  const trashTotal = getDashboardTabCount(dashboardStats, effectiveNavStatus)
    ?? trashInvoices?.total
    ?? trashList.length;

  // Unified prev/next ids: server neighbors for the queue, client list for trash.
  // Disabled queries can retain cached data. Global search deliberately has no
  // stable neighbor contract, so hard-null ids before every arrow, shortcut,
  // skip, and post-action auto-advance consumer.
  const prevId = isGlobalSearchNavigation ? null : isTrashNavigation ? (trashPrev?.id ?? null) : (neighbors?.prev ?? null);
  const nextId = isGlobalSearchNavigation ? null : isTrashNavigation ? (trashNext?.id ?? null) : (neighbors?.next ?? null);
  const spectrumRefreshAction = useSpectrumRefreshAction({
    enabled: Boolean(invoice) && !isGlobalTrashEntry,
  });
  const {
    action: reprocessAction,
    dialog: reprocessDialog,
  } = useReprocessDocumentAction({ documentId: invoice?.id, enabled: Boolean(invoice) && !isGlobalTrashEntry });
  const {
    action: createRuleAction,
    modal: createRuleModal,
  } = useCreateRuleFromInvoiceAction({
    invoice,
    previewInvoices: invoice ? [invoice] : [],
    enabled: Boolean(invoice && canCreateRule) && !isGlobalTrashEntry,
    onAppliedTerminalRule: () => {
      const href = nextId
        ? `/accounting/invoices/${nextId}${navQs}`
        : backHref;
      navigateTo(href, { skipPanelSave: true });
    },
  });
  // Undo Approve must work for the WHOLE approved/modified lifetime, not just the
  // 5-minute `useDocumentPanelUndo` window — an approved-with-submit_error invoice
  // past the window still needs to unapprove. Use the window-free POST /unapprove
  // directly. `label: "Undo Approve"` preserves the footer render gate; other
  // statuses keep the time-boxed `documentPanelUndo`.
  const approveUndoControl = useMemo<DocumentPanelUndoControl>(() => ({
    label: "Undo Approve",
    disabled: unapprovePending,
    pending: unapprovePending,
    tooltip: "Revert to pending.",
    onUndo: () => unapproveInvoice({ id }),
  }), [unapprovePending, unapproveInvoice, id]);
  const activeUndoControl = isGlobalTrashEntry
    ? undefined
    : invoice?.status === "approved" || invoice?.status === "modified"
    ? approveUndoControl
    : documentPanelUndo;
  const undoShortcutAction = useMemo<DocumentPanelShortcutAction | null>(() => (
    activeUndoControl
      ? {
          label: activeUndoControl.label ?? "Undo",
          disabled: activeUndoControl.disabled || activeUndoControl.pending,
          run: activeUndoControl.onUndo,
        }
      : null
  ), [activeUndoControl]);
  const previousShortcutAction = useMemo<DocumentPanelShortcutAction | null>(() => (
    prevId
      ? {
          label: "Previous",
          disabled: false,
          run: () => navigateTo(`/accounting/invoices/${prevId}${navQs}`),
        }
      : null
  ), [navQs, navigateTo, prevId]);
  const nextShortcutAction = useMemo<DocumentPanelShortcutAction | null>(() => (
    nextId
      ? {
          label: "Next",
          disabled: false,
          run: () => navigateTo(`/accounting/invoices/${nextId}${navQs}`),
        }
      : null
  ), [navQs, navigateTo, nextId]);
  const genericRouteOwnsShortcuts = Boolean(invoice && shouldRenderDocumentPanelRoute(invoice.classification, classificationMappings));
  const saveShortcutAction: DocumentPanelShortcutAction = {
    label: "Save",
    available: () => Boolean(formRef.current?.hasEdits || pendingPanelSaveRef.current),
    run: () => {
      const form = formRef.current;
      if (form?.hasEdits) {
        form.triggerSave();
        return;
      }
      void pendingPanelSaveRef.current?.();
    },
  };
  const discardShortcutAction = useMemo<DocumentPanelShortcutAction>(() => ({
    label: "Discard",
    disabled: isGlobalTrashEntry || !invoice || discardInvoice.isPending,
    available: () => {
      const button = document.querySelector<HTMLButtonElement>("[data-invoice-discard]");
      return Boolean(button && !button.disabled);
    },
    run: () => {
      if (isGlobalTrashEntry || !invoice) return;
      document.querySelector<HTMLButtonElement>("[data-invoice-discard]")?.click();
    },
  }), [discardInvoice.isPending, invoice, isGlobalTrashEntry]);
  const downloadShortcutAction = useMemo<DocumentPanelShortcutAction>(() => ({
    label: "Download PDF",
    disabled: !invoice,
    available: () => Boolean(document.querySelector("a[download]")),
    run: () => document.querySelector<HTMLAnchorElement>("a[download]")?.click(),
  }), [invoice]);
  const settingsShortcutAction = useMemo<DocumentPanelShortcutAction>(() => ({ label: "Settings", run: () => router.push("/settings") }), [router]);
  const escapeShortcutAction = useMemo<DocumentPanelShortcutAction>(() => ({ label: "Back", run: () => navigateTo(backHref) }), [backHref, navigateTo]);
  const composeShortcutAction = (mode: "comment" | "reply" | "forward"): DocumentPanelShortcutAction => ({
    label: mode[0].toUpperCase() + mode.slice(1),
    disabled: mode === "comment" ? !canComment : !canEmail,
    run: () => requestCollaborationCompose(id, mode),
  });
  useDocumentPanelKeyboardShortcuts({
    primaryActionRef: primaryShortcutActionRef,
    undoAction: undoShortcutAction,
    previousAction: previousShortcutAction,
    nextAction: nextShortcutAction,
    saveAction: saveShortcutAction,
    discardAction: discardShortcutAction,
    downloadAction: genericRouteOwnsShortcuts ? null : downloadShortcutAction,
    settingsAction: settingsShortcutAction,
    escapeAction: escapeShortcutAction,
    commentAction: genericRouteOwnsShortcuts ? null : composeShortcutAction("comment"),
    replyAction: genericRouteOwnsShortcuts ? null : composeShortcutAction("reply"),
    forwardAction: genericRouteOwnsShortcuts ? null : composeShortcutAction("forward"),
  });

  function goToNextOrBack() {
    if (nextId) {
      navigateTo(`/accounting/invoices/${nextId}${navQs}`);
      return;
    }
    if (neighborsUnresolved) {
      toast.error("Couldn't load queue position", {
        description: "Returning to the queue — the action itself completed.",
      });
    }
    navigateTo(backHref);
  }
  const skipToNext = nextId
    ? () => navigateTo(`/accounting/invoices/${nextId}${navQs}`)
    : undefined;
  const canSplitDocument = Boolean(
    invoice?.file?.toLowerCase().endsWith(".pdf")
    && !isGlobalTrashEntry
    && ["pending", "approved", "modified", "reviewed", "needs-split"].includes(invoice.status),
  );
  const splitDocumentAction: DocumentAction | undefined = invoice && canSplitDocument
    ? {
      id: "split-document",
      label: "Split Document",
      icon: Scissors,
      tone: "neutral",
      pending: invoice.status === "needs-split" ? false : flagForSplitMutation.isPending,
      onClick: () => {
        if (invoice.status === "needs-split") {
          navigateTo(splitReviewHref);
          return;
        }
        flagForSplitMutation.mutate(
          { id: invoice.id },
          {
            onSuccess: () => {
              navigateTo(splitReviewHref);
            },
          },
        );
      },
    }
    : undefined;
  const documentPanelExtraActions: DocumentAction[] = [];
  if (!isGlobalTrashEntry && createRuleAction) documentPanelExtraActions.push(createRuleAction);
  if (!isGlobalTrashEntry && reprocessAction) documentPanelExtraActions.push(reprocessAction);
  if (!isGlobalTrashEntry && spectrumRefreshAction) documentPanelExtraActions.push(spectrumRefreshAction);
  // eslint-disable-next-line react-hooks/refs -- the save ref is only read from the split click handler, not during render.
  if (splitDocumentAction) documentPanelExtraActions.push(splitDocumentAction);
  const collaborationState = invoice
    ? getCollaborationState(invoice, { readOnly: isGlobalTrashEntry, trashOverride: isGlobalTrashEntry })
    : { isTrash: false, readOnly: false, lockedReason: undefined };
  const activityTrash = collaborationState.isTrash;
  const activityReadOnly = collaborationState.readOnly;
  const activityLockedReason = collaborationState.lockedReason;
  const invoiceCollaborationActions = invoice
    ? collaborationActionsFor(invoice.id, invoice.email, { canEmail, readOnly: activityReadOnly, isTrash: activityTrash })
    : [];

  const navigateAfterDuplicateDiscard = useCallback(() => {
    if (duplicateDiscardNavigatedRef.current) return;
    duplicateDiscardNavigatedRef.current = true;
    if (discardNavigationTimerRef.current !== null) {
      window.clearTimeout(discardNavigationTimerRef.current);
      discardNavigationTimerRef.current = null;
    }
    const href = nextId
      ? `/accounting/invoices/${nextId}${navQs}`
      : backHref;
    navigateTo(href, { skipPanelSave: true });
  }, [backHref, navQs, navigateTo, nextId]);

  if (!invoice) {
    return (
      <RouteLifecycleFrame lifecycle={routeLifecycle}>
        <DocumentStateSelector value={devPanelState.selectedPhase} onChange={devPanelState.setSelectedPhase} retryingLoaderSize={devPanelState.retryingLoaderSize} onRetryingLoaderSizeChange={devPanelState.setRetryingLoaderSize} />
        <PanelSkeletonHandoff key={routeLifecycle.identity} identity={routeLifecycle.identity} phase={panelPhase} type="invoice">
          <PanelState phase={panelPhase.phase} onRetry={() => void refetchInvoice()} onBack={() => navigateTo(backHref)} backHref={backHref} errorDetail={errorDetail} retryingLoaderSize={devPanelState.retryingLoaderSize} />
        </PanelSkeletonHandoff>
      </RouteLifecycleFrame>
    );
  }

  // ─── Split-Processing Guard ──────────────────────────────────────────────────

  if (invoice.status === "split-processing") {
    return (
      <RouteLifecycleFrame lifecycle={routeLifecycle}>
        <DocumentStateSelector value={devPanelState.selectedPhase} onChange={devPanelState.setSelectedPhase} retryingLoaderSize={devPanelState.retryingLoaderSize} onRetryingLoaderSizeChange={devPanelState.setRetryingLoaderSize} />
        <PanelSkeletonHandoff key={routeLifecycle.identity} identity={routeLifecycle.identity} phase={panelPhase} type="invoice">
          <PanelState phase={panelPhase.phase} onRetry={() => void refetchInvoice()} onBack={() => navigateTo(backHref)} backHref={backHref} errorDetail={errorDetail} retryingLoaderSize={devPanelState.retryingLoaderSize}>
            <SplitProcessingPlaceholder invoice={invoice} onRefresh={() => void refetchInvoice()} />
          </PanelState>
        </PanelSkeletonHandoff>
      </RouteLifecycleFrame>
    );
  }

  // ─── Derived Values ───────────────────────────────────────────────────────────

  const missingWaiverAttention = hasMissingWaiverAttention(invoice);
  const resolveRows = getInvoiceResolveRows(invoice, closedPeriodTrayAction, liveDuplicateStatus);
  const duplicateFlagged = hasUnresolvedDuplicate(invoice, liveDuplicateStatus);
  const allocationAttention = hasAllocationAttention(approvalOverrides);
  const detailAlerts: string[] = [];
  detailAlerts.push(...resolveRows.map((row) => row.label));
  const activeNotices = panelNotices?.invoiceId === invoice.id ? panelNotices.entries.filter((entry) => !entry.resolved) : [];
  detailAlerts.push(...activeNotices.map((entry) => entry.label));
  const noticeCountFor = (tabId: string) => activeNotices.filter((entry) => (entry.tabId ?? "details") === tabId).length;
  const currentClassification = classifications?.find((item) => item.name === invoice.classification);
  const isInvoiceLike = usesInvoiceWorkflow(invoice.classification, classificationMappings);
  const discardDuplicate = async (): Promise<boolean> => {
    if (isGlobalTrashEntry) return false;
    try {
      const data = await discardInvoice.mutateAsync({ id: invoice.id, duplicateContext: true });
      rememberRecentUndoAction(invoice.id, data.action, "Discard", getDocumentUndoLabel(invoice));
      // The mutation may invalidate the current invoice and unmount the tray
      // before CardStack can emit onExited. Keep the visual exit window, but
      // retain a guarded navigation fallback so the user cannot be stranded.
      discardNavigationTimerRef.current = window.setTimeout(navigateAfterDuplicateDiscard, 450);
      return true;
    } catch (error) {
      toast.error("Could not discard possible duplicate", {
        description: isApiError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : "Please try again.",
      });
      return false;
    }
  };
  const detailTabs: InvoiceDetailTab[] = [
    { id: "details", label: "Details", icon: Mail, alert: resolveRows.length + noticeCountFor("details") > 0 || hasUnsavedChanges, badge: resolveRows.length + noticeCountFor("details") },
    ...(showAllocationTab
      ? [{ id: "allocation" as const, label: "Allocation", icon: BarChart3, alert: allocationAttention || noticeCountFor("allocation") > 0, badge: noticeCountFor("allocation") }]
      : []),
    { id: "waiver", label: "Waiver", icon: ShieldCheck, alert: missingWaiverAttention || noticeCountFor("waiver") > 0, badge: noticeCountFor("waiver") },
    { id: "activity", label: "Activity", icon: Activity, alert: activityUnread.invoiceId === invoice.id ? activityUnread.replies + activityUnread.comments > 0 : (invoice.unreadReplies ?? 0) + (invoice.unreadComments ?? 0) > 0, badge: activityUnread.invoiceId === invoice.id ? activityUnread.replies + activityUnread.comments : (invoice.unreadReplies ?? 0) + (invoice.unreadComments ?? 0) },
  ];
  // If the user is sitting on Allocation when a MULTI→SINGLE edit removes the tab,
  // fall back to Details so the workspace never shows a blank pane.
  const effectiveActiveTab = activeDetailTab === "allocation" && !showAllocationTab
    ? "details"
    : activeDetailTab;

  // Resolved email body: try dedicated endpoint first, fall back to invoice field
  const emailBody = emailData?.body ?? invoice.email?.body;
  // Trash shows the "N / total" position (client list); the queue shows arrows
  // only — the neighbors endpoint returns ids, not an index/total.
  const headerNavigation = !isGlobalSearchNavigation && (isTrashNavigation ? trashIndex >= 0 : true)
    ? {
      // Trash uses the client list index/total; the queue uses the served
      // keyset position — shown when non-null, hidden when out-of-set or loading.
      ...(isTrashNavigation
        ? { current: trashIndex + 1, total: trashTotal }
        : (neighbors && neighbors.position != null
            ? { current: neighbors.position, total: neighbors.total }
            : {})),
      onPrevious: prevId ? () => navigateTo(`/accounting/invoices/${prevId}${navQs}`) : undefined,
      onNext: nextId ? () => navigateTo(`/accounting/invoices/${nextId}${navQs}`) : undefined,
      previousDisabled: !prevId,
      nextDisabled: !nextId,
    }
    : undefined;
  const spectrumReturnSlot = showSpectrumSubmitReturn
    ? (
      <SpectrumSubmitReturnButton
        returnHref={backHref}
        visible
        onReturn={(href) => navigateTo(href)}
      />
    )
    : undefined;
  const spectrumSubmitResolveIssue = showSpectrumSubmitReturn
    ? getSpectrumSubmitResolveIssue(invoice, spectrumSubmitWorkflowSnapshot)
    : null;

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <RouteLifecycleFrame lifecycle={routeLifecycle}>
      <DocumentStateSelector value={devPanelState.selectedPhase} onChange={devPanelState.setSelectedPhase} retryingLoaderSize={devPanelState.retryingLoaderSize} onRetryingLoaderSizeChange={devPanelState.setRetryingLoaderSize} />
      <PanelSkeletonHandoff key={routeLifecycle.identity} identity={routeLifecycle.identity} phase={panelPhase} type="invoice">
      <PanelState phase={panelPhase.phase} onRetry={() => void refetchInvoice()} onBack={() => navigateTo(backHref)} backHref={backHref} errorDetail={errorDetail} retryingLoaderSize={devPanelState.retryingLoaderSize} emptySlot={<TabEmpty />}>
      <PanelNoticeProvider documentId={invoice.id}><TooltipProvider>
          <PanelNoticeObserver onChange={recordPanelNotices} />
	      {createRuleModal}
	      {reprocessDialog}
	      {shouldRenderDocumentPanelRoute(invoice.classification, classificationMappings) ? (
        <div className="flex h-full flex-col overflow-hidden">
          <DocumentPanelHeader
            title={<DocumentHeaderFileLink record={invoice} className="max-w-full sm:max-w-[32rem]" />}
            onBack={() => navigateTo(backHref)}
            classificationSlot={spectrumReturnSlot}
            navigation={headerNavigation}
          />

          <div ref={splitContainerRef} style={splitContainerStyle} className={`${splitStyles.splitShell} flex min-h-0 flex-1 flex-col overflow-hidden min-[1100px]:flex-row`}>
            <SourceDocumentViewer
              key={invoice.id}
              record={invoice}
              className={`${splitStyles.splitPane} h-[45vh] min-[1100px]:h-auto min-[1100px]:w-[var(--split-doc-width)]`}
              imageAlt="Invoice attachment"
              viewerTitle="Invoice document"
            />
            <DocumentPanelRouteSurface
              record={invoice}
              readOnly={isGlobalTrashEntry}
              splitDocumentAction={splitDocumentAction}
              className={`${splitStyles.splitPane} flex-1 border-t min-[1100px]:w-[calc(100%_-_var(--split-doc-width))] min-[1100px]:border-l min-[1100px]:border-t-0`}
              classifications={classifications}
              allowInvoiceClassification
              auditEntries={auditEntries}
              serverBackedActivity
              canComment={canComment}
              canEmail={canEmail}
              unreadReplies={activityUnread.invoiceId === invoice.id ? activityUnread.replies : invoice.unreadReplies}
              unreadComments={activityUnread.invoiceId === invoice.id ? activityUnread.comments : invoice.unreadComments}
              onActivityViewed={(state) => setActivityUnread({ invoiceId: invoice.id, replies: state.unreadReplies, comments: state.unreadComments })}
              focusSignal={activityComposeFocus}
              routeFamily="invoice"
              onReclassify={!isGlobalTrashEntry ? (classification) => {
                if (classification === invoice.classification) return;
                setReclassifyPending(true);
                reclassify.mutate(
                  { id: invoice.id, classification },
                  {
                    onSuccess: () => void refetchInvoice(),
                    onSettled: () => setReclassifyPending(false),
                  },
                );
              } : undefined}
              reclassifyPending={reclassifyPending}
              reclassifyDisabled={isGlobalTrashEntry}
              onDiscard={!isGlobalTrashEntry && invoice.status !== "discarded" ? (record) => discardInvoice.mutate(
                { id: record.id },
                {
                  onSuccess: (data) => {
                    rememberRecentUndoAction(record.id, data.action, "Discard", getDocumentUndoLabel(record));
                    goToNextOrBack();
                  },
                },
              ) : undefined}
              discardPending={discardInvoice.isPending}
              onFile={!isGlobalTrashEntry && invoice.status !== "discarded" ? async (record, meta) => {
                const data = await fileDocument.mutateAsync({ id: record.id, ...meta });
                if (!meta?.uploadToSharePoint || data.sharePoint?.uploaded !== false) {
                  rememberRecentUndoAction(
                    record.id,
                    data.action,
                    meta?.uploadToSharePoint ? "File to Project" : "Shelve",
                    getDocumentUndoLabel(record),
                  );
                  goToNextOrBack();
                }
                return data;
              } : undefined}
              onUpdateDocument={!isGlobalTrashEntry ? (record, payload) => updateInvoice.mutateAsync({ id: record.id, payload, suppressErrorToast: true }) : undefined}
              filePending={fileDocument.isPending}
              onReconcile={!isGlobalTrashEntry && invoice.status !== "discarded" ? async (record) => {
                const data = await reconcileStatement.mutateAsync({ id: record.id });
                goToNextOrBack();
                return data;
              } : undefined}
              reconcilePending={reconcileStatement.isPending}
              onAddStatementLine={!isGlobalTrashEntry && canApproveInvoices ? (record, payload) => addStatementLine.mutateAsync({ id: record.id, payload }) : undefined}
              onUpdateStatementLine={!isGlobalTrashEntry && canApproveInvoices ? (record, lineId, payload) => updateStatementLine.mutateAsync({ id: record.id, lineId, payload }) : undefined}
              onDeleteStatementLine={!isGlobalTrashEntry && canApproveInvoices ? (record, lineId) => deleteStatementLine.mutateAsync({ id: record.id, lineId }) : undefined}
              onRematchStatementLines={!isGlobalTrashEntry && canApproveInvoices ? (record) => rematchStatementLines.mutateAsync({ id: record.id }) : undefined}
              onResolveStatementLine={!isGlobalTrashEntry && canApproveInvoices ? (record, lineId, payload) => resolveStatementLine.mutateAsync({ id: record.id, lineId, payload }) : undefined}
              onUnresolveStatementLine={!isGlobalTrashEntry && canApproveInvoices ? (record, lineId) => unresolveStatementLine.mutateAsync({ id: record.id, lineId }) : undefined}
              rematchStatementLinesPending={rematchStatementLines.isPending}
              onUploadToSpectrum={!isGlobalTrashEntry && canUploadToSpectrum && invoice.status !== "discarded" ? async (record, payload) => {
                const response = await uploadCoiToSpectrum.mutateAsync({ id: record.id, payload });
                void refetchInvoice();
                goToNextOrBack();
                return response;
              } : undefined}
              uploadToSpectrumPending={uploadCoiToSpectrum.isPending}
              onViewDocument={!isGlobalTrashEntry ? (record) => navigateTo(`/accounting/invoices/${record.id}${navQs}`) : undefined}
              onLienWaiverLinkComplete={!isGlobalTrashEntry ? () => goToNextOrBack() : undefined}
              onRegisterPendingSave={!isGlobalTrashEntry ? registerPendingPanelSave : undefined}
              onPrimaryActionChange={!isGlobalTrashEntry ? registerPrimaryShortcutAction : undefined}
              extraSecondaryActions={documentPanelExtraActions}
              undoControl={activeUndoControl}
              navigation={!isGlobalTrashEntry ? {
                canSkip: Boolean(nextId),
                onSkip: skipToNext,
              } : undefined}
            />
            <SplitResizer
              containerRef={splitContainerRef}
              width={splitWidth}
              onWidthChange={setSplitWidth}
              label="Resize document and invoice panels"
            />
          </div>
        </div>
      ) : (
        <InvoiceDetailWorkspace
          header={(
            <DocumentPanelHeader
              title={<DocumentHeaderFileLink record={invoice} className="max-w-full sm:max-w-[32rem]" />}
              onBack={() => navigateTo(backHref)}
              classificationSlot={spectrumReturnSlot}
              navigation={headerNavigation}
              className="bg-card"
            />
          )}
          document={(
            <SourceDocumentViewer
              key={invoice.id}
              record={invoice}
              className="h-full"
              imageAlt="Invoice attachment"
              viewerTitle="Invoice document"
            />
          )}
          statusStrip={(
            <div className="flex min-h-9 items-center gap-2 px-3 py-1.5">
              <div className="flex items-center gap-1.5">
                <Select
                  value={invoice.classification}
                  disabled={isGlobalTrashEntry || reclassifyPending}
                  onValueChange={(val) => {
                    if (isGlobalTrashEntry) return;
                    if (val === invoice.classification) return;
                    setReclassifyPending(true);
                    reclassify.mutate(
                      { id: invoice.id, classification: val },
                      {
                        onSuccess: () => void refetchInvoice(),
                        onSettled: () => setReclassifyPending(false),
                      },
                    );
                  }}
                >
                  <SelectTrigger aria-label="Reclassify invoice" className="h-8 w-auto min-w-[132px] gap-1 border-dashed px-2.5 text-sm">
                    <SelectValue>
                      <ClassificationSelectValue
                        classification={invoice.classification}
                        label={currentClassification?.label}
                      />
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(classifications ?? [])
                      .filter((c: ClassificationInfo) => c.status === "active")
                      .map((c: ClassificationInfo) => (
                        <ClassificationSelectItem
                          key={c.name}
                          classification={c.name}
                          label={c.label}
                          className="text-sm"
                        />
                      ))}
                  </SelectContent>
                </Select>
                {reclassifyPending && (
                  <span className="text-xs text-muted-foreground">...</span>
                )}
              </div>

              <DocumentStatPill
                tone={getInvoiceStatusTone(invoice.status)}
                label={formatStatusLabel(invoice.status)}
                pulse={invoice.status === "retry-pending"}
              />

              {!isGlobalTrashEntry && <FlagToggleGlyph record={invoice} shortcutEnabled />}

              <div className="flex-1" />

              {invoice.spFileUrl && (
                <DocumentStatPill tone="ok" label="Filed to SP" />
              )}

              {detailAlerts.length > 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <DocumentAlertCountPill count={detailAlerts.length} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end" className="max-w-xs">
                    <ul className="space-y-1 text-xs">
                      {detailAlerts.map((msg) => (
                        <li key={msg} className="flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                          {msg}
                        </li>
                      ))}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              ) : null}

              {!isGlobalTrashEntry && (isInvoiceLike || documentPanelExtraActions.length > 0) && (
                <>
                  <Separator orientation="vertical" className="h-4" />
                  {isInvoiceLike ? (
                    <WaiverPairingSection
                      invoice={invoice}
                      compact
                      compactActions={[...documentPanelExtraActions, ...invoiceCollaborationActions]}
                      canComment={canComment}
                      readOnly={isGlobalTrashEntry}
                      routeFamily="invoice"
                      classificationMappings={classificationMappings}
                    />
                  ) : (
                    <DocumentActionsDropdown actions={documentPanelExtraActions} />
                  )}
                </>
              )}
            </div>
          )}
          tabs={detailTabs}
          activeTab={effectiveActiveTab}
          onTabChange={handleDetailTabChange}
          hasUnsavedChanges={hasUnsavedChanges}
          resolveTray={!isGlobalTrashEntry && resolveRows.length + activeNotices.length > 0 ? (
            <InvoiceResolveTray
              invoice={invoice}
              rows={resolveRows}
              duplicateStatus={liveDuplicateStatus}
              discardPending={discardInvoice.isPending}
              onDiscard={discardDuplicate}
              onDiscarded={navigateAfterDuplicateDiscard}
            />
          ) : null}
          footer={!isGlobalTrashEntry ? (
            <InvoiceActionBar
              onClosedPeriodRecoveryChange={setClosedPeriodTrayAction}
              invoiceId={invoice.id}
              invoice={invoice}
              classification={invoice.classification}
              invoiceStatus={invoice.status}
              formRef={formRef}
              hasUnsavedChanges={hasUnsavedChanges}
              approvalPreview={approvalPreview}
              approvalOverrides={approvalOverrides ?? undefined}
              classificationMappings={classificationMappings}
              hasPendingApprovalSave={hasPendingAllocationSave}
              onBeforeApprove={saveAllocationBeforeApprove}
              onActionSuccess={() => {
                goToNextOrBack();
              }}
              onDiscardNav={() => {
                if (!nextId && neighborsUnresolved) {
                  toast.error("Couldn't load queue position", {
                    description: "Returning to the queue — the discard itself completed.",
                  });
                }
                const href = nextId
                  ? `/accounting/invoices/${nextId}${navQs}`
                  : backHref;
                navigateTo(href, { skipPanelSave: true });
              }}
              onApproveSuccess={(data) => {
                rememberRecentUndoAction(invoice.id, data.action, "Approve", getDocumentUndoLabel(invoice));
              }}
              onSkip={nextId ? () => {
                navigateTo(`/accounting/invoices/${nextId}${navQs}`);
              } : undefined}
              undoControl={activeUndoControl}
              spectrumSubmitControl={spectrumSubmitControl ?? undefined}
              waiverGateBlocked={missingWaiverAttention}
              duplicateFlagged={duplicateFlagged}
              onPrimaryActionChange={registerPrimaryShortcutAction}
              onDiscardSuccess={(data) => {
                rememberRecentUndoAction(invoice.id, data.action, "Discard", getDocumentUndoLabel(invoice));
              }}
            />
          ) : undefined}
        >
          {spectrumSubmitResolveIssue && <PanelNotice id="spectrum-return-issue" label="Spectrum submission needs attention"><SpectrumSubmitResolveNotice issue={spectrumSubmitResolveIssue} /></PanelNotice>}
          <div hidden={effectiveActiveTab !== "details"} className="contents" data-testid="detail-tab-details">
              {invoice.status === "duplicate" && (
                <PanelNotice id="duplicate-status" label="Duplicate">
                <div className="flex flex-wrap gap-1.5 border-b pb-4">
                  {invoice.status === "duplicate" && (
                    <Badge variant="outline" className="gap-1 border-border bg-muted px-2 py-0.5 text-2xs text-muted-foreground">
                      <AlertTriangle className="h-3 w-3" />
                      Duplicate
                      {invoice.duplicateOf && (
                        <Link href={`/accounting/invoices/${invoice.duplicateOf}`} className="ml-0.5 underline">
                          View original
                        </Link>
                      )}
                    </Badge>
                  )}
                </div>
                </PanelNotice>
              )}

              <InvoiceEmailGlance email={invoice.email} body={emailBody} />

              {!isGlobalTrashEntry && invoice.status === "pending" && (
                <DuplicateBypassNote invoice={invoice} duplicateStatus={liveDuplicateStatus} />
              )}

              {!isGlobalTrashEntry && <DocumentAttachmentDropZone record={invoice} />}

              <fieldset disabled={isGlobalTrashEntry} className="contents" aria-label={isGlobalTrashEntry ? "Read-only invoice details" : undefined}>
                <section className="pb-2">
                  <InvoiceDetailForm
                    ref={formRef}
                    invoice={invoice}
                    readOnly={isGlobalTrashEntry}
                    onSaved={() => { /* invalidation handled by mutation */ }}
                    onDirtyChange={setHasUnsavedChanges}
                    onApprovalPreviewChange={handleApprovalPreviewChange}
                  />
                </section>
              </fieldset>

              {/* Other Parameters + Spectrum submit machinery live on Details so
                  they stay MOUNTED for every invoice (incl. single-phase), not
                  only when an Allocation tab happens to be shown. Kept whole —
                  the param grid and submit footer are one unit. The negative
                  margins undo the workspace padding since the section renders
                  its own flush `px-4 py-3 border-b`. */}
              {!isGlobalTrashEntry && <div className="-mx-4 -my-4">
                <SpectrumSubmitSection
                  invoice={invoice}
                  approvalPreview={approvalPreview}
                  onOverrideChange={setApprovalOverrides}
                  onSubmitControlChange={handleSpectrumSubmitControlChange}
                  onBeforeSubmit={saveInvoiceFormBeforeSpectrumSubmit}
                  onSubmitSettled={() => void refetchInvoice()}
                  waiverGateBlocked={missingWaiverAttention}
                />
              </div>}

          </div>

          {!isGlobalTrashEntry && showAllocationTab && (
            <div hidden={effectiveActiveTab !== "allocation"} className="contents" data-testid="detail-tab-allocation">
              <div className="-mx-4 -my-4">
                <MultiPhaseAllocationPanel
                  invoice={invoice}
                  onPendingSaveChange={registerAllocationPendingSave}
                />
              </div>
            </div>
          )}

          {!isGlobalTrashEntry && <div hidden={effectiveActiveTab !== "waiver"} className="contents">
            <section className="-mx-4 -my-4">
              <WaiverPairingSection invoice={invoice} />
            </section>
          </div>}

          <div hidden={effectiveActiveTab !== "activity"} className="contents" data-testid="detail-tab-activity">
              <section>
                <p className="mb-2 flex items-center gap-2 text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
                  <Activity className="h-3.5 w-3.5" />
                  Activity
                </p>
                <ActivityPanel documentId={invoice.id} active={effectiveActiveTab === "activity"} email={invoice.email} fallbackEntries={auditEntries} serverBacked canComment={canComment} canEmail={canEmail} readOnly={activityReadOnly} isTrash={activityTrash} lockedReason={activityLockedReason} unreadReplies={activityUnread.invoiceId === invoice.id ? activityUnread.replies : invoice.unreadReplies} unreadComments={activityUnread.invoiceId === invoice.id ? activityUnread.comments : invoice.unreadComments} routeFamily="invoice" focusSignal={activityComposeFocus} composeRequest={activityComposeRequest?.documentId === invoice.id ? activityComposeRequest : undefined} onActivityViewed={(state) => setActivityUnread({ invoiceId: invoice.id, replies: state.unreadReplies, comments: state.unreadComments })} />
              </section>
          </div>
        </InvoiceDetailWorkspace>
      )}
      </TooltipProvider></PanelNoticeProvider>
      </PanelState>
      </PanelSkeletonHandoff>
    </RouteLifecycleFrame>
  );
}

// useSearchParams() requires a Suspense boundary in Next.js App Router
export default function InvoiceDetailPage() {
  return (
    <Suspense>
      <InvoiceDetailContent />
    </Suspense>
  );
}
