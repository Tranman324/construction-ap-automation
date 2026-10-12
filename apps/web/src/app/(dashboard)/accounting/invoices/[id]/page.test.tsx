import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { ClassificationInfo, DashboardStats, InvoiceUpdatePayload } from "@/modules/accounting/modules/invoices/types/api";
import type { DocumentAction } from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";
import { expectDomOrder } from "@/modules/accounting/modules/invoices/components/tabOrderAssertions";

const routeMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: { id: "coi-current" },
  searchParams: new URLSearchParams(),
}));

const queryMocks = vi.hoisted(() => ({
  invoiceLoading: false,
  invoice: undefined as Invoice | undefined,
  duplicateStatus: undefined as import("@/modules/accounting/modules/invoices/types/api").DuplicateStatusResponse | undefined,
  invoices: [] as Invoice[],
  trashInvoices: [] as Invoice[],
  refetchInvoice: vi.fn(),
  // Live phase-options for the page-level Allocation-tab gate. Default multi-phase
  // preserves the pre-restructure layout (Allocation tab present) for existing tests.
  phaseOptions: { isMultiPhase: true } as { isMultiPhase: boolean } | undefined,
  classifications: [
    { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
    { name: "pay-application", label: "Pay Application", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
    { name: "statement", label: "Statement", opensAs: "statement", action: "view-only", builtIn: true, status: "active" },
    { name: "coi", label: "Certificate of Insurance", opensAs: "coi", action: "view-only", builtIn: true, status: "active" },
    { name: "lien-waiver", label: "Lien Waiver", opensAs: "lien-waiver", action: "view-only", builtIn: true, status: "active" },
  ] as ClassificationInfo[],
  invoiceFilters: [] as Array<(InvoiceFilters & { splitFrom?: string }) | undefined>,
  invoiceQueryOptions: [] as Array<{ enabled?: boolean } | undefined>,
  invoiceFetchOptions: [] as Array<{ includeDeleted?: boolean } | undefined>,
  neighborsFilters: [] as Array<(InvoiceFilters & { splitFrom?: string }) | undefined>,
  neighborsId: [] as string[],
  neighborsOverride: null as { prev: string | null; next: string | null; position?: number | null; total?: number } | null,
  neighborsLoading: false,
  navQueryOptions: [] as Array<{ enabled?: boolean } | undefined>,
  statsParams: [] as Array<{ filed?: boolean; panel?: InvoiceFilters["panel"] } | undefined>,
  trashParams: [] as Array<{ limit?: number; offset?: number; panel?: InvoiceFilters["panel"] } | undefined>,
  trashQueryOptions: [] as Array<{ enabled?: boolean } | undefined>,
  invoicesTotal: undefined as number | undefined,
  stats: {
    total: 2,
    activeTotal: 2,
    trashTotal: 0,
    shelfTotal: 0,
    globalTotal: 2,
    pending: 2,
    approved: 0,
    rejected: 0,
    submitted: 0,
    discarded: 0,
    duplicate: 0,
    reviewed: 0,
    errors: 0,
    skipped: 0,
    todayProcessed: 0,
    avgConfidence: 0,
    missingLienWaivers: 0,
    amounts: { pending: 0, approved: 0, submitted: 0, total: 0 },
  } as DashboardStats,
}));

const mutationMocks = vi.hoisted(() => ({
  reclassify: vi.fn(),
  flagForSplit: vi.fn(),
  discard: vi.fn(),
  unapprove: vi.fn(),
  fileDocument: vi.fn(),
  updateInvoice: vi.fn(),
  saveBeforeSubmit: vi.fn(),
  reconcileStatement: vi.fn(),
  addStatementLine: vi.fn(),
  updateStatementLine: vi.fn(),
  deleteStatementLine: vi.fn(),
  rematchStatementLines: vi.fn(),
  resolveStatementLine: vi.fn(),
  unresolveStatementLine: vi.fn(),
  setWaiverOverride: vi.fn(),
  requestWaiver: vi.fn(),
  uploadCoiToSpectrum: vi.fn(),
  rememberAction: vi.fn(),
}));

const invoiceDetailFormMocks = vi.hoisted(() => ({
  hasEdits: false,
  pendingPayload: {} as InvoiceUpdatePayload,
}));

const spectrumSubmitMocks = vi.hoisted(() => ({
  pendingPayload: {} as InvoiceUpdatePayload,
}));

const reprocessActionMocks = vi.hoisted(() => ({
  options: [] as Array<{ documentId?: string; enabled?: boolean }>,
}));

const allocationPanelMocks = vi.hoisted(() => ({
  registerPendingSave: null as ((handler: (() => Promise<void>) | null) => void) | null,
}));

const activityPanelMocks = vi.hoisted(() => ({
  props: null as {
    active: boolean;
    readOnly?: boolean;
    isTrash?: boolean;
    lockedReason?: string;
    routeFamily?: string;
  } | null,
}));

function makeCoi(id: string, subject: string): Invoice {
  return {
    id,
    classification: "coi",
    confidence: 0.86,
    file: `${id}.pdf`,
    email: {
      from: "broker@example.com",
      subject,
      receivedAt: "2026-07-04T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-07-04T12:00:00.000Z",
    extracted: {
      vendorName: "Halden Brooks",
      vendorAddress: null,
      invoiceNumber: null,
      invoiceDate: null,
      dueDate: null,
      amount: null,
      jobNumber: null,
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: {
      vendor: { vendorCode: "HALD01", vendorName: "Halden Brooks", confidence: 0.94, method: "document" },
      job: null,
      subcontract: null,
      sourceInvoiceTotal: null,
    },
    overallConfidence: 0.86,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

/** The tray's duplicate card is the real model-driven card: Discard is a two-step action. */
async function discardFromTray() {
  const user = userEvent.setup();
  const card = screen.getByTestId("duplicate-resolution-card");
  await user.click(within(card).getByRole("button", { name: "Discard" }));
  await user.click(within(card).getByRole("button", { name: "Confirm discard" }));
}

function makeInvoiceWithMissingWaiver(id: string, subject: string): Invoice {
  return {
    ...makeCoi(id, subject),
    classification: "invoice",
    file: `${id}.pdf`,
    extracted: {
      vendorName: "Riverside Glass",
      vendorAddress: null,
      invoiceNumber: "9964",
      invoiceDate: "2026-06-15",
      dueDate: "2026-07-15",
      amount: 750,
      jobNumber: "26-406",
      projectName: "Harbor Point",
      description: "Change order invoice",
      lineItems: [],
    },
    lienWaiverStatus: "missing",
    linkedLienWaiverId: null,
    waiverOnDocument: false,
  };
}

function makeStatement(id: string, subject: string): Invoice {
  const statementLines = [
    { id: `${id}-line-1`, invoiceNumber: "STMT-100", date: "2026-06-01", amount: 125, status: "matched" as const, source: "extracted" as const },
    { id: `${id}-line-2`, invoiceNumber: "STMT-101", date: "2026-06-08", amount: 275, status: "matched" as const, source: "extracted" as const },
  ];

  return {
    ...makeCoi(id, subject),
    classification: "statement",
    extracted: {
      vendorName: "Statement Vendor",
      vendorAddress: null,
      invoiceNumber: "ST-100",
      invoiceDate: null,
      dueDate: null,
      amount: 400,
      balance: 400,
      statementPeriod: "June 2026",
      statementLines,
      jobNumber: null,
      projectName: null,
      description: null,
      lineItems: [],
    },
    statementLines,
  };
}

function makeQueuedCoiUploadResponse(documentId = "coi-current") {
  return {
    status: "queued" as const,
    documentId,
    vendorCode: "HALD01",
    expirationDate: "2027-07-04",
    attempt: 1,
    queuePosition: 0,
    message: "Upload queued",
  };
}

vi.mock("next/navigation", () => ({
  useParams: () => routeMocks.params,
  useRouter: () => ({
    push: routeMocks.push,
    replace: routeMocks.replace,
  }),
  useSearchParams: () => routeMocks.searchParams,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  DEFAULT_MAPPINGS: queryMocks.classifications,
  useInvoice: (_id: string, options?: { includeDeleted?: boolean }) => {
    queryMocks.invoiceFetchOptions.push(options);
    return {
      data: queryMocks.invoice,
      isLoading: queryMocks.invoiceLoading,
      isError: false,
      refetch: queryMocks.refetchInvoice,
    };
  },
  useInvoiceEmail: () => ({ data: undefined }),
  useDuplicateStatus: () => ({ data: queryMocks.duplicateStatus, isError: false }),
  usePhaseOptions: () => ({
    data: queryMocks.phaseOptions,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useClassifications: () => ({ data: queryMocks.classifications }),
  useAuditTrail: () => ({ data: [] }),
  useStats: (params?: { filed?: boolean; panel?: InvoiceFilters["panel"] }) => {
    queryMocks.statsParams.push(params);
    return { data: queryMocks.stats };
  },
  useInvoiceNeighbors: (
    navId: string,
    filters?: InvoiceFilters & { splitFrom?: string },
    options?: { enabled?: boolean },
  ) => {
    queryMocks.neighborsFilters.push(filters);
    queryMocks.neighborsId.push(navId);
    queryMocks.navQueryOptions.push(options);
    if (queryMocks.neighborsLoading) {
      return { data: undefined };
    }
    if (queryMocks.neighborsOverride) {
      const override = queryMocks.neighborsOverride;
      return {
        data: {
          prev: override.prev,
          next: override.next,
          position: override.position ?? null,
          total: override.total ?? 0,
        },
      };
    }
    // Default: compute prev/next/position from the queue order, mimicking the server.
    const index = queryMocks.invoices.findIndex((record) => record.id === navId);
    const prev = index > 0 ? queryMocks.invoices[index - 1].id : null;
    const next =
      index >= 0 && index < queryMocks.invoices.length - 1 ? queryMocks.invoices[index + 1].id : null;
    const position = index >= 0 ? index + 1 : null;
    return { data: { prev, next, position, total: queryMocks.invoices.length } };
  },
  useInvoices: (
    filters?: InvoiceFilters & { splitFrom?: string },
    options?: { enabled?: boolean },
  ) => {
    queryMocks.invoiceFilters.push(filters);
    queryMocks.invoiceQueryOptions.push(options);
    return {
      data: {
        invoices: queryMocks.invoices,
        total: queryMocks.invoicesTotal ?? queryMocks.invoices.length,
        page: 1,
        limit: 200,
        pages: 1,
      },
    };
  },
  useTrash: (
    params?: { limit?: number; offset?: number; panel?: InvoiceFilters["panel"] },
    options?: { enabled?: boolean },
  ) => {
    queryMocks.trashParams.push(params);
    queryMocks.trashQueryOptions.push(options);
    return {
      data: {
        invoices: queryMocks.trashInvoices,
        total: queryMocks.trashInvoices.length,
        limit: 200,
        offset: 0,
      },
    };
  },
  useInvoiceActions: () => ({
    data: { actions: [] },
    isFetching: false,
  }),
  useWaiverRecipient: () => ({
    refetch: vi.fn().mockResolvedValue({
      data: {
        recipientType: "direct",
        directEmail: "vendor@example.com",
        candidates: [],
        cachedVendorEmail: null,
        emailFrom: "vendor@example.com",
        reason: "Direct vendor email",
        directoryContacts: [],
      },
      error: null,
    }),
    isFetching: false,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useReclassifyInvoice: () => ({ mutate: mutationMocks.reclassify, isPending: false }),
  useFlagForSplit: () => ({ mutate: mutationMocks.flagForSplit, isPending: false, data: null }),
  useDiscardInvoice: () => ({ mutate: mutationMocks.discard, mutateAsync: mutationMocks.discard, isPending: false }),
  useUnapproveInvoice: () => ({ mutate: mutationMocks.unapprove, isPending: false }),
  useFileDocument: () => ({ mutateAsync: mutationMocks.fileDocument, isPending: false }),
  useAttachFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateInvoice: () => ({ mutateAsync: mutationMocks.updateInvoice, isPending: false }),
  useSaveInvoiceBeforeSpectrumSubmit: () => ({ mutateAsync: mutationMocks.saveBeforeSubmit, isPending: false }),
  useReconcileStatement: () => ({ mutateAsync: mutationMocks.reconcileStatement, isPending: false }),
  useAddStatementLine: () => ({ mutateAsync: mutationMocks.addStatementLine, isPending: false }),
  useUpdateStatementLine: () => ({ mutateAsync: mutationMocks.updateStatementLine, isPending: false }),
  useDeleteStatementLine: () => ({ mutateAsync: mutationMocks.deleteStatementLine, isPending: false }),
  useRematchStatementLines: () => ({ mutateAsync: mutationMocks.rematchStatementLines, isPending: false }),
  useResolveStatementLine: () => ({ mutateAsync: mutationMocks.resolveStatementLine, isPending: false }),
  useUnresolveStatementLine: () => ({ mutateAsync: mutationMocks.unresolveStatementLine, isPending: false }),
  useSetWaiverOverride: () => ({ mutate: mutationMocks.setWaiverOverride, isPending: false }),
  useRequestWaiver: () => ({ mutate: mutationMocks.requestWaiver, isPending: false }),
  useUploadCoiToSpectrum: () => ({ mutateAsync: mutationMocks.uploadCoiToSpectrum, isPending: false }),
  useFlagDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useUnflagDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useDuplicateBypass: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: (permissions: string[]) =>
      permissions.some((permission) => [
        "accounting.invoices.view_details",
        "accounting.invoices.approve",
        "accounting.invoices.delete",
        "accounting.invoices.request_waiver",
        "accounting.invoices.submit_spectrum",
      ].includes(permission)),
    hasAllPermissions: (permissions: string[]) =>
      permissions.every((permission) => [
        "accounting.invoices.view_details",
        "accounting.invoices.approve",
        "accounting.invoices.request_waiver",
        "accounting.invoices.submit_spectrum",
      ].includes(permission)),
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/useSpectrumRefreshAction", () => ({
  useSpectrumRefreshAction: () => undefined,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/useReprocessDocumentAction", () => ({
  useReprocessDocumentAction: (options: { documentId?: string; enabled?: boolean }) => {
    reprocessActionMocks.options.push(options);
    return {
      action: options.enabled && options.documentId
        ? { id: "reprocess-document", label: "Reprocess", onClick: vi.fn() }
        : undefined,
      dialog: null,
    };
  },
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/CreateRuleFromInvoice", () => ({
  useCreateRuleFromInvoiceAction: () => ({ action: undefined, modal: null }),
}));

interface MockInvoiceDetailFormHandle {
  hasEdits: boolean;
  isSaving: boolean;
  triggerSave: (onSuccess?: () => void) => void;
  getPendingPayload: () => InvoiceUpdatePayload;
  getApprovalPreview: () => {
    invoiceNumber: string;
    amount: number | null;
    invoiceDate: string;
    vendorCode: string;
    jobNumber: string;
    subcontractNumber: string;
  };
}

vi.mock("@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailForm", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    InvoiceDetailForm: React.forwardRef<MockInvoiceDetailFormHandle>(function MockInvoiceDetailForm(_props, ref) {
      React.useImperativeHandle(ref, () => ({
        hasEdits: invoiceDetailFormMocks.hasEdits,
        isSaving: false,
        triggerSave: (onSuccess?: () => void) => onSuccess?.(),
        getPendingPayload: () => invoiceDetailFormMocks.pendingPayload,
        getApprovalPreview: () => ({
          invoiceNumber: "9964",
          amount: 750,
          invoiceDate: "2026-06-15",
          vendorCode: "RIVR04",
          jobNumber: "26-406",
          subcontractNumber: "26-406.03",
        }),
      }));
      return <div>Mock invoice detail form</div>;
    }),
  };
});

vi.mock("@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailWorkspace", () => ({
  InvoiceDetailWorkspace: ({
    activeTab,
    tabs,
    onTabChange,
    children,
    footer,
    footerAccessory,
    resolveTray,
    statusStrip,
  }: {
    activeTab: string;
    tabs?: Array<{ id: string; label: string; badge?: number; alert?: boolean }>;
    onTabChange?: (id: string) => void;
    children: ReactNode;
    footer?: ReactNode;
    footerAccessory?: ReactNode;
    resolveTray?: ReactNode;
    statusStrip?: ReactNode;
  }) => (
    <div data-testid="invoice-detail-workspace" data-active-tab={activeTab}>
      <div data-testid="workspace-tabs">
        {tabs?.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`workspace-tab-${tab.id}`}
            data-badge={tab.badge == null ? "" : String(tab.badge)}
            data-alert={String(Boolean(tab.alert))}
            onClick={() => onTabChange?.(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {statusStrip}
      {children}
      {resolveTray}
      {footerAccessory}
      {footer}
    </div>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/InvoiceActionBar", () => ({
  InvoiceActionBar: ({
    onActionSuccess,
    onDiscardNav,
    undoControl,
    invoiceId,
    onClosedPeriodRecoveryChange,
  }: {
    onActionSuccess?: () => void;
    onDiscardNav?: () => void;
    undoControl?: { label?: string; disabled: boolean; pending?: boolean; onUndo?: () => void };
    invoiceId: string;
    onClosedPeriodRecoveryChange?: (value: import("@/modules/accounting/modules/invoices/components/invoices/invoiceResolveModel").ClosedPeriodTrayAction | null) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onClosedPeriodRecoveryChange?.({ invoiceId, recovery: { invoiceDateMonth: "2026-07", currentMonth: "2026-08", suggestedInvoiceDate: "2026-08-01" }, disabled: false, onUseSuggestedDate: () => mutationMocks.updateInvoice({ id: invoiceId, payload: { invoiceDate: "2026-08-01" } }) })}>Publish recovery</button>
      <button type="button" onClick={onActionSuccess}>Mock guarded navigation</button>
      <button type="button" onClick={onDiscardNav}>Mock discard navigation</button>
      {undoControl && (
        <button
          type="button"
          data-testid="mock-undo-control"
          disabled={undoControl.disabled || undoControl.pending}
          onClick={() => undoControl.onUndo?.()}
        >
          {undoControl.label ?? "Undo"}
        </button>
      )}
    </div>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/SpectrumSubmitSection", () => ({
  SpectrumSubmitSection: ({
    invoice,
    onBeforeSubmit,
  }: {
    invoice: Invoice;
    onBeforeSubmit?: (payload: InvoiceUpdatePayload) => Promise<void>;
  }) => (
    <div
      data-testid="mock-spectrum-section"
      data-subcontract={invoice?.matching?.subcontract?.subcontractNumber ?? ""}
    >
      <button type="button" onClick={() => void onBeforeSubmit?.(spectrumSubmitMocks.pendingPayload)}>
        Mock Spectrum submit section
      </button>
    </div>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/SpectrumSubmitReturnButton", () => ({
  SpectrumSubmitReturnButton: () => null,
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/MultiPhaseAllocationPanel", () => ({
  MultiPhaseAllocationPanel: ({
    onPendingSaveChange,
  }: {
    onPendingSaveChange?: (handler: (() => Promise<void>) | null) => void;
  }) => {
    allocationPanelMocks.registerPendingSave = onPendingSaveChange ?? null;
    return <div data-testid="mock-allocation-panel" />;
  },
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/WaiverPairingSection", () => ({
  WaiverPairingSection: () => <div>Mock waiver pairing</div>,
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/LienWaiverMissingNotice", () => ({
  LienWaiverMissingNotice: ({ invoice }: { invoice: Invoice }) => (
    <div>
      <div>Mock missing-waiver notice for {invoice.classification}</div>
      <button type="button">Mock Request</button>
      <button type="button">Mock Attached</button>
      <button type="button">Mock Bypass</button>
    </div>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/DuplicateBypassNote", () => ({
  DuplicateBypassNote: () => <div data-testid="note-marker" />,
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/InvoiceActivityList", () => ({
  InvoiceActivityList: () => <div>Mock activity list</div>,
}));

vi.mock("@/modules/accounting/modules/invoices/components/activity/ActivityPanel", () => ({
  ActivityPanel: ({ active, composeRequest, ...props }: { active: boolean; composeRequest?: { mode?: string | null }; readOnly?: boolean; isTrash?: boolean; lockedReason?: string; routeFamily?: string }) => {
    activityPanelMocks.props = { active, ...props };
    return <div data-testid="mock-activity-panel" data-active={String(active)} data-compose-mode={composeRequest?.mode ?? "comment"}>Mock activity panel</div>;
  },
  collaborationActionsFor: () => [],
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/documentPanelUndo", () => ({
  useDocumentPanelUndo: () => ({ disabled: true, tooltip: "Nothing to undo" }),
  useRecentDocumentUndo: () => ({
    undoControl: { disabled: true, tooltip: "Nothing to undo" },
    rememberAction: mutationMocks.rememberAction,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/DocumentHeaderFileLink", () => ({
  DocumentHeaderFileLink: ({ record }: { record: Invoice }) => <span>{record.file}</span>,
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/DocumentPanelHeader", () => ({
  DocumentPanelHeader: ({
    title,
    navigation,
  }: {
    title: ReactNode;
    navigation?: {
      current?: number;
      total?: number;
      onPrevious?: () => void;
      onNext?: () => void;
      previousDisabled?: boolean;
      nextDisabled?: boolean;
    };
  }) => (
    <div>
      {title}
      {navigation && (
        <>
          <button
            type="button"
            aria-label="Previous document"
            disabled={navigation.previousDisabled}
            onClick={() => navigation.onPrevious?.()}
          >
            Prev
          </button>
          <button
            type="button"
            aria-label="Next document"
            disabled={navigation.nextDisabled}
            onClick={() => navigation.onNext?.()}
          >
            Next
          </button>
          {typeof navigation.current === "number" && typeof navigation.total === "number" && (
            <span aria-label="detail navigation count">
              {navigation.current} / {navigation.total}
            </span>
          )}
        </>
      )}
    </div>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/SourceDocumentViewer", () => ({
  SourceDocumentViewer: ({ record }: { record: Invoice }) => <div>{record.file}</div>,
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/WaiverOverrideConfirmDialog", () => ({
  WaiverOverrideConfirmDialog: () => null,
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/DocumentPanelRouteSurface", () => ({
  DocumentPanelRouteSurface: ({
    record,
    readOnly,
    onUploadToSpectrum,
    onReconcile,
    onLienWaiverLinkComplete,
    extraSecondaryActions,
  }: {
    record: Invoice;
    readOnly?: boolean;
    onUploadToSpectrum?: (record: Invoice, payload: { vendorCode: string; expirationDate: string }) => unknown;
    onReconcile?: (record: Invoice) => unknown;
    onLienWaiverLinkComplete?: (record: Invoice) => void;
    extraSecondaryActions?: DocumentAction[];
  }) => (
    <div>
      {readOnly && <span>Read-only global Trash result</span>}
      <button
        type="button"
        onClick={() => void onUploadToSpectrum?.(record, { vendorCode: "HALD01", expirationDate: "2027-07-04" })}
      >
        Mock Upload COI
      </button>
      <button
        type="button"
        onClick={() => void onReconcile?.(record)}
      >
        Mock Reconcile Statement
      </button>
      <button
        type="button"
        onClick={() => onLienWaiverLinkComplete?.(record)}
      >
        Mock Link Waiver
      </button>
      {extraSecondaryActions?.map((action) => (
        <button key={action.id} type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}));

import InvoiceDetailPage from "@/app/(dashboard)/accounting/invoices/[id]/page";

describe("InvoiceDetailPage COI upload", () => {
  it("connects published closed-period recovery to the actual route tray", async () => {
    const invoice: Invoice = { ...makeCoi("recovery-invoice", "Recovery"), classification: "invoice" };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];
    render(<InvoiceDetailPage />);
    await userEvent.click(screen.getByRole("button", { name: "Publish recovery" }));
    const tray = screen.getByTestId("invoice-resolve-tray");
    await userEvent.click(within(tray).getByRole("button", { name: "Use 2026-08-01" }));
    expect(mutationMocks.updateInvoice).toHaveBeenCalledWith({ id: invoice.id, payload: { invoiceDate: "2026-08-01" } });
    expect(screen.getAllByRole("button", { name: "Use 2026-08-01" })).toHaveLength(1);
  });
  beforeEach(() => {
    const current = makeCoi("coi-current", "Current COI");
    const next = makeCoi("coi-next", "Next COI");

    routeMocks.push.mockReset();
    mutationMocks.updateInvoice.mockClear();
    routeMocks.replace.mockReset();
    routeMocks.params = { id: current.id };
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending",
    );
    queryMocks.invoice = current;
    queryMocks.invoices = [current, next];
    queryMocks.trashInvoices = [];
    queryMocks.phaseOptions = { isMultiPhase: true };
    queryMocks.stats = {
      total: 2,
      activeTotal: 2,
      trashTotal: 0,
      shelfTotal: 0,
      globalTotal: 2,
      pending: 2,
      approved: 0,
      rejected: 0,
      submitted: 0,
      discarded: 0,
      duplicate: 0,
      reviewed: 0,
      errors: 0,
      skipped: 0,
      todayProcessed: 0,
      avgConfidence: 0,
      missingLienWaivers: 0,
      amounts: { pending: 0, approved: 0, submitted: 0, total: 0 },
    };
    queryMocks.refetchInvoice.mockReset();
    queryMocks.refetchInvoice.mockResolvedValue({ data: current });
    queryMocks.invoicesTotal = undefined;
    invoiceDetailFormMocks.hasEdits = false;
    invoiceDetailFormMocks.pendingPayload = {};
    spectrumSubmitMocks.pendingPayload = {};
    allocationPanelMocks.registerPendingSave = null;
    activityPanelMocks.props = null;
    mutationMocks.saveBeforeSubmit.mockReset();
    mutationMocks.saveBeforeSubmit.mockResolvedValue(current);
    mutationMocks.uploadCoiToSpectrum.mockReset();
    mutationMocks.uploadCoiToSpectrum.mockResolvedValue(makeQueuedCoiUploadResponse());
    mutationMocks.rememberAction.mockReset();
    mutationMocks.flagForSplit.mockReset();
    mutationMocks.reconcileStatement.mockReset();
    mutationMocks.reconcileStatement.mockResolvedValue({ invoice: { ...current, reconciled: true, filed: true } });
    reprocessActionMocks.options = [];
    mutationMocks.resolveStatementLine.mockReset();
    mutationMocks.unresolveStatementLine.mockReset();
    mutationMocks.setWaiverOverride.mockReset();
    queryMocks.invoiceFilters = [];
    queryMocks.invoiceQueryOptions = [];
    queryMocks.invoiceFetchOptions = [];
    queryMocks.neighborsFilters = [];
    queryMocks.neighborsId = [];
    queryMocks.neighborsOverride = null;
    queryMocks.neighborsLoading = false;
    queryMocks.navQueryOptions = [];
    queryMocks.statsParams = [];
    queryMocks.trashParams = [];
    queryMocks.trashQueryOptions = [];
  });

  it("passes the retrying preview size through the invoice route", async () => {
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);

    await user.selectOptions(screen.getByLabelText("Panel state"), "retrying");
    await waitFor(() => expect(screen.getByRole("status", { name: "Retrying" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Retrying loader size"), { target: { value: "128" } });
    await waitFor(() => expect(screen.getByTestId("retrying-loader")).toHaveAttribute("data-size", "128"));
  });

  it("opens the requested Reply or Forward composer after an invoice header action", async () => {
    const invoice = makeInvoiceWithMissingWaiver("invoice-compose", "Compose request");
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];
    render(<InvoiceDetailPage />);

    act(() => window.dispatchEvent(new CustomEvent("document-collaboration-compose", { detail: { documentId: invoice.id, mode: "reply" } })));
    await waitFor(() => expect(screen.getByTestId("mock-activity-panel")).toHaveAttribute("data-compose-mode", "reply"));

    act(() => window.dispatchEvent(new CustomEvent("document-collaboration-compose", { detail: { documentId: invoice.id, mode: "forward" } })));
    await waitFor(() => expect(screen.getByTestId("mock-activity-panel")).toHaveAttribute("data-compose-mode", "forward"));
  });

  it.each([
    ["approved", false, true, false, "Activity is locked — document is approved."],
    ["submitted", false, true, false, "Activity is locked — submitted to Spectrum."],
    ["discarded", true, true, true, "Activity is locked — document is in Trash."],
  ] as const)("passes the invoice %s lifecycle lock to ActivityPanel", (status, isTrash, readOnly, expectedTrash, lockedReason) => {
    const invoice = { ...makeInvoiceWithMissingWaiver(`invoice-${status}`, `${status} invoice`), status };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    expect(activityPanelMocks.props).toMatchObject({
      active: false,
      readOnly,
      isTrash: expectedTrash,
      lockedReason,
      routeFamily: "invoice",
    });
    expect(isTrash).toBe(expectedTrash);
  });

  it("bypasses pending allocation saves when navigating after discard", async () => {
    const user = userEvent.setup();
    const current = {
      ...makeInvoiceWithMissingWaiver("invoice-current", "Current multi-phase invoice"),
      multiPhaseCandidate: true,
    };
    const next = makeInvoiceWithMissingWaiver("invoice-next", "Next invoice");
    const pendingAllocationSave = vi.fn(async () => {
      throw new Error("Enter at least one allocation amount before approving.");
    });
    routeMocks.params = { id: current.id };
    queryMocks.invoice = current;
    queryMocks.invoices = [current, next];

    render(<InvoiceDetailPage />);
    act(() => allocationPanelMocks.registerPendingSave?.(pendingAllocationSave));

    await user.click(screen.getByRole("button", { name: "Mock discard navigation" }));

    expect(pendingAllocationSave).not.toHaveBeenCalled();
    await waitFor(() => expect(routeMocks.push).toHaveBeenCalledWith(
      "/accounting/invoices/invoice-next?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending",
    ));
  });

  it("advances to the next queue document after COI upload queue acceptance", async () => {
    const user = userEvent.setup();

    render(<InvoiceDetailPage />);

    await user.click(screen.getByRole("button", { name: "Mock Upload COI" }));

    await waitFor(() => {
      expect(mutationMocks.uploadCoiToSpectrum).toHaveBeenCalledWith({
        id: "coi-current",
        payload: { vendorCode: "HALD01", expirationDate: "2027-07-04" },
      });
    });
    expect(queryMocks.refetchInvoice).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(routeMocks.push).toHaveBeenCalledWith(
        "/accounting/invoices/coi-next?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending",
      );
    });
    expect(mutationMocks.rememberAction).not.toHaveBeenCalled();
  });

  it("offers Reprocess in the invoice-detail actions for every loaded document", () => {
    render(<InvoiceDetailPage />);

    expect(screen.getByRole("button", { name: "Reprocess" })).toBeInTheDocument();
    expect(reprocessActionMocks.options.at(-1)).toEqual({
      documentId: "coi-current",
      enabled: true,
    });
  });

  it("keeps the All tab status in detail navigation and next-item links", async () => {
    const user = userEvent.setup();
    const current = makeCoi("coi-current", "Current COI");
    const next = makeCoi("coi-next", "Next COI");
    routeMocks.params = { id: current.id };
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Dall&status=all",
    );
    queryMocks.invoice = current;
    queryMocks.invoices = [current, next];

    render(<InvoiceDetailPage />);

    expect(queryMocks.neighborsFilters.at(-1)).toMatchObject({
      filed: false,
      status: "all",
    });
    // Pagination is never forwarded to the neighbors request.
    expect(queryMocks.neighborsFilters.at(-1)).not.toHaveProperty("limit");

    await user.click(screen.getByRole("button", { name: "Mock Upload COI" }));

    await waitFor(() => {
      expect(routeMocks.push).toHaveBeenCalledWith(
        "/accounting/invoices/coi-next?from=%2Faccounting%2Finvoices%3Fstatus%3Dall&status=all",
      );
    });
  });

  it("scopes the neighbors request to the queue status, panel, and sort", async () => {
    const user = userEvent.setup();
    const current = makeCoi("coi-current", "Current COI");
    const next = makeCoi("coi-next", "Next COI");
    routeMocks.params = { id: current.id };
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Dpending%26panel%3Dcoi&status=pending&panel=coi&sort=vendor&sortDir=desc",
    );
    queryMocks.invoice = current;
    queryMocks.invoices = [current, next];

    render(<InvoiceDetailPage />);

    // The neighbors request carries the EXACT queue filters (no pagination); the
    // server owns order stability, so the frontend no longer snapshots the list.
    expect(queryMocks.neighborsFilters.at(-1)).toEqual({
      filed: false,
      panel: "coi",
      sort: "vendor",
      sortDir: "desc",
      status: "pending",
    });

    await user.click(screen.getByRole("button", { name: "Mock Upload COI" }));

    await waitFor(() => {
      expect(routeMocks.push).toHaveBeenCalledWith(
        "/accounting/invoices/coi-next?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending%26panel%3Dcoi&sort=vendor&sortDir=desc&panel=coi&status=pending",
      );
    });
    expect(queryMocks.statsParams.at(-1)).toEqual({ filed: false, panel: "coi" });
  });

  it("uses global scope for a Flagged-view text search neighbor request", () => {
    const current = makeCoi("coi-current", "Current COI");
    const next = makeCoi("coi-next", "Next COI");
    routeMocks.params = { id: current.id };
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Dflagged%26search%3Dacme&status=flagged&search=acme&panel=coi",
    );
    queryMocks.invoice = current;
    queryMocks.invoices = [current, next];

    render(<InvoiceDetailPage />);

    // Text search deliberately pauses Flagged and panel filtering. The detail
    // request receives the same resolved global-search boundary as the list.
    expect(queryMocks.neighborsFilters.at(-1)).toEqual({
      search: "acme",
      page: undefined,
      limit: undefined,
      sort: undefined,
      sortDir: undefined,
      scope: "global",
    });
  });

  it("hides prev/next and skips queue navigation for an active global-search result", () => {
    const current = makeCoi("global-active", "Active global result");
    routeMocks.params = { id: current.id };
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Ddiscarded%26search%3Dacme&status=approved&globalSearch=true",
    );
    queryMocks.invoice = current;
    queryMocks.neighborsOverride = { prev: "previous", next: "next", position: 2, total: 3 };

    render(<InvoiceDetailPage />);

    expect(queryMocks.invoiceFetchOptions.at(-1)).toEqual({ includeDeleted: false });
    expect(queryMocks.navQueryOptions.at(-1)).toEqual({ enabled: false });
    expect(queryMocks.trashQueryOptions.at(-1)).toEqual({ enabled: false });
    expect(screen.queryByRole("button", { name: "Previous document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next document" })).not.toBeInTheDocument();
  });

  it("includes deleted records but makes a global-search Trash result read-only", async () => {
    const user = userEvent.setup();
    const current = { ...makeCoi("global-trash", "Trash global result"), status: "pending" as const, isTrash: true };
    routeMocks.params = { id: current.id };
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Dpending%26search%3Dacme&status=discarded&globalSearch=true",
    );
    queryMocks.invoice = current;

    render(<InvoiceDetailPage />);

    expect(queryMocks.invoiceFetchOptions.at(-1)).toEqual({ includeDeleted: true });
    expect(queryMocks.navQueryOptions.at(-1)).toEqual({ enabled: false });
    expect(queryMocks.trashQueryOptions.at(-1)).toEqual({ enabled: false });
    expect(screen.queryByRole("button", { name: "Previous document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next document" })).not.toBeInTheDocument();
    expect(screen.getByText("Read-only global Trash result")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mock Upload COI" }));
    await user.click(screen.getByRole("button", { name: "Mock Reconcile Statement" }));
    expect(mutationMocks.uploadCoiToSpectrum).not.toHaveBeenCalled();
    expect(mutationMocks.reconcileStatement).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Publish recovery" })).not.toBeInTheDocument();
  });

  it("renders header prev/next arrows, disables them at the queue ends, and navigates", async () => {
    const user = userEvent.setup();
    const current = makeCoi("coi-current", "Current COI");
    routeMocks.params = { id: current.id };
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending",
    );
    queryMocks.invoice = current;
    queryMocks.invoices = [current];

    // Both ends null → both arrows disabled.
    queryMocks.neighborsOverride = { prev: null, next: null };
    const { rerender } = render(<InvoiceDetailPage />);
    expect(screen.getByRole("button", { name: "Previous document" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next document" })).toBeDisabled();

    // A served next id enables the Next arrow and navigates to it.
    queryMocks.neighborsOverride = { prev: "coi-prev", next: "coi-next" };
    rerender(<InvoiceDetailPage />);
    const nextArrow = screen.getByRole("button", { name: "Next document" });
    expect(nextArrow).not.toBeDisabled();
    await user.click(nextArrow);
    await waitFor(() => expect(routeMocks.push).toHaveBeenCalledWith(
      "/accounting/invoices/coi-next?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending",
    ));

    await user.click(screen.getByRole("button", { name: "Previous document" }));
    await waitFor(() => expect(routeMocks.push).toHaveBeenCalledWith(
      "/accounting/invoices/coi-prev?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending",
    ));
  });

  it("renders the queue position counter from the served position and total", () => {
    const current = makeCoi("coi-current", "Current COI");
    routeMocks.params = { id: current.id };
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending",
    );
    queryMocks.invoice = current;
    queryMocks.invoices = [current];
    queryMocks.neighborsOverride = { prev: "coi-prev", next: "coi-next", position: 3, total: 47 };

    render(<InvoiceDetailPage />);

    expect(screen.getByLabelText("detail navigation count")).toHaveTextContent("3 / 47");
  });

  it("hides the queue position counter when the served position is null (anchor out of set)", () => {
    const current = makeCoi("coi-current", "Current COI");
    routeMocks.params = { id: current.id };
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending",
    );
    queryMocks.invoice = current;
    queryMocks.invoices = [current];
    queryMocks.neighborsOverride = { prev: null, next: "coi-next", position: null, total: 47 };

    render(<InvoiceDetailPage />);

    expect(screen.queryByLabelText("detail navigation count")).not.toBeInTheDocument();
    // Arrows still render (navigation is unaffected by the null position).
    expect(screen.getByRole("button", { name: "Next document" })).not.toBeDisabled();
  });

  it("hides the queue position counter while the neighbors request is loading", () => {
    const current = makeCoi("coi-current", "Current COI");
    routeMocks.params = { id: current.id };
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending",
    );
    queryMocks.invoice = current;
    queryMocks.invoices = [current];
    queryMocks.neighborsLoading = true;

    render(<InvoiceDetailPage />);

    expect(screen.queryByLabelText("detail navigation count")).not.toBeInTheDocument();
  });

  it("uses discarded-only navigation data and the trash count for discarded detail visits", () => {
    const current = { ...makeCoi("trash-current", "Current discarded COI"), status: "discarded" as const };
    const next = { ...makeCoi("trash-next", "Next discarded COI"), status: "discarded" as const };
    routeMocks.params = { id: current.id };
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Ddiscarded%26panel%3Dcoi&status=discarded&panel=coi",
    );
    queryMocks.invoice = current;
    queryMocks.invoices = [];
    queryMocks.trashInvoices = [current, next];
    queryMocks.stats = { ...queryMocks.stats, trashTotal: 2, discarded: 2 };

    render(<InvoiceDetailPage />);

    expect(queryMocks.navQueryOptions.at(-1)).toEqual({ enabled: false });
    expect(queryMocks.trashParams.at(-1)).toEqual({ limit: 200, offset: 0, panel: "coi" });
    expect(queryMocks.trashQueryOptions.at(-1)).toEqual({ enabled: true });
    expect(screen.getByLabelText("detail navigation count")).toHaveTextContent("1 / 2");
  });

  // NOTE: the queue "N / total" position counter was removed with the client
  // neighbor derivation — the server neighbors endpoint returns ids only, no
  // index/total. The counter now renders for the TRASH path only (see the
  // "1 / 2" assertion in the trash navigation test above). The two former
  // stats-bucket counter tests for the pending/All queue are deleted 1:1 with
  // that removed `navigationTotal`/`currentIndex` machinery.

  it("advances to the next queue document after statement reconciliation", async () => {
    const user = userEvent.setup();
    const current = makeStatement("statement-current", "Current statement");
    const next = makeCoi("coi-next", "Next COI");
    routeMocks.params = { id: current.id };
    queryMocks.invoice = current;
    queryMocks.invoices = [current, next];

    render(<InvoiceDetailPage />);

    await user.click(screen.getByRole("button", { name: "Mock Reconcile Statement" }));

    await waitFor(() => {
      expect(mutationMocks.reconcileStatement).toHaveBeenCalledWith({ id: "statement-current" });
    });
    await waitFor(() => {
      expect(routeMocks.push).toHaveBeenCalledWith(
        "/accounting/invoices/coi-next?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending",
      );
    });
  });

  it("advances to the next queue document after a lien waiver is linked and shelved", async () => {
    const user = userEvent.setup();
    const current: Invoice = { ...makeCoi("waiver-current", "Current waiver"), classification: "lien-waiver" };
    const next = makeCoi("coi-next", "Next queue document");
    routeMocks.params = { id: current.id };
    queryMocks.invoice = current;
    queryMocks.invoices = [current, next];

    render(<InvoiceDetailPage />);

    await user.click(screen.getByRole("button", { name: "Mock Link Waiver" }));

    await waitFor(() => expect(routeMocks.push).toHaveBeenCalledWith(
      "/accounting/invoices/coi-next?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending",
    ));
  });

  it("returns to the queue after the last lien waiver is linked and shelved", async () => {
    const user = userEvent.setup();
    const current: Invoice = { ...makeCoi("waiver-last", "Last waiver"), classification: "lien-waiver" };
    routeMocks.params = { id: current.id };
    queryMocks.invoice = current;
    queryMocks.invoices = [current];

    render(<InvoiceDetailPage />);

    await user.click(screen.getByRole("button", { name: "Mock Link Waiver" }));

    await waitFor(() => expect(routeMocks.push).toHaveBeenCalledWith("/accounting/invoices?status=pending"));
  });

  it("polls an open COI while Spectrum upload is queued", () => {
    vi.useFakeTimers();
    try {
      queryMocks.invoice = {
        ...makeCoi("coi-current", "Current COI"),
        spectrumUploadStatus: "queued",
      };

      render(<InvoiceDetailPage />);

      expect(queryMocks.refetchInvoice).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(3_000);
      });

      expect(queryMocks.refetchInvoice).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens Spectrum submit return invoices on the Details tab", async () => {
    const invoice = makeInvoiceWithMissingWaiver("invoice-current", "Failed invoice");
    routeMocks.params = { id: invoice.id };
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Dapproved%26spectrumSubmitReturn%3D1&spectrumSubmitReturn=1",
    );
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId("invoice-detail-workspace")).toHaveAttribute("data-active-tab", "details");
    });
  });

  it("renders the full detail UI (not the empty state) for a no-attachment email-body document", () => {
    // Regression: the pipeline queues email bodies as reviewable `doc-<ts>-body`
    // records classified `no-attachment`. They must reach the detail surface,
    // never the `empty` panel phase (TabEmpty "No documents" with zero actions).
    const emailBody: Invoice = {
      ...makeCoi("doc-1790200957496-body", "Email body only"),
      classification: "no-attachment",
      file: "",
    };
    routeMocks.params = { id: emailBody.id };
    queryMocks.invoice = emailBody;
    queryMocks.invoices = [emailBody];

    render(<InvoiceDetailPage />);

    expect(screen.queryByTestId("tab-empty")).not.toBeInTheDocument();
    expect(screen.queryByText("No documents")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mock Upload COI" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reprocess" })).toBeInTheDocument();
  });

  it("mounts the attachment drop zone in the invoice workflow for a pending fileless invoice", () => {
    const invoice = {
      ...makeInvoiceWithMissingWaiver("invoice-fileless", "Invoice available to download"),
      file: "",
    };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    const attachmentZone = screen.getByRole("button", { name: "Attach document file" });
    const emailSection = screen.getByRole("region", { name: "Invoice email" });

    expect(attachmentZone).toBeInTheDocument();
    expect(emailSection?.compareDocumentPosition(attachmentZone)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("saves approved invoice edits and Spectrum parameters with one pre-submit patch", async () => {
    const invoice = {
      ...makeInvoiceWithMissingWaiver("invoice-current", "Failed invoice"),
      status: "approved" as const,
    };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];
    invoiceDetailFormMocks.hasEdits = true;
    invoiceDetailFormMocks.pendingPayload = {
      invoiceDate: "2026-07-01",
      amount: 999,
      invoiceNumber: "LOCKED-FIELD",
    };
    spectrumSubmitMocks.pendingPayload = {
      routingCode: "D",
    };

    render(<InvoiceDetailPage />);

    screen.getByText("Mock Spectrum submit section").click();

    await waitFor(() => {
      expect(mutationMocks.saveBeforeSubmit).toHaveBeenCalledWith({
        id: "invoice-current",
        payload: {
          invoiceDate: "2026-07-01",
          routingCode: "D",
        },
      });
    });
    expect(mutationMocks.updateInvoice).not.toHaveBeenCalled();
  });

  it("opens split review after queuing a document for split review", async () => {
    const user = userEvent.setup();
    routeMocks.searchParams = new URLSearchParams(
      "from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending&sort=vendor&sortDir=asc&classification=coi&search=Current",
    );

    render(<InvoiceDetailPage />);

    await user.click(screen.getByRole("button", { name: "Split Document" }));

    expect(mutationMocks.flagForSplit).toHaveBeenCalledWith(
      { id: "coi-current" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    const options = mutationMocks.flagForSplit.mock.calls[0]?.[1] as { onSuccess?: () => void };
    options.onSuccess?.();

    await waitFor(() => {
      expect(routeMocks.push).toHaveBeenCalledWith(
        "/accounting/invoices/splits/coi-current?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&sort=vendor&sortDir=asc&classification=coi&search=Current&status=pending",
      );
    });
  });

  it("opens split review directly for a document already marked needs-split", async () => {
    const user = userEvent.setup();
    const invoice = { ...makeCoi("coi-current", "Current COI"), status: "needs-split" as const };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    await user.click(screen.getByRole("button", { name: "Split Document" }));

    expect(mutationMocks.flagForSplit).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(routeMocks.push).toHaveBeenCalledWith(
        "/accounting/invoices/splits/coi-current?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending&status=pending",
      );
    });
  });

  it("keeps the missing-waiver notice in the resolve tray while switching detail tabs", async () => {
    const user = userEvent.setup();
    const invoice = {
      ...makeInvoiceWithMissingWaiver("invoice-current", "Current invoice"),
      lienWaiverRequired: true,
    };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    expect(screen.getByText("Mock missing-waiver notice for invoice")).toBeInTheDocument();
    expect(screen.getByText("Mock missing-waiver notice for invoice").compareDocumentPosition(
      screen.getByRole("button", { name: "Mock guarded navigation" }),
    )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await user.click(screen.getByTestId("workspace-tab-waiver"));

    expect(screen.getAllByText("Mock waiver pairing").length).toBeGreaterThan(0);
    expect(screen.getByText("Mock missing-waiver notice for invoice")).toBeInTheDocument();
  });

  it("does not add a waiver footer card when no canonical waiver attention exists", () => {
    const invoice = {
      ...makeInvoiceWithMissingWaiver("invoice-current", "Current invoice"),
      lienWaiverRequired: false,
      lienWaiverStatus: undefined,
    };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    expect(screen.queryByText("Mock missing-waiver notice for invoice")).not.toBeInTheDocument();
  });

  it("opens an uncached invoice when the initial loading request finishes", () => {
    const invoice = makeInvoiceWithMissingWaiver("invoice-current", "Current invoice");
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = undefined;
    queryMocks.invoiceLoading = true;
    const view = render(<InvoiceDetailPage />);
    queryMocks.invoiceLoading = false;
    queryMocks.invoice = invoice;
    view.rerender(<InvoiceDetailPage />);
    expect(screen.getByTestId("invoice-detail-workspace")).toBeInTheDocument();
  });

  it("cycles duplicate and missing-waiver cards and keeps approval available", async () => {
    const invoice = {
      ...makeInvoiceWithMissingWaiver("invoice-current", "Current invoice"),
      duplicateOf: "original-discarded",
      notes: "Possible duplicate of original-discarded (earlier copy: discarded)",
      lienWaiverRequired: true,
    };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    expect(screen.getByText("1 of 2")).toBeVisible();
    const duplicateNotice = screen.getByTestId("duplicate-resolution-card");
    expect(duplicateNotice).toBeVisible();
    expect(within(duplicateNotice).getByRole("link", { name: "View duplicate" })).toHaveAttribute("href", "/accounting/invoices/original-discarded");
    await userEvent.click(screen.getByRole("button", { name: "Next issue" }));
    expect(screen.getByText("2 of 2")).toBeVisible();
    expect(screen.getByText("Mock missing-waiver notice for invoice")).toBeVisible();
    expect(duplicateNotice).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Previous issue" }));
    expect(screen.getByTestId("workspace-tab-details")).toHaveAttribute("data-badge", "2");
    expect(screen.getByTestId("resolve-tray-count")).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Mock guarded navigation" })).toBeInTheDocument();

    mutationMocks.discard.mockResolvedValue({ action: "Discard" });
    await discardFromTray();
    expect(mutationMocks.discard).toHaveBeenCalledTimes(1);
    expect(mutationMocks.discard).toHaveBeenCalledWith({ id: invoice.id, duplicateContext: true });
    expect(mutationMocks.rememberAction).toHaveBeenCalledWith(invoice.id, "Discard", "Discard", expect.any(String));
    await waitFor(() => expect(routeMocks.push).toHaveBeenCalled());
  });

  it("hides the waiver footer card once the invoice is a confirmed duplicate", () => {
    const invoice = {
      ...makeInvoiceWithMissingWaiver("invoice-current", "Current invoice"),
      status: "duplicate" as const,
      duplicateOf: "original",
      lienWaiverRequired: true,
    };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    expect(screen.queryByTestId("duplicate-resolution-card")).not.toBeInTheDocument();
    expect(screen.queryByText("Mock missing-waiver notice for invoice")).not.toBeInTheDocument();
    expect(screen.getAllByText("Duplicate").length).toBeGreaterThan(0);
  });

  it("still navigates when discard refetch removes the tray before its exit event", async () => {
    const invoice = {
      ...makeInvoiceWithMissingWaiver("invoice-current", "Current invoice"),
      duplicateOf: "original-discarded",
      lienWaiverRequired: true,
    };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];
    mutationMocks.discard.mockResolvedValue({ action: "Discard" });

    const view = render(<InvoiceDetailPage />);
    await discardFromTray();
    await waitFor(() => expect(mutationMocks.discard).toHaveBeenCalledWith({ id: invoice.id, duplicateContext: true }));

    queryMocks.invoice = { ...invoice, status: "discarded" };
    view.rerender(<InvoiceDetailPage />);

    await waitFor(() => expect(routeMocks.push).toHaveBeenCalled(), { timeout: 1000 });
  });

  it("does not mount a possible-duplicate footer card for an approved invoice", () => {
    const invoice = {
      ...makeInvoiceWithMissingWaiver("invoice-current", "Current invoice"),
      status: "approved" as const,
      duplicateOf: "original",
    };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    expect(screen.queryByTestId("duplicate-resolution-card")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  it("adds a Spectrum-only duplicate row once live status loads, with no duplicateOf", () => {
    const invoice = { ...makeInvoiceWithMissingWaiver("invoice-current", "Current invoice"), duplicateOf: null };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];
    queryMocks.duplicateStatus = {
      state: "spectrum",
      spectrum: { source: "posted", invoiceNumber: "INV-1", vendorCode: "V1", amount: 100 },
      original: null,
      bypassed: null,
      evidence: null,
    };

    try {
      render(<InvoiceDetailPage />);
      expect(screen.getByTestId("duplicate-resolution-card")).toHaveTextContent("already posted in Spectrum");
      expect(screen.getByTestId("resolve-tray-count")).toHaveTextContent("1");
    } finally {
      queryMocks.duplicateStatus = undefined;
    }
  });

  it("keeps the confirmed-duplicate badge and View original link in Details", () => {
    const invoice = {
      ...makeInvoiceWithMissingWaiver("invoice-current", "Current invoice"),
      status: "duplicate" as const,
      duplicateOf: "original",
    };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    expect(screen.getByRole("link", { name: "View original" })).toHaveAttribute("href", "/accounting/invoices/original");
  });

  it("styles the duplicate badge with muted theme tokens only, keeping its label and link", () => {
    const invoice = {
      ...makeInvoiceWithMissingWaiver("invoice-current", "Current invoice"),
      status: "duplicate" as const,
      duplicateOf: "original",
    };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    const link = screen.getByRole("link", { name: "View original" });
    const badge = link.closest("[data-slot='badge']");
    expect(badge).toHaveTextContent("Duplicate");
    expect(badge).toHaveClass("border-border", "bg-muted", "text-muted-foreground");
    expect(badge?.className).not.toMatch(
      /\b(?:bg|text|border|ring|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|#[0-9a-fA-F]{3,8}\b/,
    );
    expect(link).toHaveAttribute("href", "/accounting/invoices/original");
  });

  it("places the bypassed-duplicate note under the email glance and above the detail form", () => {
    const invoice = { ...makeInvoiceWithMissingWaiver("invoice-current", "Current invoice"), status: "pending" as const };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    expectDomOrder([
      screen.getByLabelText("Invoice email"),
      screen.getByTestId("note-marker"),
      screen.getByText("Mock invoice detail form"),
    ]);
  });

  it("keeps the bypassed-duplicate note off non-pending invoices", () => {
    const invoice = { ...makeInvoiceWithMissingWaiver("invoice-current", "Current invoice"), status: "approved" as const };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    expect(screen.getByText("Mock invoice detail form")).toBeInTheDocument();
    expect(screen.queryByTestId("note-marker")).not.toBeInTheDocument();
  });

  it("keeps the bypassed-duplicate note off a read-only global Trash result", () => {
    const invoice = { ...makeInvoiceWithMissingWaiver("invoice-current", "Current invoice"), status: "pending" as const, isTrash: true };
    routeMocks.params = { id: invoice.id };
    routeMocks.searchParams = new URLSearchParams("from=%2Faccounting%2Finvoices&status=discarded&globalSearch=true");
    queryMocks.invoice = invoice;

    render(<InvoiceDetailPage />);

    expect(screen.getByRole("group", { name: "Read-only invoice details" })).toBeInTheDocument();
    expect(screen.queryByTestId("note-marker")).not.toBeInTheDocument();
  });

  it("puts waiver controls in Details for pay-application workflow documents", () => {
    const invoice = {
      ...makeInvoiceWithMissingWaiver("pay-app-current", "Current pay application"),
      classification: "pay-application" as const,
      lienWaiverRequired: true,
    };
    routeMocks.params = { id: invoice.id };
    queryMocks.invoice = invoice;
    queryMocks.invoices = [invoice];

    render(<InvoiceDetailPage />);

    expect(screen.getByText("Mock missing-waiver notice for pay-application")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mock Request" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mock Attached" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mock Bypass" })).toBeInTheDocument();
  });
});

// ── Invoice-detail restructure (QA 4.16): Other-Params → Details, conditional
//    Allocation tab on the LIVE phase count ────────────────────────────────────

describe("InvoiceDetailPage detail restructure", () => {
  function invoiceWithSubcontract(subcontractNumber: string | null): Invoice {
    const base = makeInvoiceWithMissingWaiver("invoice-current", "Restructure invoice");
    return {
      ...base,
      matching: {
        vendor: { vendorCode: "V001", vendorName: "Riverside Glass", confidence: 1, method: "test" },
        job: { jobNumber: "31-130", confidence: 1, method: "test" },
        subcontract: subcontractNumber
          ? { subcontractNumber, confidence: 1, method: "test" }
          : null,
        sourceInvoiceTotal: 750,
      },
    };
  }

  beforeEach(() => {
    routeMocks.push.mockReset();
    routeMocks.replace.mockReset();
    routeMocks.params = { id: "invoice-current" };
    routeMocks.searchParams = new URLSearchParams();
    queryMocks.invoice = invoiceWithSubcontract("26-416.07");
    queryMocks.invoices = [];
    queryMocks.phaseOptions = { isMultiPhase: true };
    invoiceDetailFormMocks.hasEdits = false;
    invoiceDetailFormMocks.pendingPayload = {};
    spectrumSubmitMocks.pendingPayload = {};
    allocationPanelMocks.registerPendingSave = null;
  });

  // Scenario 1 — single-phase → no Allocation tab; Other Params on Details.
  it("scenario 1: single-phase invoice → NO Allocation tab; Other Params render on Details", () => {
    queryMocks.invoice = invoiceWithSubcontract("26-416.07");
    queryMocks.phaseOptions = { isMultiPhase: false };
    render(<InvoiceDetailPage />);

    expect(screen.queryByTestId("workspace-tab-allocation")).not.toBeInTheDocument();
    expect(screen.queryByTestId("detail-tab-allocation")).not.toBeInTheDocument();
    // Other Parameters (SpectrumSubmitSection) live on the always-mounted Details tab.
    expect(within(screen.getByTestId("detail-tab-details")).getByTestId("mock-spectrum-section")).toBeInTheDocument();
  });

  // Scenario 2 — multi-phase → Allocation tab with the bucket editor only; Other Params on Details (no duplication).
  it("scenario 2: multi-phase invoice → Allocation tab with the bucket editor; Other Params stay on Details (no duplication)", () => {
    queryMocks.invoice = invoiceWithSubcontract("26-416.07");
    queryMocks.phaseOptions = { isMultiPhase: true };
    render(<InvoiceDetailPage />);

    expect(screen.getByTestId("workspace-tab-allocation")).toBeInTheDocument();
    const allocation = screen.getByTestId("detail-tab-allocation");
    expect(within(allocation).getByTestId("mock-allocation-panel")).toBeInTheDocument();
    // Allocation tab holds ONLY the bucket editor — Other Params are not duplicated here.
    expect(within(allocation).queryByTestId("mock-spectrum-section")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("detail-tab-details")).getByTestId("mock-spectrum-section")).toBeInTheDocument();
    expect(screen.getAllByTestId("mock-spectrum-section")).toHaveLength(1);
  });

  // Scenario 3 — no subcontract → no Allocation tab; Other Params on Details.
  it("scenario 3: invoice with no subcontract → no Allocation tab; Other Params still on Details", () => {
    queryMocks.invoice = invoiceWithSubcontract(null);
    queryMocks.phaseOptions = undefined; // enabled=false → no phase-options data
    render(<InvoiceDetailPage />);

    expect(screen.queryByTestId("workspace-tab-allocation")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("detail-tab-details")).getByTestId("mock-spectrum-section")).toBeInTheDocument();
  });

  // Scenario 4 — MULTI→SINGLE while the user is on Allocation → tab gone, redirected to Details (no blank pane); relocated Other Params reflect the corrected subcontract.
  it("scenario 4: MULTI→SINGLE while on Allocation redirects to Details (no blank pane); Other Params reflect the new subcontract", async () => {
    const user = userEvent.setup();
    queryMocks.invoice = invoiceWithSubcontract("26-416.07");
    queryMocks.phaseOptions = { isMultiPhase: true };
    const { rerender } = render(<InvoiceDetailPage />);

    // The user navigates to the Allocation tab.
    await user.click(screen.getByTestId("workspace-tab-allocation"));
    expect(screen.getByTestId("invoice-detail-workspace")).toHaveAttribute("data-active-tab", "allocation");

    // A subcontract correction recomputes to single-phase (backend flag-recompute is the product owner's).
    queryMocks.invoice = invoiceWithSubcontract("26-434.05");
    queryMocks.phaseOptions = { isMultiPhase: false };
    rerender(<InvoiceDetailPage />);

    expect(screen.queryByTestId("workspace-tab-allocation")).not.toBeInTheDocument();
    // effectiveActiveTab redirects off the vanished tab → Details is shown, not a blank pane.
    expect(screen.getByTestId("invoice-detail-workspace")).toHaveAttribute("data-active-tab", "details");
    // The relocated (still-mounted) Other Params re-render with the corrected invoice.
    expect(screen.getByTestId("mock-spectrum-section")).toHaveAttribute("data-subcontract", "26-434.05");
  });

  // Scenario 5 — SINGLE→MULTI → Allocation tab appears with the bucket editor; Other Params reflect the new subcontract.
  it("scenario 5: SINGLE→MULTI shows the Allocation tab with the bucket editor; Other Params reflect the new subcontract", () => {
    queryMocks.invoice = invoiceWithSubcontract("26-416.07");
    queryMocks.phaseOptions = { isMultiPhase: false };
    const { rerender } = render(<InvoiceDetailPage />);

    expect(screen.queryByTestId("workspace-tab-allocation")).not.toBeInTheDocument();

    queryMocks.invoice = invoiceWithSubcontract("26-434.05");
    queryMocks.phaseOptions = { isMultiPhase: true };
    rerender(<InvoiceDetailPage />);

    expect(screen.getByTestId("workspace-tab-allocation")).toBeInTheDocument();
    expect(within(screen.getByTestId("detail-tab-allocation")).getByTestId("mock-allocation-panel")).toBeInTheDocument();
    expect(screen.getByTestId("mock-spectrum-section")).toHaveAttribute("data-subcontract", "26-434.05");
  });

  // Regression (the landmine the move fixes): a SINGLE-phase invoice has NO
  // Allocation tab, yet the relocated Spectrum submit machinery stays mounted on
  // Details and the pre-submit patch still fires. A naive "hide the tab" that left
  // the section inside the allocation div would have broken submit for single-phase.
  it("regression: single-phase approved invoice keeps the Spectrum pre-submit patch working (section stays mounted on Details)", async () => {
    queryMocks.invoice = { ...invoiceWithSubcontract("26-416.07"), status: "approved" as const };
    queryMocks.phaseOptions = { isMultiPhase: false };
    mutationMocks.saveBeforeSubmit.mockReset();
    invoiceDetailFormMocks.hasEdits = true;
    invoiceDetailFormMocks.pendingPayload = { invoiceDate: "2026-07-01", amount: 999, invoiceNumber: "LOCKED" };
    spectrumSubmitMocks.pendingPayload = { routingCode: "D" };
    render(<InvoiceDetailPage />);

    expect(screen.queryByTestId("workspace-tab-allocation")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("detail-tab-details")).getByText("Mock Spectrum submit section")).toBeInTheDocument();

    screen.getByText("Mock Spectrum submit section").click();

    await waitFor(() => {
      expect(mutationMocks.saveBeforeSubmit).toHaveBeenCalledWith({
        id: "invoice-current",
        payload: { invoiceDate: "2026-07-01", routingCode: "D" },
      });
    });
  });
});

// ── F3: Undo Approve is enabled for the whole approved/modified lifetime ───────
// (window-free /unapprove), not just the 5-minute useDocumentPanelUndo window.
// The documentPanelUndo mock is disabled (past-window); the fix must NOT reuse it.

describe("InvoiceDetailPage Undo Approve (F3)", () => {
  beforeEach(() => {
    routeMocks.push.mockReset();
    routeMocks.replace.mockReset();
    routeMocks.params = { id: "invoice-current" };
    routeMocks.searchParams = new URLSearchParams();
    queryMocks.invoices = [];
    queryMocks.phaseOptions = { isMultiPhase: false };
    mutationMocks.unapprove.mockReset();
  });

  it.each(["approved", "modified"] as const)(
    "keeps Undo Approve enabled past the undo window and unapproves via /unapprove (status=%s)",
    async (status) => {
      const user = userEvent.setup();
      queryMocks.invoice = {
        ...makeInvoiceWithMissingWaiver("invoice-current", "Approved invoice"),
        status,
      };

      render(<InvoiceDetailPage />);

      const undoBtn = screen.getByTestId("mock-undo-control");
      expect(undoBtn).toHaveTextContent("Undo Approve");
      // The window-gated documentPanelUndo mock is disabled; the fix supplies a
      // window-free control, so Undo Approve stays ENABLED.
      expect(undoBtn).toBeEnabled();

      await user.click(undoBtn);
      expect(mutationMocks.unapprove).toHaveBeenCalledWith({ id: "invoice-current" });
    },
  );
});

describe("InvoiceDetailPage details extras", () => {
  it.each([
    ["invoice", "invoice-current"],
    ["pay-application", "pay-app-current"],
  ] as const)("does not expose Line Items or Notes for a %s Details panel", (classification, id) => {
    const invoice = makeInvoiceWithMissingWaiver(id, `${classification} without detail extras`);
    if (invoice.extracted === null) throw new Error("Expected extracted invoice data");
    invoice.classification = classification;
    invoice.extracted.lineItems = [{ description: "Hidden line item", amount: 750, jobRef: "26-406" }];
    invoice.extracted.description = "Hidden note draft";
    queryMocks.invoice = invoice;
    routeMocks.params = { id };

    render(<InvoiceDetailPage />);

    const details = screen.getByTestId("detail-tab-details");
    expect(details).not.toHaveAttribute("hidden");
    expect(within(details).queryByText("Line Items")).not.toBeInTheDocument();
    expect(within(details).queryByText("Hidden line item")).not.toBeInTheDocument();
    expect(within(details).queryByRole("table")).not.toBeInTheDocument();
    expect(within(details).queryByText("Notes")).not.toBeInTheDocument();
    expect(within(details).queryByPlaceholderText("Add notes for this invoice...")).not.toBeInTheDocument();
    expect(within(details).queryByText("Hidden note draft")).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-tab-details")).toHaveAttribute("data-alert", "false");
  });
});
