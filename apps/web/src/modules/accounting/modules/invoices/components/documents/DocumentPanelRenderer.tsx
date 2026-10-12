"use client";

import type { ReactNode } from "react";
import { PanelNoticeProvider, usePanelNotices } from "./PanelNotice";
import { FloatingResolveRegion } from "./FloatingResolveRegion";
import { revealDocumentSection } from "./revealDocumentSection";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, FileText } from "lucide-react";

import { DocumentChecklistCard, DocumentSection } from "@/modules/accounting/modules/invoices/components/documents/DocumentAtoms";
import { DocumentActionsDropdown } from "@/modules/accounting/modules/invoices/components/documents/DocumentActionsDropdown";
import { DocumentEmailSection } from "@/modules/accounting/modules/invoices/components/documents/DocumentEmailSection";
import { DocumentPanelFooter } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanelFooter";
import { DocumentPanelTabs } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanelTabs";
import { DocumentResolveTray } from "@/modules/accounting/modules/invoices/components/documents/DocumentResolveTray";
import { DocumentStatusStrip } from "@/modules/accounting/modules/invoices/components/documents/DocumentStatusStrip";
import { ActivityPanel, collaborationActionsFor, type CollaborationComposeRequest } from "@/modules/accounting/modules/invoices/components/activity/ActivityPanel";
import { CommentPopoverHost } from "@/modules/accounting/modules/invoices/components/activity/CommentPopoverHost";
import type { CollaborationRouteFamily } from "@/modules/accounting/modules/invoices/hooks/collaborationRoutes";
import type { DocumentPanelShortcutAction } from "@/modules/accounting/modules/invoices/components/documents/documentPanelShortcuts";
import type { AuditEntry } from "@/modules/accounting/modules/invoices/types/api";
import type {
  DocumentAction,
  DocumentAlert,
  DocumentPanelNavigation,
  DocumentPanelUndoControl,
  DocumentSpecOutput,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import { getDocumentAlertRevision, isDocumentAlertDismissible, isDocumentAlertNotice, isNoticeOnly } from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { InvoiceEmail } from "@/modules/accounting/modules/invoices/types/invoice";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";

interface DocumentPanelRendererProps {
  documentId?: string;
  output: DocumentSpecOutput;
  actions?: readonly DocumentAction[];
  navigation?: DocumentPanelNavigation;
  undoControl?: DocumentPanelUndoControl;
  leadingContent?: ReactNode;
  email?: InvoiceEmail | null;
  emailSupplement?: ReactNode;
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

export function DocumentPanelRenderer({
  ...props
}: DocumentPanelRendererProps) {
  return <PanelNoticeProvider documentId={props.documentId ?? "document"}><DocumentPanelRendererContent {...props} /></PanelNoticeProvider>;
}

function DocumentPanelRendererContent({
  documentId,
  output,
  actions = [],
  navigation,
  undoControl,
  leadingContent,
  email,
  emailSupplement,
  onPrimaryActionChange,
  auditEntries,
  serverBackedActivity = false,
  canComment = false,
  canEmail = false,
  readOnly = false,
  isTrash = false,
  lockedReason,
  unreadReplies = 0,
  unreadComments = 0,
  onActivityViewed,
  focusSignal = 0,
  routeFamily = "document",
}: DocumentPanelRendererProps) {
  // Dismissals are this viewer's, for this mount and document only; a reload, another document or new alert content shows the card again.
  const [dismissedAlerts, setDismissedAlerts] = useState<{ documentId?: string; revisions: readonly string[] }>({ documentId, revisions: [] });
  const dismissedRevisions = dismissedAlerts.documentId === documentId ? dismissedAlerts.revisions : [];
  const alerts = (output.alerts ?? []).filter((alert) => !(isDocumentAlertDismissible(alert) && dismissedRevisions.includes(getDocumentAlertRevision(alert))));
  const notices = usePanelNotices();
  const usesActivityTabs = auditEntries !== undefined;
  const tabs = useMemo(
    () => {
      if (!usesActivityTabs) return output.tabs ?? [];
      const baseTabs = output.tabs ?? [{ id: "details", label: "Details", icon: FileText }];
      return baseTabs.some((tab) => tab.id === "activity")
        ? baseTabs
        : [...baseTabs, { id: "activity", label: "Activity", icon: Activity }];
    },
    [output.tabs, usesActivityTabs],
  );
  const usesInvoiceDetailTabs = output.tabStyle === "invoice-detail";
  const checklist = output.checklist ?? [];
  const mode = usesActivityTabs
    ? "tabs"
    : output.preferredRenderer ?? (checklist.length > 0 ? "checklist" : tabs.length > 0 ? "tabs" : "scroll");
  const [activeTabState, setActiveTabState] = useState(() => ({
    documentId,
    tabId: tabs[0]?.id ?? "",
  }));
  const [composeFocus, setComposeFocus] = useState(0);
  const [composeRequest, setComposeRequest] = useState<CollaborationComposeRequest>({ mode: null, sequence: 0 });
  const [review, setReview] = useState<{ alert: DocumentAlert; sequence: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLElement>(null);
  const activeTab = activeTabState.documentId === documentId
    ? activeTabState.tabId
    : tabs[0]?.id ?? "";
  const active = tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0]?.id ?? "";
  useEffect(() => {
    const onCompose = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId?: string; mode?: "reply" | "forward" }>).detail;
      const requestedMode = detail?.mode;
      if (detail?.documentId !== documentId || !requestedMode) return;
      setActiveTabState({ documentId, tabId: tabs.some((tab) => tab.id === "activity") ? "activity" : active });
      setComposeRequest((current) => ({ mode: requestedMode, sequence: current.sequence + 1 }));
      setComposeFocus((value) => value + 1);
    };
    window.addEventListener("document-collaboration-compose", onCompose);
    return () => window.removeEventListener("document-collaboration-compose", onCompose);
  }, [active, documentId, tabs]);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [documentId]);
  // Runs after a requested tab switch commits, so the target section is visible before it is revealed.
  useEffect(() => {
    const pane = scrollRef.current;
    if (!review || !pane) return;
    const { sectionId, fieldId } = review.alert;
    if (sectionId && revealDocumentSection(pane, sectionId, fieldId)) return;
    pane.scrollTo({ top: 0, behavior: "smooth" });
  }, [review]);
  const displaySections = useMemo(() => {
    if (auditEntries === undefined) return output.sections;
    const activityTabId = tabs.find((tab) => tab.id === "activity")?.id;
    if (!activityTabId) return output.sections;
    return [
      ...output.sections.map((section) => ({
        ...section,
        tabId: section.tabId ?? tabs[0]?.id ?? "details",
      })),
      {
        id: "document-activity",
        tabId: activityTabId,
        title: "Activity",
        icon: Activity,
        children: <ActivityPanel documentId={documentId ?? "document"} active={active === activityTabId} email={email} fallbackEntries={auditEntries} serverBacked={serverBackedActivity} canComment={canComment} canEmail={canEmail} readOnly={readOnly} isTrash={isTrash} lockedReason={lockedReason} unreadReplies={unreadReplies} unreadComments={unreadComments} onActivityViewed={onActivityViewed} focusSignal={focusSignal + composeFocus} composeRequest={composeRequest} routeFamily={routeFamily} />,
      },
    ];
  }, [active, auditEntries, canComment, canEmail, composeFocus, composeRequest, documentId, email, focusSignal, isTrash, lockedReason, onActivityViewed, output.sections, readOnly, routeFamily, serverBackedActivity, tabs, unreadComments, unreadReplies]);
  const sectionsByTab = useMemo(
    () => tabs.map((tab) => ({
      tabId: tab.id,
      sections: displaySections.filter((section) => (section.tabId ?? tabs[0]?.id ?? "") === tab.id),
    })),
    [displaySections, tabs],
  );

  const footerNote = output.footerNote;
  const dropdownActions = useMemo(
    () => [...actions, ...(output.secondaryActions ?? []), ...(documentId ? collaborationActionsFor(documentId, email, { canEmail, readOnly, isTrash }) : [])],
    [actions, canEmail, documentId, email, isTrash, output.secondaryActions, readOnly],
  );

  function jumpToSection(sectionId: string) {
    const pane = scrollRef.current;
    if (!pane) return;
    const target = Array.from(pane.querySelectorAll<HTMLElement>("[data-document-section-id]"))
      .find((node) => node.dataset.documentSectionId === sectionId);
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  return (
    <div className={`${motionStyles.spinnerScope} flex min-h-0 flex-1 flex-col`}>
      <DocumentStatusStrip
        header={output.header}
        alertCount={alerts.length + notices.filter((notice) => !notice.resolved).length}
        alertsNoticeOnly={isNoticeOnly([...alerts.map((alert) => ({ notice: isDocumentAlertNotice(alert) })), ...notices.filter((notice) => !notice.resolved).map(() => ({}))])}
        actions={documentId && (dropdownActions.length > 0 || canComment) ? <CommentPopoverHost documentId={documentId} routeFamily={routeFamily} actions={dropdownActions} canComment={canComment && !readOnly} /> : dropdownActions.length > 0 ? <DocumentActionsDropdown actions={dropdownActions} /> : undefined}
        leadingContent={leadingContent}
        onResolveClick={() => trayRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })}
      />
      {mode === "tabs" && tabs.length > 0 && (
        <DocumentPanelTabs
          documentId={documentId}
          tabs={tabs}
          alerts={[...alerts, ...notices.filter((notice) => !notice.resolved).map((notice) => ({ id: notice.id, label: notice.label, tabId: notice.tabId, tone: "warn" as const }))]}
          activityUnreadCount={unreadReplies + unreadComments}
          activeTabId={active}
          invoiceDetailStyle={usesInvoiceDetailTabs}
          onTabChange={(tabId) => setActiveTabState({ documentId, tabId })}
        />
      )}
      <FloatingResolveRegion scrollRef={scrollRef} tray={alerts.length + notices.filter((notice) => !notice.resolved).length > 0 ? <DocumentResolveTray documentId={documentId} alerts={alerts} trayRef={trayRef} onReview={(alert) => {
        // Alerts without an explicit tab go to the tab that owns their section (Details in production tabs mode).
        // A section without a tabId renders in the first tab (sectionsByTab), so that is where its review goes.
        const reviewSection = alert.sectionId ? displaySections.find((section) => section.id === alert.sectionId) : undefined;
        const reviewTabId = alert.tabId ?? (reviewSection ? reviewSection.tabId ?? tabs[0]?.id : undefined);
        if (reviewTabId && tabs.some((tab) => tab.id === reviewTabId)) setActiveTabState({ documentId, tabId: reviewTabId });
        setReview((current) => ({ alert, sequence: (current?.sequence ?? 0) + 1 }));
      }} onDismiss={(alert) => setDismissedAlerts((current) => ({
        documentId,
        revisions: [...(current.documentId === documentId ? current.revisions : []), getDocumentAlertRevision(alert)],
      }))} /> : null}>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-[18px] overflow-y-auto px-6 py-[22px]" style={{ paddingBottom: "calc(var(--resolve-tray-height, 0px) + 22px)", scrollPaddingBottom: "var(--resolve-tray-height, 0px)" }}>
        {mode === "tabs" && tabs.length > 0 ? (
          sectionsByTab.map(({ tabId, sections }) => (
            <div
              key={tabId}
              id={`document-tabpanel-${documentId ?? "panel"}-${tabId}`}
              role="tabpanel"
              aria-labelledby={`document-tab-${documentId ?? "panel"}-${tabId}`}
              hidden={active !== tabId}
              className={active === tabId ? `${motionStyles.documentTabBody} space-y-[18px]` : "hidden"}
            >
              {tabId === tabs[0]?.id && email && (
                <DocumentEmailSection
                  key={documentId}
                  email={email}
                  presentation="glance"
                  className="rounded-xl border border-border bg-card p-4"
                />
              )}
              {tabId === tabs[0]?.id ? emailSupplement : null}
              {sections.map((section) => (
                <DocumentSection key={section.id} section={section} />
              ))}
            </div>
          ))
        ) : (
          <>
            {email && (
              <DocumentEmailSection
                key={documentId}
                email={email}
                presentation="glance"
                className="rounded-xl border border-border bg-card p-4"
              />
            )}
            {emailSupplement}
            {mode === "checklist" && checklist.length > 0 && (
              <DocumentChecklistCard items={checklist} onJump={jumpToSection} />
            )}
            {displaySections.map((section) => (
              <DocumentSection key={section.id} section={section} />
            ))}
          </>
        )}
      </div>
      </FloatingResolveRegion>
      <DocumentPanelFooter
        primaryAction={output.primaryAction}
        navigation={navigation}
        note={footerNote}
        undoControl={undoControl}
        onPrimaryActionChange={onPrimaryActionChange}
      />
    </div>
  );
}
