"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Scissors } from "lucide-react";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { DocumentAction } from "@/modules/accounting/modules/invoices/types/documentSpec";
import { DEFAULT_MAPPINGS, useInvoice, useInvoices, useClassifications, useAuditTrail } from "@/modules/accounting/modules/invoices/hooks/queries";
import { useAddStatementLine, useDeleteStatementLine, useDiscardInvoice, useFileDocument, useFlagForSplit, useReclassifyInvoice, useReconcileStatement, useRematchStatementLines, useResolveStatementLine, useUnresolveStatementLine, useUpdateInvoice, useUpdateStatementLine, useUploadCoiToSpectrum } from "@/modules/accounting/modules/invoices/hooks/mutations";
import { StatusColor } from "@/modules/shared/types/ui";
import { cn } from "@/modules/shared/lib/utils";
import { isApiError } from "@/modules/shared/lib/api";
import { usePermissions } from "@/modules/shared/hooks/usePermissions";

import { Badge } from "@/modules/shared/components/ui/badge";
import { DocumentPanelHeader } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanelHeader";
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
import { panelSkeletonTypeForClassification } from "@/modules/accounting/modules/invoices/components/documents/PanelSkeleton";
import { SourceDocumentViewer } from "@/modules/accounting/modules/invoices/components/documents/SourceDocumentViewer";
import { useDocumentPanelUndo, useRecentDocumentUndo, type RecentUndoTarget } from "@/modules/accounting/modules/invoices/components/documents/documentPanelUndo";
import { shouldRenderDocumentPanelRoute, usesInvoiceWorkflow } from "@/modules/accounting/modules/invoices/lib/documentRouting";
import { useCreateRuleFromInvoiceAction } from "@/modules/accounting/modules/invoices/components/invoices/CreateRuleFromInvoice";
import { useReprocessDocumentAction } from "@/modules/accounting/modules/invoices/hooks/useReprocessDocumentAction";
import { useSpectrumRefreshAction } from "@/modules/accounting/modules/invoices/hooks/useSpectrumRefreshAction";

function getDocumentUndoLabel(record: Invoice): string {
  return record.file ?? record.email?.subject ?? record.id;
}

interface NavigationSnapshot {
  key: string;
  items: Invoice[];
  total: number;
}

const EMPTY_NAV_ITEMS: Invoice[] = [];

function findNavigableNeighbor(
  items: Invoice[],
  currentIndex: number,
  direction: -1 | 1,
  activeIds: Set<string>,
): Invoice | null {
  for (let index = currentIndex + direction; index >= 0 && index < items.length; index += direction) {
    const candidate = items[index];
    if (candidate && activeIds.has(candidate.id)) return candidate;
  }
  return null;
}

// ─── DocumentDetailContent ────────────────────────────────────────────────────

