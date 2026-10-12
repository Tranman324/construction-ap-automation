import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";
import type {
  DocumentAction,
  DocumentFilingResult,
  DocumentPanelUndoControl,
} from "@/modules/accounting/modules/invoices/types/documentSpec";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";

const ENCODED_DOCUMENTS_RETURN = "%2Faccounting%2Finvoices%3Fstatus%3Ddocuments%26panel%3Dreceipt%26docStatus%3Dpending%26search%3Dacme%26page%3D2%26limit%3D25";
const DOCUMENT_NAV_QUERY = `?from=${ENCODED_DOCUMENTS_RETURN}&panel=receipt&docStatus=pending&search=acme&status=documents&page=2&limit=25`;

const routeMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: { id: "doc-current" },
  searchParams: new URLSearchParams(),
}));

const queryMocks = vi.hoisted(() => ({
  invoice: undefined as Invoice | undefined,
  documents: [] as Invoice[],
  filters: [] as InvoiceFilters[],
  classifications: [
    { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
    { name: "receipt", label: "Receipt", opensAs: "receipt", action: "view-only", builtIn: true, status: "active" },
    { name: "statement", label: "Statement", opensAs: "statement", action: "view-only", builtIn: true, status: "active" },
    { name: "coi", label: "Certificate of Insurance", opensAs: "coi", action: "view-only", builtIn: true, status: "active" },
    { name: "other", label: "Other", opensAs: "other", action: "view-only", builtIn: true, status: "active" },
  ] as ClassificationInfo[],
  refetchInvoice: vi.fn(),
}));

const mutationMocks = vi.hoisted(() => ({
  fileDocument: vi.fn(),
  flagForSplit: vi.fn(),
  discard: vi.fn(),
  reclassify: vi.fn(),
  undoInvoiceAction: vi.fn(),
  reconcileStatement: vi.fn(),
  addStatementLine: vi.fn(),
  updateStatementLine: vi.fn(),
  deleteStatementLine: vi.fn(),
  rematchStatementLines: vi.fn(),
  resolveStatementLine: vi.fn(),
  unresolveStatementLine: vi.fn(),
  updateInvoice: vi.fn(),
  uploadCoiToSpectrum: vi.fn(),
  reprocess: vi.fn(),
}));

function makeDocument(id: string, subject: string): Invoice {
  return {
    id,
    classification: "receipt",
    confidence: 0.8,
    file: `${id}.pdf`,
    email: {
      from: "vendor@example.com",
      subject,
      receivedAt: "2026-06-01T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-01T12:00:00.000Z",
    extracted: null,
    matching: null,
    overallConfidence: 0.8,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

function makeStatementDocument(id: string, subject: string): Invoice {
  const statementLines = [
    { id: `${id}-line-1`, invoiceNumber: "STMT-100", date: "2026-06-01", amount: 125, status: "matched" as const, source: "extracted" as const },
    { id: `${id}-line-2`, invoiceNumber: "STMT-101", date: "2026-06-08", amount: 275, status: "matched" as const, source: "extracted" as const },
  ];

  return {
    ...makeDocument(id, subject),
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

function makeQueuedCoiUploadResponse(documentId = "doc-current") {
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
  useInvoice: () => ({
    data: queryMocks.invoice,
    isLoading: false,
    isError: false,
    refetch: queryMocks.refetchInvoice,
  }),
  useInvoices: (filters: InvoiceFilters) => {
    queryMocks.filters.push(filters);
    return {
      data: {
        invoices: queryMocks.documents,
        total: queryMocks.documents.length,
        page: 1,
        limit: 200,
        pages: 1,
      },
      isLoading: false,
      isError: false,
    };
  },
  useClassifications: () => ({
    data: queryMocks.classifications,
    isLoading: false,
    isError: false,
  }),
  useAuditTrail: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
  useInvoiceActions: () => ({
    data: { actions: [] },
    isFetching: false,
  }),
  useWaiverRecipient: () => ({
    refetch: vi.fn().mockResolvedValue({ data: undefined, error: null }),
    isFetching: false,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useFileDocument: () => ({ mutateAsync: mutationMocks.fileDocument, isPending: false }),
  useFlagForSplit: () => ({ mutate: mutationMocks.flagForSplit, isPending: false, data: null }),
  useDiscardInvoice: () => ({ mutate: mutationMocks.discard, isPending: false }),
  useReclassifyInvoice: () => ({ mutate: mutationMocks.reclassify, isPending: false }),
  useUndoInvoiceAction: () => ({ mutate: mutationMocks.undoInvoiceAction, isPending: false }),
  useReconcileStatement: () => ({ mutateAsync: mutationMocks.reconcileStatement, isPending: false }),
  useAddStatementLine: () => ({ mutateAsync: mutationMocks.addStatementLine, isPending: false }),
  useUpdateStatementLine: () => ({ mutateAsync: mutationMocks.updateStatementLine, isPending: false }),
  useDeleteStatementLine: () => ({ mutateAsync: mutationMocks.deleteStatementLine, isPending: false }),
  useRematchStatementLines: () => ({ mutateAsync: mutationMocks.rematchStatementLines, isPending: false }),
  useResolveStatementLine: () => ({ mutateAsync: mutationMocks.resolveStatementLine, isPending: false }),
  useUnresolveStatementLine: () => ({ mutateAsync: mutationMocks.unresolveStatementLine, isPending: false }),
  useUpdateInvoice: () => ({ mutateAsync: mutationMocks.updateInvoice, isPending: false }),
  useUploadCoiToSpectrum: () => ({ mutateAsync: mutationMocks.uploadCoiToSpectrum, isPending: false }),
  useReprocessInvoice: () => ({ mutate: mutationMocks.reprocess, isPending: false }),
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: (permissions: string[]) =>
      permissions.includes("accounting.invoices.submit_spectrum"),
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/useSpectrumRefreshAction", () => ({
  useSpectrumRefreshAction: () => undefined,
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/CreateRuleFromInvoice", () => ({
  useCreateRuleFromInvoiceAction: () => ({ action: undefined, modal: null }),
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/SourceDocumentViewer", () => ({
  SourceDocumentViewer: ({ record }: { record: Invoice }) => (
    <div data-testid="source-document-viewer">{record.file}</div>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/DocumentPanelRouteSurface", () => ({
  DocumentPanelRouteSurface: ({
    record,
    onFileToProject,
    onFile,
    onUploadToSpectrum,
    onReconcile,
    undoControl,
    extraSecondaryActions,
    onRegisterPendingSave,
  }: {
    record: Invoice;
    onFileToProject?: (record: Invoice, meta?: { uploadToSharePoint?: boolean }) => DocumentFilingResult | Promise<DocumentFilingResult>;
    onFile?: (record: Invoice, meta?: { uploadToSharePoint?: boolean }) => DocumentFilingResult | Promise<DocumentFilingResult>;
    onUploadToSpectrum?: (record: Invoice, payload: { vendorCode: string; expirationDate: string }) => unknown;
    onReconcile?: (record: Invoice) => unknown;
    undoControl?: DocumentPanelUndoControl;
    extraSecondaryActions?: DocumentAction[];
    onRegisterPendingSave?: (handler: (() => Promise<void>) | null) => void;
  }) => {
    onRegisterPendingSave?.(async () => {
      await mutationMocks.updateInvoice({ id: record.id, payload: { notes: "pending panel save" } });
    });
    return (
      <div data-testid="document-panel-route-surface">
        {record.id}
        <span data-testid="undo-state">{undoControl?.disabled ? "undo-disabled" : "undo-enabled"}</span>
        <button
          type="button"
          onClick={() => void onFileToProject?.(record, { uploadToSharePoint: true })}
        >
          Mock File to Project
        </button>
        <button
          type="button"
          onClick={() => void onFile?.(record)}
        >
          Mock Shelve
        </button>
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
        {extraSecondaryActions?.map((action) => (
          <button key={action.id} type="button" onClick={action.onClick}>
            {action.label}
          </button>
        ))}
      </div>
    );
  },
}));

import DocumentDetailPage from "@/app/(dashboard)/accounting/documents/[id]/page";

describe("DocumentDetailPage", () => {
  beforeEach(() => {
    const prev = makeDocument("doc-prev", "Previous receipt");
    const current = makeDocument("doc-current", "Current receipt");
    const next = makeDocument("doc-next", "Next receipt");

    routeMocks.push.mockReset();
    routeMocks.replace.mockReset();
    routeMocks.params = { id: current.id };
    routeMocks.searchParams = new URLSearchParams(
      `from=${ENCODED_DOCUMENTS_RETURN}&status=documents&panel=receipt&docStatus=pending&search=acme&page=2&limit=25`,
    );
    queryMocks.invoice = current;
    queryMocks.documents = [prev, current, next];
    queryMocks.filters = [];
    queryMocks.refetchInvoice.mockReset();
    queryMocks.refetchInvoice.mockResolvedValue({ data: current });
    mutationMocks.fileDocument.mockReset();
    mutationMocks.fileDocument.mockResolvedValue({
      invoice: current,
      action: {
        actionId: "file-action-1",
        type: "file",
        undoable: true,
      },
    });
    mutationMocks.discard.mockReset();
    mutationMocks.flagForSplit.mockReset();
    mutationMocks.reclassify.mockReset();
    mutationMocks.undoInvoiceAction.mockReset();
    mutationMocks.reconcileStatement.mockReset();
    mutationMocks.reconcileStatement.mockResolvedValue({ invoice: { ...current, reconciled: true, filed: true } });
    mutationMocks.resolveStatementLine.mockReset();
    mutationMocks.unresolveStatementLine.mockReset();
    mutationMocks.addStatementLine.mockReset();
    mutationMocks.updateInvoice.mockReset();
    mutationMocks.updateInvoice.mockResolvedValue(undefined);
    mutationMocks.uploadCoiToSpectrum.mockReset();
    mutationMocks.uploadCoiToSpectrum.mockResolvedValue(makeQueuedCoiUploadResponse());
  });

  it("renders the full detail UI (not the empty state) for a no-attachment email-body document", () => {
    // Regression: email-body documents (`doc-<ts>-body`, classification
    // `no-attachment`) are reviewable and must not resolve to the `empty` panel
    // phase, which replaces the whole detail UI with TabEmpty.
    const emailBody: Invoice = {
      ...makeDocument("doc-1790200957496-body", "Email body only"),
      classification: "no-attachment",
      file: "",
    };
    routeMocks.params = { id: emailBody.id };
    queryMocks.invoice = emailBody;
    queryMocks.documents = [emailBody];

    render(<DocumentDetailPage />);

    expect(screen.queryByTestId("tab-empty")).not.toBeInTheDocument();
    expect(screen.queryByText("No documents")).not.toBeInTheDocument();
    expect(screen.getByTestId("source-document-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("document-panel-route-surface")).toHaveTextContent(emailBody.id);
    expect(screen.getByRole("button", { name: "Mock Shelve" })).toBeInTheDocument();
  });

  it("passes the retrying preview size through the document route", async () => {
    const user = userEvent.setup();
    render(<DocumentDetailPage />);

    await user.selectOptions(screen.getByLabelText("Panel state"), "retrying");
    await waitFor(() => expect(screen.getByRole("status", { name: "Retrying" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Retrying loader size"), { target: { value: "128" } });
    await waitFor(() => expect(screen.getByTestId("retrying-loader")).toHaveAttribute("data-size", "128"));
  });

  it("routes previous and next document actions through the shared header for non-invoice documents", async () => {
    const user = userEvent.setup();

    render(<DocumentDetailPage />);

    expect(queryMocks.filters.at(-1)).toMatchObject({
      filed: true,
      panel: "receipt",
      status: "pending",
      search: "acme",
    });

    expect(screen.getByText("Current receipt")).toBeInTheDocument();
    expect(screen.getAllByText("doc-current.pdf").length).toBeGreaterThan(0);
    const route = document.querySelector(".tbx-route-detail");
    expect(route).toHaveAttribute("data-route-identity", "document:doc-current");
    expect(route).toHaveAttribute("data-entering", "");
    await waitFor(() => expect(route).toHaveAttribute("data-phase", "ready"));

    await user.click(screen.getByRole("button", { name: "Next document" }));
    expect(routeMocks.push).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mutationMocks.updateInvoice).toHaveBeenCalledWith({
        id: "doc-current",
        payload: { notes: "pending panel save" },
      });
      expect(routeMocks.push).toHaveBeenLastCalledWith(`/accounting/documents/doc-next${DOCUMENT_NAV_QUERY}`);
    });

    await user.click(screen.getByRole("button", { name: "Previous document" }));
    await waitFor(() => {
      expect(routeMocks.push).toHaveBeenLastCalledWith(`/accounting/documents/doc-prev${DOCUMENT_NAV_QUERY}`);
    });
  });

  it("returns Close to the Documents dashboard tab with list filters intact", async () => {
    const user = userEvent.setup();
    render(<DocumentDetailPage />);

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(routeMocks.push).toHaveBeenCalledWith(
        "/accounting/invoices?status=documents&panel=receipt&docStatus=pending&search=acme&page=2&limit=25",
      );
    });
  });

  it("does not intercept Browser Back, external navigation, or tab close", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");

    render(<DocumentDetailPage />);

    const lifecycleEvents = addEventListener.mock.calls
      .map(([event]) => String(event))
      .filter((event) => ["popstate", "beforeunload", "unload"].includes(event));
    expect(lifecycleEvents).toEqual([]);
    expect(routeMocks.push).not.toHaveBeenCalled();

    addEventListener.mockRestore();
  });

  it("refreshes the navigation snapshot when the document sort context changes", async () => {
    const current = queryMocks.documents[1];
    const next = queryMocks.documents[2];
    const previous = queryMocks.documents[0];
    routeMocks.searchParams = new URLSearchParams(
      `from=${ENCODED_DOCUMENTS_RETURN}&status=documents&panel=receipt&docStatus=pending&search=acme&page=2&limit=25&sort=vendor&sortDir=asc`,
    );
    const view = render(<DocumentDetailPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Document 2 of 3")).toBeInTheDocument();
    });

    routeMocks.searchParams = new URLSearchParams(
      `from=${ENCODED_DOCUMENTS_RETURN}&status=documents&panel=receipt&docStatus=pending&search=acme&page=2&limit=25&sort=vendor&sortDir=desc`,
    );
    queryMocks.documents = [current, next, previous];
    view.rerender(<DocumentDetailPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Document 1 of 3")).toBeInTheDocument();
    });
  });

  it("keeps the navigation counter stable when a discarded document drops out of the list", async () => {
    const user = userEvent.setup();
    const current = queryMocks.documents[1];
    const next = queryMocks.documents[2];
    const view = render(<DocumentDetailPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Document 2 of 3")).toBeInTheDocument();
    });

    routeMocks.params = { id: next.id };
    queryMocks.invoice = next;
    queryMocks.documents = [queryMocks.documents[0], next];
    view.rerender(<DocumentDetailPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Document 3 of 3")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("panel-handoff")).toHaveAttribute("data-phase", "ready");
    });
    expect(current.id).toBe("doc-current");

    await user.click(screen.getByRole("button", { name: "Previous document" }));
    await waitFor(() => {
      expect(routeMocks.push).toHaveBeenLastCalledWith(expect.stringContaining("/accounting/documents/doc-prev"));
    });
  });

  it("records File to Project undo actions from the shelved document route", async () => {
    const user = userEvent.setup();

    render(<DocumentDetailPage />);

    await user.click(screen.getByRole("button", { name: "Mock File to Project" }));

    await waitFor(() => {
      expect(mutationMocks.fileDocument).toHaveBeenCalledWith({
        id: "doc-current",
        uploadToSharePoint: true,
      });
    });
    await waitFor(() => expect(screen.getByTestId("undo-state")).toHaveTextContent("undo-enabled"));
  });

  it("queues COI uploads on the document shelf without auto-navigation", async () => {
    const user = userEvent.setup();
    queryMocks.invoice = { ...makeDocument("doc-current", "Current COI"), classification: "coi" };

    render(<DocumentDetailPage />);

    await user.click(screen.getByRole("button", { name: "Mock Upload COI" }));

    await waitFor(() => {
      expect(mutationMocks.uploadCoiToSpectrum).toHaveBeenCalledWith({
        id: "doc-current",
        payload: { vendorCode: "HALD01", expirationDate: "2027-07-04" },
      });
    });
    expect(queryMocks.refetchInvoice).toHaveBeenCalledTimes(1);
    expect(routeMocks.push).not.toHaveBeenCalled();
  });

  it("advances after reconciling a statement document", async () => {
    const user = userEvent.setup();
    const prev = makeDocument("doc-prev", "Previous receipt");
    const current = makeStatementDocument("doc-current", "Current statement");
    const next = makeDocument("doc-next", "Next receipt");
    queryMocks.invoice = current;
    queryMocks.documents = [prev, current, next];

    render(<DocumentDetailPage />);

    await user.click(screen.getByRole("button", { name: "Mock Reconcile Statement" }));

    await waitFor(() => {
      expect(mutationMocks.reconcileStatement).toHaveBeenCalledWith({ id: "doc-current" });
    });
    await waitFor(() => {
      expect(routeMocks.push).toHaveBeenCalledWith(
        `/accounting/documents/doc-next${DOCUMENT_NAV_QUERY}`,
      );
    });
  });

  it("opens split review after queuing a document for split review", async () => {
    const user = userEvent.setup();

    render(<DocumentDetailPage />);

    await user.click(screen.getByRole("button", { name: "Split Document" }));

    expect(mutationMocks.flagForSplit).toHaveBeenCalledWith(
      { id: "doc-current" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    const options = mutationMocks.flagForSplit.mock.calls[0]?.[1] as { onSuccess?: () => void };
    options.onSuccess?.();

    await waitFor(() => {
      expect(routeMocks.push).toHaveBeenCalledWith(
        `/accounting/invoices/splits/doc-current?from=${ENCODED_DOCUMENTS_RETURN}`,
      );
    });
  });

  it("opens split review directly for a document already marked needs-split", async () => {
    const user = userEvent.setup();
    queryMocks.invoice = { ...makeDocument("doc-current", "Current receipt"), status: "needs-split" };

    render(<DocumentDetailPage />);

    await user.click(screen.getByRole("button", { name: "Split Document" }));

    expect(mutationMocks.flagForSplit).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(routeMocks.push).toHaveBeenCalledWith(
        `/accounting/invoices/splits/doc-current?from=${ENCODED_DOCUMENTS_RETURN}`,
      );
    });
  });
});