function DocumentDetailContent() {
  const params = useParams();
  const router = useRouter();
  const routeSearchParams = useSearchParams();
  const id =
    typeof params.id === "string" ? params.id
    : Array.isArray(params.id) ? params.id[0]
    : "";
  const routeLifecycle = useRouteLifecycle(`document:${id}`);
  const { runControlledNavigation } = routeLifecycle;

  const fromParam = routeSearchParams.get("from");
  const backHref = fromParam ? decodeURIComponent(fromParam) : "/accounting/invoices?status=documents";

  // Nav context params passed from the documents list
  const navPanel = routeSearchParams.get("panel") as Parameters<typeof useInvoices>[0]["panel"];
  const navClassification = routeSearchParams.get("classification") ?? undefined;
  const navStatus = routeSearchParams.get("docStatus") ?? undefined;
  const navSearch = routeSearchParams.get("search") ?? undefined;
  const dashboardStatus = routeSearchParams.get("status") === "documents" ? "documents" : undefined;
  const navSort = routeSearchParams.get("sort") as Parameters<typeof useInvoices>[0]["sort"];
  const navSortDir = routeSearchParams.get("sortDir") as Parameters<typeof useInvoices>[0]["sortDir"];
  const navPage = routeSearchParams.get("page") ?? undefined;
  const navLimit = routeSearchParams.get("limit") ?? undefined;

  // Build navQs for prev/next links (preserves back + nav context)
  const navParams = new URLSearchParams();
  if (fromParam) navParams.set("from", fromParam);
  if (navPanel) navParams.set("panel", navPanel);
  if (navClassification) navParams.set("classification", navClassification);
  if (navStatus) navParams.set("docStatus", navStatus);
  if (navSearch) navParams.set("search", navSearch);
  if (dashboardStatus) navParams.set("status", dashboardStatus);
  if (navSort) navParams.set("sort", navSort);
  if (navSortDir) navParams.set("sortDir", navSortDir);
  if (navPage) navParams.set("page", navPage);
  if (navLimit) navParams.set("limit", navLimit);
  const navQs = navParams.size ? `?${navParams.toString()}` : "";

  const [reclassifyPending, setReclassifyPending] = useState(false);
  const [coiUploadPollingId, setCoiUploadPollingId] = useState<string | null>(null);
  const [activityUnread, setActivityUnread] = useState<{ documentId: string; replies: number; comments: number }>({ documentId: "", replies: 0, comments: 0 });
  const [activityComposeFocus, setActivityComposeFocus] = useState(0);

  const { data: invoice, isLoading, isError, error: invoiceError, refetch: refetchInvoice } = useInvoice(id);
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
  const { data: classifications } = useClassifications();
  const classificationMappings = classifications ?? DEFAULT_MAPPINGS;
  const { data: auditEntries } = useAuditTrail(id);
  const invoiceClassification = invoice?.classification;
  const invoiceId = invoice?.id;
  const discard = useDiscardInvoice();
  const fileDocument = useFileDocument();
  const flagForSplitMutation = useFlagForSplit();
  const updateInvoice = useUpdateInvoice();
  const reclassify = useReclassifyInvoice();
  const reconcileStatement = useReconcileStatement();
  const addStatementLine = useAddStatementLine();
  const updateStatementLine = useUpdateStatementLine();
  const deleteStatementLine = useDeleteStatementLine();
  const rematchStatementLines = useRematchStatementLines();
  const resolveStatementLine = useResolveStatementLine();
  const unresolveStatementLine = useUnresolveStatementLine();
  const uploadCoiToSpectrum = useUploadCoiToSpectrum();
  const { hasAnyPermission } = usePermissions();
  const canComment = hasAnyPermission(["accounting.invoices.view_details"]);
  const canEmail = hasAnyPermission(["accounting.invoices.request_waiver"]);
  const canCreateRule = hasAnyPermission(["accounting.invoices.manage_retention"]);
  const canUploadToSpectrum = hasAnyPermission(["accounting.invoices.submit_spectrum"]);
  const canApproveInvoices = hasAnyPermission(["accounting.invoices.approve"]);
  const pendingPanelSaveRef = useRef<(() => Promise<void>) | null>(null);
  const withSplitReturnParam = useCallback((path: string) => {
    const params = new URLSearchParams();
    params.set("from", fromParam ?? backHref);
    return `${path}?${params.toString()}`;
  }, [backHref, fromParam]);

  const registerPendingPanelSave = useCallback((handler: (() => Promise<void>) | null) => {
    pendingPanelSaveRef.current = handler;
  }, []);

  useEffect(() => {
    const onCompose = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId?: string }>).detail;
      if (detail?.documentId !== id) return;
      setActivityComposeFocus((value) => value + 1);
    };
    window.addEventListener("document-collaboration-compose", onCompose);
    return () => window.removeEventListener("document-collaboration-compose", onCompose);
  }, [id]);

  const navigateAfterPanelSave = useCallback(async (href: string) => {
    await pendingPanelSaveRef.current?.();
    await runControlledNavigation(() => router.push(href));
  }, [router, runControlledNavigation]);

  const navigateTo = useCallback((href: string, options?: { skipPanelSave?: boolean }) => {
    if (options?.skipPanelSave) {
      void runControlledNavigation(() => router.push(href));
      return;
    }
    void navigateAfterPanelSave(href);
  }, [navigateAfterPanelSave, router, runControlledNavigation]);

  useEffect(() => {
    if (!coiUploadPollingId || invoice?.id !== coiUploadPollingId) return;
    if (
      invoice.spectrumUploadStatus === "success" ||
      invoice.spectrumUploadStatus === "failed" ||
      invoice.lastSpectrumError ||
      invoice.status === "reviewed" ||
      invoice.status === "submitted"
    ) {
      return;
    }

    const timer = setInterval(() => void refetchInvoice(), 3_000);
    return () => clearInterval(timer);
  }, [coiUploadPollingId, invoice?.id, invoice?.lastSpectrumError, invoice?.spectrumUploadStatus, invoice?.status, refetchInvoice]);
  const currentUndoControl = useDocumentPanelUndo(id, {
    enabled: Boolean(invoice && shouldRenderDocumentPanelRoute(invoice.classification, classificationMappings)),
  });
  const handleRecentUndoSuccess = useCallback((target: RecentUndoTarget) => {
    navigateTo(`/accounting/documents/${target.invoiceId}${navQs}`, { skipPanelSave: true });
  }, [navigateTo, navQs]);
  const recentUndoOptions = useMemo(
    () => ({ onUndoSuccess: handleRecentUndoSuccess }),
    [handleRecentUndoSuccess],
  );
  const {
    undoControl: documentPanelUndo,
    rememberAction: rememberRecentUndoAction,
  } = useRecentDocumentUndo(currentUndoControl, recentUndoOptions);

  // Navigation list — fetches all docs matching current filters for prev/next
  const { data: allDocs } = useInvoices({
    filed: true,
    limit: 200,
    panel: navPanel,
    classification: navClassification,
    status: navStatus as Parameters<typeof useInvoices>[0]["status"],
    search: navSearch,
    sort: navSort,
    sortDir: navSortDir,
  });

  const rawDocList: Invoice[] = allDocs?.invoices ?? EMPTY_NAV_ITEMS;
  const navListKey = [
    navPanel ?? "",
    navClassification ?? "",
    navStatus ?? "",
    navSearch ?? "",
    navSort ?? "",
    navSortDir ?? "",
  ].join("|");
  const [navigationSnapshot, setNavigationSnapshot] = useState<NavigationSnapshot>({ key: "", items: [], total: 0 });

  useEffect(() => {
    setNavigationSnapshot((current) => {
      if (rawDocList.length === 0) {
        return current.key === navListKey && current.items.length === 0
          ? current
          : { key: navListKey, items: [], total: 0 };
      }

      const rawContainsCurrent = rawDocList.some((doc) => doc.id === id);
      const snapshotContainsCurrent = current.key === navListKey && current.items.some((doc) => doc.id === id);
      if (current.key !== navListKey || current.items.length === 0 || (!snapshotContainsCurrent && rawContainsCurrent)) {
        return { key: navListKey, items: rawDocList, total: allDocs?.total ?? rawDocList.length };
      }
      return current;
    });
  }, [allDocs?.total, id, navListKey, rawDocList]);

  const docList = navigationSnapshot.key === navListKey && navigationSnapshot.items.length > 0
    ? navigationSnapshot.items
    : rawDocList;
  const activeDocIds = useMemo(() => new Set(rawDocList.map((doc) => doc.id)), [rawDocList]);
  const currentIndex = docList.findIndex((doc: Invoice) => doc.id === id);
  const prevDoc = currentIndex >= 0 ? findNavigableNeighbor(docList, currentIndex, -1, activeDocIds) : null;
  const nextDoc = currentIndex >= 0 ? findNavigableNeighbor(docList, currentIndex, 1, activeDocIds) : null;
  const spectrumRefreshAction = useSpectrumRefreshAction({
    enabled: Boolean(invoice),
  });
  const {
    action: reprocessAction,
    dialog: reprocessDialog,
  } = useReprocessDocumentAction({ documentId: invoice?.id, enabled: Boolean(invoice) });
  const canSplitDocument = Boolean(
    invoice?.file?.toLowerCase().endsWith(".pdf")
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
          navigateTo(withSplitReturnParam(`/accounting/invoices/splits/${invoice.id}`));
          return;
        }
        flagForSplitMutation.mutate(
          { id: invoice.id },
          {
            onSuccess: () => {
              navigateTo(withSplitReturnParam(`/accounting/invoices/splits/${invoice.id}`));
            },
          },
        );
      },
    }
    : undefined;
  const {
    action: createRuleAction,
    modal: createRuleModal,
  } = useCreateRuleFromInvoiceAction({
    invoice,
    previewInvoices: docList,
    enabled: Boolean(invoice && canCreateRule),
    onAppliedTerminalRule: advance,
  });
  const documentRouteActions: DocumentAction[] = [];
  if (createRuleAction) documentRouteActions.push(createRuleAction);
  if (reprocessAction) documentRouteActions.push(reprocessAction);
  if (spectrumRefreshAction) documentRouteActions.push(spectrumRefreshAction);
  // eslint-disable-next-line react-hooks/refs -- the save ref is only read from the split click handler, not during render.
  if (splitDocumentAction) documentRouteActions.push(splitDocumentAction);

  // Auto-advance: go to next doc, then prev, then back to list
  function advance() {
    if (nextDoc) { navigateTo(`/accounting/documents/${nextDoc.id}${navQs}`); return; }
    if (prevDoc) { navigateTo(`/accounting/documents/${prevDoc.id}${navQs}`); return; }
    navigateTo(backHref);
  }

  useEffect(() => {
    if (!invoiceClassification || !invoiceId || !usesInvoiceWorkflow(invoiceClassification, classificationMappings)) return;
    const params = new URLSearchParams();
    if (fromParam) params.set("from", fromParam);
    const query = params.size ? `?${params.toString()}` : "";
    void runControlledNavigation(() => router.replace(`/accounting/invoices/${invoiceId}${query}`));
  }, [classificationMappings, fromParam, invoiceClassification, invoiceId, router, runControlledNavigation]);

  if (!invoice) {
    return (
      <RouteLifecycleFrame lifecycle={routeLifecycle}>
        <DocumentStateSelector value={devPanelState.selectedPhase} onChange={devPanelState.setSelectedPhase} retryingLoaderSize={devPanelState.retryingLoaderSize} onRetryingLoaderSizeChange={devPanelState.setRetryingLoaderSize} />
        <PanelSkeletonHandoff key={routeLifecycle.identity} identity={routeLifecycle.identity} phase={panelPhase} type="other">
          <PanelState phase={panelPhase.phase} onRetry={() => void refetchInvoice()} onBack={() => navigateTo(backHref)} backHref={backHref} errorDetail={errorDetail} retryingLoaderSize={devPanelState.retryingLoaderSize} />
        </PanelSkeletonHandoff>
      </RouteLifecycleFrame>
    );
  }

  // ─── Derived values ────────────────────────────────────────────────────────

  const isTerminal = invoice.status === "reviewed" || invoice.status === "discarded";
  const documentTitle = invoice.email?.subject ?? invoice.file ?? "Document";
  const documentFilename = invoice.email?.subject ? invoice.file ?? undefined : undefined;
  const headerNavigation = currentIndex >= 0
    ? {
      current: currentIndex + 1,
      total: navigationSnapshot.key === navListKey ? navigationSnapshot.total : allDocs?.total ?? docList.length,
      onPrevious: prevDoc ? () => navigateTo(`/accounting/documents/${prevDoc.id}${navQs}`) : undefined,
      onNext: nextDoc ? () => navigateTo(`/accounting/documents/${nextDoc.id}${navQs}`) : undefined,
      previousDisabled: !prevDoc,
      nextDisabled: !nextDoc,
    }
    : undefined;

  if (!shouldRenderDocumentPanelRoute(invoice.classification, classificationMappings)) {
    return (
      <RouteLifecycleFrame lifecycle={routeLifecycle}>
        <DocumentStateSelector value={devPanelState.selectedPhase} onChange={devPanelState.setSelectedPhase} retryingLoaderSize={devPanelState.retryingLoaderSize} onRetryingLoaderSizeChange={devPanelState.setRetryingLoaderSize} />
        <PanelSkeletonHandoff key={routeLifecycle.identity} identity={routeLifecycle.identity} phase={panelPhase} type="other">
          <PanelState phase={panelPhase.phase} onRetry={() => void refetchInvoice()} onBack={() => navigateTo(backHref)} backHref={backHref} errorDetail={errorDetail} retryingLoaderSize={devPanelState.retryingLoaderSize}>
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Opening invoice detail...
            </div>
          </PanelState>
        </PanelSkeletonHandoff>
      </RouteLifecycleFrame>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <RouteLifecycleFrame lifecycle={routeLifecycle}>
      <DocumentStateSelector value={devPanelState.selectedPhase} onChange={devPanelState.setSelectedPhase} retryingLoaderSize={devPanelState.retryingLoaderSize} onRetryingLoaderSizeChange={devPanelState.setRetryingLoaderSize} />
      <PanelSkeletonHandoff key={routeLifecycle.identity} identity={routeLifecycle.identity} phase={panelPhase} type={panelSkeletonTypeForClassification(invoice.classification)}>
      <PanelState phase={panelPhase.phase} onRetry={() => void refetchInvoice()} onBack={() => navigateTo(backHref)} backHref={backHref} errorDetail={errorDetail} retryingLoaderSize={devPanelState.retryingLoaderSize} emptySlot={<TabEmpty />}>
      <div className="flex flex-col h-full overflow-hidden">
        {createRuleModal}
        {reprocessDialog}
        <DocumentPanelHeader
          title={documentTitle}
          filename={documentFilename}
          onBack={() => navigateTo(backHref)}
          actionsSlot={invoice.status ? (
            <Badge
              variant="outline"
              className={cn("text-xs capitalize shrink-0", (StatusColor as Record<string, string>)[invoice.status] ?? "")}
            >
              {invoice.status}
            </Badge>
          ) : undefined}
          navigation={headerNavigation}
        />

      {/* ── Two-panel split ────────────────────────────────────────────────── */}
      <div ref={splitContainerRef} style={splitContainerStyle} className={`${splitStyles.splitShell} flex flex-1 overflow-hidden flex-col min-[1100px]:flex-row min-h-0`}>

        <SourceDocumentViewer
          key={invoice.id}
          record={invoice}
          className={`${splitStyles.splitPane} min-[1100px]:w-[var(--split-doc-width)] min-[1100px]:h-auto h-[45vh]`}
          imageAlt="Document attachment"
          viewerTitle="Document viewer"
        />

        <DocumentPanelRouteSurface
          record={invoice}
          splitDocumentAction={splitDocumentAction}
          className={`${splitStyles.splitPane} min-[1100px]:w-[calc(100%_-_var(--split-doc-width))] border-t min-[1100px]:border-t-0 min-[1100px]:border-l flex-1`}
          classifications={classifications}
          allowInvoiceClassification={false}
          auditEntries={auditEntries}
          serverBackedActivity
          canComment={canComment}
          canEmail={canEmail}
          unreadReplies={activityUnread.documentId === invoice.id ? activityUnread.replies : invoice.unreadReplies}
          unreadComments={activityUnread.documentId === invoice.id ? activityUnread.comments : invoice.unreadComments}
          onActivityViewed={(state) => setActivityUnread({ documentId: invoice.id, replies: state.unreadReplies, comments: state.unreadComments })}
          focusSignal={activityComposeFocus}
          routeFamily="document"
          onReclassify={(classification) => {
            if (classification === invoice.classification) return;
            setReclassifyPending(true);
            reclassify.mutate(
              { id, classification },
              {
                onSuccess: () => {
                  if (!usesInvoiceWorkflow(classification, classificationMappings)) return;
                  const params = new URLSearchParams();
                  if (fromParam) params.set("from", fromParam);
                  const query = params.size ? `?${params.toString()}` : "";
                  void runControlledNavigation(() => router.replace(`/accounting/invoices/${id}${query}`));
                },
                onSettled: () => setReclassifyPending(false),
              },
            );
          }}
          reclassifyPending={reclassifyPending}
          reclassifyDisabled={isTerminal}
          onDiscard={(record) => discard.mutate(
            { id: record.id },
            {
              onSuccess: (data) => {
                rememberRecentUndoAction(record.id, data.action, "Discard", getDocumentUndoLabel(record));
                advance();
              },
            },
          )}
          discardPending={discard.isPending}
          discardDisabled={isTerminal}
          onFileToProject={async (record, meta) => {
            const data = await fileDocument.mutateAsync({ id: record.id, ...meta });
            if (data.sharePoint?.uploaded !== false) {
              rememberRecentUndoAction(record.id, data.action, "File to Project", getDocumentUndoLabel(record));
            }
            return data;
          }}
          onFile={async (record, meta) => {
            const data = await fileDocument.mutateAsync({ id: record.id, ...meta });
            if (!meta?.uploadToSharePoint || data.sharePoint?.uploaded !== false) {
              rememberRecentUndoAction(
                record.id,
                data.action,
                meta?.uploadToSharePoint ? "File to Project" : "Shelve",
                getDocumentUndoLabel(record),
              );
            }
            return data;
          }}
          onUpdateDocument={(record, payload) => updateInvoice.mutateAsync({ id: record.id, payload, suppressErrorToast: true })}
          onLienWaiverLinkComplete={() => advance()}
          filePending={fileDocument.isPending}
          fileToProjectPending={fileDocument.isPending}
          extraSecondaryActions={documentRouteActions}
          undoControl={documentPanelUndo}
          onReconcile={async (record) => {
            const data = await reconcileStatement.mutateAsync({ id: record.id });
            advance();
            return data;
          }}
          reconcilePending={reconcileStatement.isPending}
          onAddStatementLine={canApproveInvoices ? (record, payload) => addStatementLine.mutateAsync({ id: record.id, payload }) : undefined}
          onUpdateStatementLine={canApproveInvoices ? (record, lineId, payload) => updateStatementLine.mutateAsync({ id: record.id, lineId, payload }) : undefined}
          onDeleteStatementLine={canApproveInvoices ? (record, lineId) => deleteStatementLine.mutateAsync({ id: record.id, lineId }) : undefined}
          onRematchStatementLines={canApproveInvoices ? (record) => rematchStatementLines.mutateAsync({ id: record.id }) : undefined}
          onResolveStatementLine={canApproveInvoices ? (record, lineId, payload) => resolveStatementLine.mutateAsync({ id: record.id, lineId, payload }) : undefined}
          onUnresolveStatementLine={canApproveInvoices ? (record, lineId) => unresolveStatementLine.mutateAsync({ id: record.id, lineId }) : undefined}
          rematchStatementLinesPending={rematchStatementLines.isPending}
          onUploadToSpectrum={canUploadToSpectrum ? async (record, payload) => {
            const response = await uploadCoiToSpectrum.mutateAsync({ id: record.id, payload });
            setCoiUploadPollingId(record.id);
            void refetchInvoice();
            return response;
          } : undefined}
          uploadToSpectrumPending={uploadCoiToSpectrum.isPending}
          onViewDocument={(record) => navigateTo(`/accounting/documents/${record.id}${navQs}`)}
          onRegisterPendingSave={registerPendingPanelSave}
          navigation={{
            canSkip: Boolean(nextDoc),
            onSkip: nextDoc ? () => navigateTo(`/accounting/documents/${nextDoc.id}${navQs}`) : undefined,
          }}
        />
        <SplitResizer
          containerRef={splitContainerRef}
          width={splitWidth}
          onWidthChange={setSplitWidth}
          label="Resize document and panel"
        />
      </div>
      </div>
      </PanelState>
      </PanelSkeletonHandoff>
    </RouteLifecycleFrame>
  );
}

export default function DocumentDetailPage() {
  return (
    <Suspense>
      <DocumentDetailContent />
    </Suspense>
  );
}
