import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardStats, InvoiceListResponse, TrashListResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";

const QM = vi.hoisted(() => ({
  filters: {
    status: "pending",
    page: 1,
    limit: 25,
    search: "",
  } as InvoiceFilters,
  setFilter: vi.fn(),
  setFilters: vi.fn(),
  routerPush: vi.fn(),
  refetchInvoices: vi.fn(),
  refetchStats: vi.fn(),
  discardInvoice: vi.fn(),
  runPipeline: vi.fn(),
  submitToSpectrum: vi.fn(),
  useInvoices: vi.fn(),
  useStats: vi.fn(),
  useTrash: vi.fn(),
  searchParams: new URLSearchParams(""),
  invoicesError: false,
  invoicesLoading: false,
  statsError: false,
  invoiceData: { invoices: [], total: 0, page: 1, limit: 25, pages: 1 } as InvoiceListResponse | undefined,
  trashData: { invoices: [], total: 2, limit: 25, offset: 0 } as TrashListResponse,
  stats: {
    total: 12,
    activeTotal: 12,
    trashTotal: 2,
    shelfTotal: 5,
    globalTotal: 19,
    pending: 4,
    approved: 3,
    rejected: 0,
    submitted: 5,
    discarded: 0,
    duplicate: 0,
    reviewed: 0,
    errors: 1,
    skipped: 0,
    todayProcessed: 6,
    avgConfidence: 0.9,
    missingLienWaivers: 2,
    amounts: { pending: 2500, approved: 5000, submitted: 12000, total: 19500 },
  } as DashboardStats,
}));

function makeInvoice(id: string, status: Invoice["status"]): Invoice {
  return {
    id,
    classification: "invoice",
    confidence: 0.92,
    file: `${id}.pdf`,
    email: {
      from: "ap@example.com",
      subject: id,
      receivedAt: "2026-07-01T12:00:00.000Z",
    },
    status,
    queuedAt: "2026-07-01T12:00:00.000Z",
    extracted: {
      vendorName: "Riverside Glass",
      vendorAddress: null,
      invoiceNumber: id,
      invoiceDate: "2026-07-01",
      dueDate: "2026-07-31",
      amount: 125,
      jobNumber: "25-401",
      projectName: "Harbor Point",
      description: "Materials",
      lineItems: [],
    },
    matching: {
      vendor: { vendorCode: "RIVR04", vendorName: "Riverside Glass", confidence: 0.94, method: "mock" },
      job: { jobNumber: "25-401", confidence: 0.92, method: "mock" },
      subcontract: null,
      sourceInvoiceTotal: null,
    },
    overallConfidence: 0.92,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

function makeInvoiceData(total = 0, invoices: Invoice[] = []): InvoiceListResponse {
  return { invoices, total, page: 1, limit: 25, pages: 1 };
}

function makeStats(): DashboardStats {
  return {
    total: 12,
    activeTotal: 12,
    trashTotal: 2,
    shelfTotal: 5,
    globalTotal: 19,
    pending: 4,
    approved: 3,
    rejected: 0,
    submitted: 5,
    discarded: 0,
    duplicate: 0,
    reviewed: 0,
    errors: 1,
    skipped: 0,
    todayProcessed: 6,
    avgConfidence: 0.9,
    missingLienWaivers: 2,
    amounts: { pending: 2500, approved: 5000, submitted: 12000, total: 19500 },
  };
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: QM.routerPush }),
  usePathname: () => "/accounting/invoices",
  useSearchParams: () => QM.searchParams,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/useInvoiceFilters", () => ({
  useInvoiceFilters: () => ({
    filters: QM.filters,
    setFilter: QM.setFilter,
    setFilters: QM.setFilters,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useInvoices: (filters: InvoiceFilters, options: { refetchInterval: number | false }) => {
    QM.useInvoices(filters, options);
    return {
      data: QM.invoiceData,
      isLoading: QM.invoicesLoading,
      isError: QM.invoicesError,
      refetch: QM.refetchInvoices,
    };
  },
  useStats: (params?: { filed?: boolean; panel?: InvoiceFilters["panel"] }) => {
    QM.useStats(params);
    return {
      data: QM.stats,
      isLoading: false,
      isError: QM.statsError,
      refetch: QM.refetchStats,
    };
  },
  useTrash: (
    params: { limit?: number; offset?: number; search?: string; panel?: InvoiceFilters["panel"] },
    options?: { enabled?: boolean },
  ) => {
    QM.useTrash(params, options);
    return {
      data: options?.enabled === false ? undefined : QM.trashData,
      isLoading: false,
    };
  },
  usePipelineStatus: () => ({ data: { running: false, lastRun: null, lastResult: null } }),
  useJobSearch: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useDiscardInvoice: () => ({
    isPending: false,
    mutateAsync: QM.discardInvoice,
  }),
  useRunPipeline: () => ({
    isPending: false,
    mutate: QM.runPipeline,
  }),
  useSubmitToSpectrum: () => ({
    isPending: false,
    mutateAsync: QM.submitToSpectrum,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/useRules", () => ({
  useRules: () => ({ data: { rules: [] } }),
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/InvoiceTable", () => ({
  InvoiceTable: ({
    data,
    isLoading,
    onRowClick,
  }: {
    data: InvoiceListResponse | undefined;
    isLoading: boolean;
    onRowClick?: (id: string, status: string, isTrash: boolean) => void;
  }) => (
    <div data-testid="invoice-table">
      {isLoading ? "Shaped skeleton rows" : `Rows: ${data?.total ?? 0}`}
      {data?.invoices.map((invoice) => (
        <button
          key={invoice.id}
          type="button"
          onClick={() => onRowClick?.(invoice.id, invoice.status, invoice.isTrash === true)}
        >
          Open {invoice.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/trash/TrashTable", () => ({
  TrashTable: ({
    data,
    onRowClick,
  }: {
    data: TrashListResponse | undefined;
    onRowClick?: (id: string) => void;
  }) => (
    <div data-testid="trash-table">
      Trash rows: {data?.total ?? 0}
      {data?.invoices.map((invoice) => (
        <div key={invoice.id}>
          <button type="button" onClick={() => onRowClick?.(invoice.id)}>Open trash {invoice.id}</button>
          <button type="button">Restore</button>
          <button type="button">Delete Permanently</button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/DocumentShelfWorkspace", () => ({
  DocumentShelfWorkspace: () => <div data-testid="document-shelf-workspace">Filed document workspace</div>,
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/ColumnToggleDropdown", () => ({
  DEFAULT_COLUMN_ORDER: [
    "status",
    "activityMarker",
    "vendorName",
    "jobNumber",
    "classification",
    "waiver",
    "amount",
    "queuedAt",
    "emailFrom",
    "emailSubject",
  ],
  ColumnToggleDropdown: ({
    columnVisibility,
    columnOrder,
    onReset,
  }: {
    columnVisibility: Record<string, boolean>;
    columnOrder: string[];
    onReset?: () => void;
  }) => (
    <>
      <button type="button">Columns</button>
      <button type="button" onClick={onReset}>Reset to default</button>
      <output data-testid="column-visibility">{JSON.stringify(columnVisibility)}</output>
      <output data-testid="column-order">{JSON.stringify(columnOrder)}</output>
    </>
  ),
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
    role: "admin",
    isAdmin: true,
    permissions: ["*"],
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/components/settings/SettingsPanel", () => ({
  SettingsPanel: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Settings">
        <button type="button" onClick={() => onOpenChange(false)}>
          Close settings
        </button>
      </div>
    ) : null,
}));

import { InvoiceQueuePage } from "@/app/(dashboard)/accounting/invoices/InvoiceQueuePage";

describe("InvoiceQueuePage", () => {
  beforeEach(() => {
    QM.filters = { status: "pending", page: 1, limit: 25, search: "" };
    QM.setFilter.mockReset();
    QM.setFilters.mockReset();
    QM.routerPush.mockReset();
    QM.refetchInvoices.mockReset();
    QM.refetchStats.mockReset();
    QM.discardInvoice.mockReset();
    QM.runPipeline.mockReset();
    QM.submitToSpectrum.mockReset();
    QM.useInvoices.mockReset();
    QM.useStats.mockReset();
    QM.useTrash.mockReset();
    QM.searchParams = new URLSearchParams("");
    QM.invoicesError = false;
    QM.invoicesLoading = false;
    QM.statsError = false;
    QM.invoiceData = makeInvoiceData();
    QM.trashData = { invoices: [], total: 2, limit: 25, offset: 0 };
    QM.stats = makeStats();
  });

  it("keeps the queue loading while the first invoice response is undefined", () => {
    QM.invoiceData = undefined;
    const { rerender } = render(<InvoiceQueuePage />);

    expect(screen.getByTestId("invoice-table")).toHaveTextContent("Shaped skeleton rows");
    expect(screen.queryByText("0-0 of 0")).not.toBeInTheDocument();

    QM.invoiceData = makeInvoiceData(1, [makeInvoice("ready-1", "pending")]);
    rerender(<InvoiceQueuePage />);

    expect(screen.getByTestId("invoice-table")).toHaveTextContent("Rows: 1");
    expect(screen.getByText("1-1 of 1")).toBeInTheDocument();
  });

  it("renders the refreshed dashboard shell and DataTablePattern surface", () => {
    render(<InvoiceQueuePage />);

    const submitButton = screen.getByRole("button", { name: /Submit to Spectrum/ });
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);

    expect(screen.getByRole("heading", { name: "Accounting // AP Billing" })).toBeInTheDocument();
    expect(screen.getByText("// AP Billing")).toHaveClass("text-ncg-cyan");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("title", expect.stringContaining("Settings •"));
    expect(screen.queryByText(/Accounts payable queue/i)).not.toBeInTheDocument();
    expect(submitButton.closest(".tbx-screen__head")).not.toBeNull();
    expect(submitButton).toHaveTextContent("3");
    expect(screen.getAllByRole("button", { name: /Submit to Spectrum/ })).toHaveLength(1);
    expect(screen.queryByText("Needs Split")).not.toBeInTheDocument();
    expect(tabs).toEqual(expect.arrayContaining([
      expect.stringMatching(/Pending/),
      expect.stringMatching(/Approved/),
      expect.stringMatching(/Submitted/),
      expect.stringMatching(/All/),
      expect.stringMatching(/Documents/),
    ]));
    // "Flagged" is no longer a status tab — it moved to the type-filter row.
    expect(tabs.some((tab) => /Flagged/.test(tab ?? ""))).toBe(false);
    expect(tabs.at(0)).toMatch(/Pending/);
    expect(tabs.at(-1)).toMatch(/Documents/);
    expect(screen.queryByPlaceholderText("Search vendor, invoice #, or job...")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "All jobs" })).toBeInTheDocument();
    const searchButton = screen.getByRole("button", { name: "Search" });
    const jobFilter = screen.getByRole("combobox", { name: "All jobs" });
    expect(jobFilter.closest('[data-dtp-toolbar="true"]')).toBeNull();
    expect(searchButton.closest('[data-dtp-toolbar="true"]')).toBeNull();
    expect(jobFilter.closest('.tbx-rail')).toBe(searchButton.closest('.tbx-rail'));
    expect(jobFilter.closest('[data-dtp-tabfilters="true"]')).not.toBeNull();
    expect(screen.getByRole("combobox", { name: "All jobs" }).closest('[aria-label="Document filters"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Flagged/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All types" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invoices" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Receipts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lien Waivers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan Now" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Pending/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Flagged/ })).not.toBeInTheDocument();
    // The persistent "flagged for review" notice was removed.
    expect(screen.queryByText(/flagged for review/i)).not.toBeInTheDocument();
    expect(screen.getByText("Trash")).toBeInTheDocument();
    expect(screen.getByTestId("invoice-table")).toBeInTheDocument();
  });

  it("opens settings from the queue toolbar", async () => {
    const user = userEvent.setup();

    render(<InvoiceQueuePage />);

    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close settings" }));

    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("wires metric cards and tabs to the status filter", async () => {
    const user = userEvent.setup();

    render(<InvoiceQueuePage />);

    await user.click(screen.getByRole("button", { name: /Ready to Submit/i }));
    await user.click(screen.getByRole("tab", { name: /Pending/ }));

    expect(QM.setFilter).toHaveBeenCalledWith("status", "approved");
    expect(QM.setFilter).toHaveBeenCalledWith("status", "pending");
  });

  it("renders Trash as a separated counted dashboard tab and selects discarded status", async () => {
    const user = userEvent.setup();

    render(<InvoiceQueuePage />);

    const trashButton = screen.getByRole("button", { name: /Trash2/ });
    expect(trashButton).toHaveAttribute("data-dtp-trash", "true");
    expect(trashButton.closest("[data-dtp-tabsrow='true']")).not.toBeNull();

    await user.click(trashButton);

    expect(QM.setFilter).toHaveBeenCalledWith("status", "discarded");
  });

  it("uses global search from Documents while retaining the Documents URL filter", async () => {
    const user = userEvent.setup();
    QM.filters = { status: "documents", page: 1, limit: 25, search: "acme" };
    QM.searchParams = new URLSearchParams("status=documents&search=acme");

    render(<InvoiceQueuePage />);

    expect(screen.getByRole("tab", { name: /^Documents\s*5$/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^Pending\s*4$/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Approved\s*3$/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Submitted\s*5$/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^All\s*12$/ })).toBeInTheDocument();
    expect(screen.getByTestId("invoice-table")).toBeInTheDocument();
    expect(screen.queryByTestId("document-shelf-workspace")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search vendor, invoice #, or job...")).toHaveValue("acme");
    expect(screen.getByRole("combobox", { name: "All jobs" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Document filters")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "All types" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flagged" })).not.toBeDisabled();
    expect(screen.getByText(/Searching all documents, including Trash/i)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Pending\s*4$/ }));
    expect(QM.setFilter).toHaveBeenCalledWith("status", "pending");
  });

  it("scopes Flagged to the active status and preserves that scope on exit", async () => {
    const user = userEvent.setup();
    QM.invoiceData = makeInvoiceData(2, [makeInvoice("flagged-1", "pending"), makeInvoice("flagged-2", "approved")]);
    QM.filters = { status: "pending", page: 1, limit: 25, search: "" };
    QM.stats = { ...makeStats(), flaggedCount: 61 };

    const { rerender } = render(<InvoiceQueuePage />);

    await user.click(screen.getByRole("button", { name: "Flagged (2)" }));
    expect(QM.setFilter).toHaveBeenCalledWith("flagged", true);

    QM.filters = { status: "pending", flagged: true, page: 1, limit: 25, search: "" };
    QM.searchParams = new URLSearchParams("status=pending&flagged=true");
    QM.setFilter.mockReset();
    rerender(<InvoiceQueuePage />);

    expect(QM.useInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", flagged: true, filed: false }),
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByText("2 flagged")).toBeInTheDocument();
    expect(screen.getByText("2 flagged").parentElement).toHaveTextContent("pending documents");
    await user.click(screen.getByRole("button", { name: "Show all pending documents" }));
    expect(QM.setFilters).toHaveBeenCalledWith({ flagged: undefined, search: "" });
  });

  it("turns Flagged on from Trash in one status-and-filter update", async () => {
    const user = userEvent.setup();
    QM.filters = { status: "discarded", page: 1, limit: 25, search: "" };

    render(<InvoiceQueuePage />);

    await user.click(screen.getByRole("button", { name: "Flagged" }));
    expect(QM.setFilters).toHaveBeenCalledWith({ status: "all", flagged: true });
  });

  it("counts flagged rows in the visible job-filtered result set", () => {
    QM.filters = { status: "pending", job: "25-401", page: 1, limit: 25, search: "" };
    QM.invoiceData = makeInvoiceData(3, [
      { ...makeInvoice("flagged-job", "pending"), flaggedAt: "2026-09-20T12:00:00.000Z" },
      makeInvoice("unflagged-job", "pending"),
      { ...makeInvoice("other-job", "pending"), matching: { ...makeInvoice("other-job", "pending").matching!, job: { jobNumber: "25-402", confidence: 1, method: "mock" } } },
    ]);

    render(<InvoiceQueuePage />);

    expect(screen.getByRole("button", { name: "Flagged (1)" })).toBeInTheDocument();
  });

  it("resets the queue column visibility and order to the production defaults", async () => {
    const user = userEvent.setup();

    render(<InvoiceQueuePage />);

    await user.click(screen.getByRole("button", { name: "Reset to default" }));

    expect(screen.getByTestId("column-visibility")).toHaveTextContent(
      '{"emailFrom":false,"emailSubject":false}',
    );
    expect(screen.getByTestId("column-order")).toHaveTextContent(
      '["status","activityMarker","vendorName","jobNumber","classification","waiver","amount","queuedAt","emailFrom","emailSubject"]',
    );
  });

  it("shares panel selection across queue and Documents tabs", async () => {
    const user = userEvent.setup();
    QM.filters = {
      status: "pending",
      panel: "coi",
      page: 1,
      limit: 25,
      search: "",
    };
    QM.searchParams = new URLSearchParams("status=pending&panel=coi");

    render(<InvoiceQueuePage />);

    expect(screen.getByRole("button", { name: "COI" })).toHaveAttribute("aria-pressed", "true");
    expect(QM.useInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ panel: "coi", status: "pending" }),
      expect.objectContaining({ enabled: true }),
    );

    await user.click(screen.getByRole("button", { name: "Receipts" }));
    await user.click(screen.getByRole("tab", { name: /^Documents/ }));

    expect(QM.setFilters).toHaveBeenCalledWith({ panel: "receipt", classification: undefined });
    expect(QM.setFilter).toHaveBeenCalledWith("status", "documents");
  });

  it("uses global search instead of narrowing text to the discarded tab", async () => {
    QM.filters = { status: "discarded", panel: "other", page: 1, limit: 25, search: "acme" };
    QM.searchParams = new URLSearchParams("status=discarded&panel=other&search=acme");

    render(<InvoiceQueuePage />);

    expect(QM.useInvoices).toHaveBeenCalledWith(
      { search: "acme", page: 1, limit: 25, sort: undefined, sortDir: undefined, scope: "global" },
      expect.objectContaining({ enabled: true }),
    );
    expect(QM.useTrash).toHaveBeenCalledWith(
      { limit: 25, offset: 0, search: "acme", panel: "other" },
      { enabled: false },
    );
    expect(screen.getByPlaceholderText("Search vendor, invoice #, or job...")).toHaveValue("acme");
    expect(screen.getByRole("combobox", { name: "All jobs" })).toBeInTheDocument();
    expect(screen.getByLabelText("Document filters")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Other" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search vendor, invoice number, or job" })).toHaveValue("acme");
    expect(screen.getByRole("button", { name: "Flagged" })).not.toBeDisabled();
    expect(screen.getByTestId("invoice-table")).toBeInTheDocument();
    expect(screen.queryByTestId("trash-table")).not.toBeInTheDocument();
    expect(screen.getByText(/Searching all documents, including Trash/i)).toBeInTheDocument();
  });

  it("uses global search while retaining existing URL filters for restoration", () => {
    QM.filters = {
      status: "approved", panel: "invoice", classification: "invoice", job: "25-401", flagged: true,
      page: 2, limit: 25, search: "acme",
    };
    QM.searchParams = new URLSearchParams("status=approved&panel=invoice&classification=invoice&job=25-401&flagged=true&search=acme");

    render(<InvoiceQueuePage />);

    expect(QM.useInvoices).toHaveBeenCalledWith(
      { search: "acme", page: 2, limit: 25, sort: undefined, sortDir: undefined, scope: "global" },
      expect.objectContaining({ enabled: true }),
    );
    expect(QM.useTrash).toHaveBeenCalledWith(expect.anything(), { enabled: false });
    expect(screen.getByText(/Searching all documents, including Trash/i)).toBeInTheDocument();
  });

  it("opens an active global result by its record status even from the Trash tab", async () => {
    const user = userEvent.setup();
    const active = makeInvoice("global-active", "approved");
    QM.filters = { status: "discarded", panel: "other", job: "25-401", page: 1, limit: 25, search: "acme" };
    QM.searchParams = new URLSearchParams("status=discarded&panel=other&job=25-401&search=acme");
    QM.invoiceData = makeInvoiceData(1, [active]);

    render(<InvoiceQueuePage />);
    await user.click(screen.getByRole("button", { name: "Open global-active" }));

    expect(QM.routerPush).toHaveBeenCalledWith(
      "/accounting/invoices/global-active?from=%2Faccounting%2Finvoices%3Fstatus%3Ddiscarded%26panel%3Dother%26job%3D25-401%26search%3Dacme&globalSearch=true&status=approved",
    );
  });

  it("preserves pending filters in the return URL for a global Trash result", async () => {
    const user = userEvent.setup();
    const trashed = { ...makeInvoice("global-trash", "pending"), isTrash: true, deletedAt: "2026-08-01T00:00:00.000Z" };
    QM.filters = { status: "pending", panel: "invoice", classification: "invoice", job: "25-401", page: 1, limit: 25, search: "acme" };
    QM.searchParams = new URLSearchParams("status=pending&panel=invoice&classification=invoice&job=25-401&search=acme");
    QM.invoiceData = makeInvoiceData(1, [trashed]);

    render(<InvoiceQueuePage />);
    await user.click(screen.getByRole("button", { name: "Open global-trash" }));

    expect(QM.routerPush).toHaveBeenCalledWith(
      "/accounting/invoices/global-trash?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending%26panel%3Dinvoice%26classification%3Dinvoice%26job%3D25-401%26search%3Dacme&globalSearch=true&status=discarded",
    );
  });

  it("opens a trashed needs-split global result in the read-only detail route", async () => {
    const user = userEvent.setup();
    const trashed = { ...makeInvoice("global-trash-needs-split", "needs-split"), isTrash: true, deletedAt: "2026-08-01T00:00:00.000Z" };
    QM.filters = { status: "pending", page: 1, limit: 25, search: "acme" };
    QM.searchParams = new URLSearchParams("status=pending&search=acme");
    QM.invoiceData = makeInvoiceData(1, [trashed]);

    render(<InvoiceQueuePage />);
    await user.click(screen.getByRole("button", { name: "Open global-trash-needs-split" }));

    expect(QM.routerPush).toHaveBeenCalledWith(
      "/accounting/invoices/global-trash-needs-split?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending%26search%3Dacme&globalSearch=true&status=discarded",
    );
  });

  it.each([
    ["Pending", "pending"],
    ["Approved", "approved"],
    ["Submitted", "submitted"],
    ["All", "all"],
  ] satisfies Array<[string, NonNullable<InvoiceFilters["status"]>]>)(
    "carries the active %s tab into row detail URLs",
    async (_label, activeStatus) => {
      const user = userEvent.setup();
      const rowStatus = activeStatus === "all" ? "pending" : activeStatus;
      const invoice = makeInvoice(`invoice-${activeStatus}`, rowStatus);
      QM.filters = { status: activeStatus, page: 1, limit: 25, search: "" };
      QM.invoiceData = makeInvoiceData(1, [invoice]);

      render(<InvoiceQueuePage />);

      await user.click(screen.getByRole("button", { name: `Open ${invoice.id}` }));

      expect(QM.routerPush).toHaveBeenCalledWith(
        `/accounting/invoices/${invoice.id}?from=%2Faccounting%2Finvoices&status=${activeStatus}`,
      );
    },
  );

  it("preserves dashboard return and sort context when opening detail rows", async () => {
    const user = userEvent.setup();
    const invoice = { ...makeInvoice("invoice-approved", "approved"), overallConfidence: 0.55 };
    QM.searchParams = new URLSearchParams("status=approved&job=25-401&confidence=low&search=glass");
    QM.filters = {
      status: "approved",
      job: "25-401",
      page: 2,
      limit: 25,
      search: "glass",
      sort: "received",
      sortDir: "desc",
    };
    QM.invoiceData = makeInvoiceData(1, [invoice]);

    render(<InvoiceQueuePage />);

    await user.click(screen.getByRole("button", { name: "Open invoice-approved" }));

    expect(QM.routerPush).toHaveBeenCalledWith(
      "/accounting/invoices/invoice-approved?from=%2Faccounting%2Finvoices%3Fstatus%3Dapproved%26job%3D25-401%26confidence%3Dlow%26search%3Dglass&globalSearch=true&status=approved",
    );
  });

  it("preserves queue context when opening a needs-split row", async () => {
    const user = userEvent.setup();
    const invoice = makeInvoice("invoice-needs-split", "needs-split");
    QM.searchParams = new URLSearchParams("status=pending&panel=invoice&classification=invoice&search=glass&splitFrom=parent-1");
    QM.filters = {
      status: "pending",
      panel: "invoice",
      classification: "invoice",
      page: 1,
      limit: 25,
      search: "glass",
      sort: "received",
      sortDir: "desc",
    };
    QM.invoiceData = makeInvoiceData(1, [invoice]);

    render(<InvoiceQueuePage />);

    await user.click(screen.getByRole("button", { name: "Open invoice-needs-split" }));

    expect(QM.routerPush).toHaveBeenCalledWith(
      "/accounting/invoices/splits/invoice-needs-split?from=%2Faccounting%2Finvoices%3Fstatus%3Dpending%26panel%3Dinvoice%26classification%3Dinvoice%26search%3Dglass%26splitFrom%3Dparent-1&status=needs-split",
    );
  });

  it("keeps the job filter when a status tab changes", async () => {
    const user = userEvent.setup();
    QM.filters = {
      status: "all",
      job: "25-401",
      page: 1,
      limit: 25,
      search: "",
    };

    render(<InvoiceQueuePage />);

    await user.click(screen.getByRole("tab", { name: /Pending/ }));

    expect(QM.setFilter).toHaveBeenCalledWith("status", "pending");
    expect(QM.setFilters).not.toHaveBeenCalledWith(expect.objectContaining({
      job: undefined,
    }));
  });

  it("keeps the job filter when a metric card changes status", async () => {
    const user = userEvent.setup();
    QM.filters = {
      status: "all",
      job: "25-401",
      page: 1,
      limit: 25,
      search: "",
    };

    render(<InvoiceQueuePage />);

    await user.click(screen.getByRole("button", { name: /Ready to Submit/i }));

    expect(QM.setFilter).toHaveBeenCalledWith("status", "approved");
    expect(QM.setFilters).not.toHaveBeenCalledWith(expect.objectContaining({
      job: undefined,
    }));
  });

  it.each(["Close search", "Escape", "Clear filters"])("%s clears the search and collapses the rail after typing", async (method) => {
    const user = userEvent.setup();
    const { rerender } = render(<InvoiceQueuePage />);
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByRole("textbox", { name: "Search vendor, invoice number, or job" }), "glass");
    await waitFor(() => expect(QM.setFilter).toHaveBeenCalledWith("search", "glass"));
    QM.filters = { ...QM.filters, search: "glass" };
    rerender(<InvoiceQueuePage />);
    expect(QM.useInvoices).toHaveBeenCalledWith(expect.objectContaining({ search: "glass" }), expect.anything());
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeInTheDocument();
    if (method === "Escape") await user.keyboard("{Escape}");
    else await user.click(screen.getByRole("button", { name: method }));
    expect(QM.setFilters).toHaveBeenCalledWith(expect.objectContaining({ search: "" }));
    expect(screen.queryByRole("textbox", { name: "Search vendor, invoice number, or job" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All types" })).toBeVisible();
    QM.filters = { ...QM.filters, search: "" };
    rerender(<InvoiceQueuePage />);
    expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("textbox", { name: "Search vendor, invoice number, or job" })).toHaveValue("");
  });

  it("summary clear closes search even in the flagged scope without dropping its other filters", async () => {
    const user = userEvent.setup();
    QM.filters = { status: "pending", flagged: true, panel: "coi", search: "glass" };
    render(<InvoiceQueuePage />);
    await user.click(screen.getByRole("button", { name: "Show all pending documents" }));
    expect(QM.setFilters).toHaveBeenCalledWith({ flagged: undefined, search: "" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("clears represented filters while preserving the active status tab", async () => {
    const user = userEvent.setup();
    QM.filters = {
      status: "pending",
      panel: "coi",
      job: "25-401",
      page: 1,
      limit: 25,
      search: "acme",
    };

    render(<InvoiceQueuePage />);

    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.getByText("25-401")).toBeInTheDocument();
    // Confidence presentation is intentionally retired from the queue contract.
    expect(screen.queryByText("medium")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /clear filters/i }));

    expect(QM.setFilters).toHaveBeenCalledWith({
      search: "",
      panel: undefined,
      classification: undefined,
      job: undefined,
    });
  });

  it("clears a panel-only dashboard filter using its human-readable label", async () => {
    const user = userEvent.setup();
    QM.filters = {
      status: "pending",
      panel: "lien-waiver",
      page: 1,
      limit: 25,
      search: "",
    };

    render(<InvoiceQueuePage />);

    expect(screen.getByText("Lien Waivers", { selector: "strong" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /clear filters/i }));

    expect(QM.setFilters).toHaveBeenCalledWith({
      search: "",
      panel: undefined,
      classification: undefined,
      job: undefined,
    });
  });

  it("keeps folder tab counts sourced from global stats", () => {
    QM.filters = {
      status: "pending",
      page: 1,
      limit: 25,
      search: "",
    };
    QM.invoiceData = makeInvoiceData(1);
    QM.stats = { ...makeStats(), pending: 9, approved: 8, total: 17 };

    render(<InvoiceQueuePage />);

    expect(screen.getByRole("tab", { name: /Pending9/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Approved8/ })).toBeInTheDocument();
  });

  it("renders the All tab count from active totals while keeping the all status query", () => {
    QM.filters = {
      status: "all",
      page: 1,
      limit: 25,
      search: "",
    };
    QM.invoiceData = makeInvoiceData(9);
    QM.stats = {
      ...makeStats(),
      total: 12,
      activeTotal: 9,
      trashTotal: 3,
      shelfTotal: 5,
      globalTotal: 17,
      pending: 4,
      approved: 3,
      submitted: 2,
      discarded: 2,
      duplicate: 1,
    };

    render(<InvoiceQueuePage />);

    expect(screen.getByRole("tab", { name: /^All\s*9$/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^All\s*12$/ })).not.toBeInTheDocument();
    expect(QM.useInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ status: "all", filed: false }),
      { enabled: true, refetchInterval: false },
    );
  });

  it("uses the exact stats trash total without issuing a count probe", () => {
    QM.stats = { ...makeStats(), trashTotal: 7, discarded: 2 };
    QM.trashData = { invoices: [], total: 99, limit: 25, offset: 0 };

    render(<InvoiceQueuePage />);

    expect(screen.getByRole("button", { name: /Trash7/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Trash2/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Trash99/ })).not.toBeInTheDocument();
    expect(QM.useTrash).toHaveBeenCalledOnce();
    expect(QM.useTrash).toHaveBeenCalledWith(
      { limit: 25, offset: 0, search: undefined, panel: undefined },
      { enabled: false },
    );
  });

  it("uses panel-scoped stats for every folder count", () => {
    QM.filters = { status: "documents", panel: "receipt", page: 1, limit: 25, search: "" };

    render(<InvoiceQueuePage />);

    expect(QM.useStats).toHaveBeenCalledWith({ filed: false, panel: "receipt" });
    expect(screen.getByRole("tab", { name: /^Documents\s*5$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Trash2/ })).toBeInTheDocument();
  });

  it("shows an explicit queue error when invoices fail to load", async () => {
    const user = userEvent.setup();
    QM.invoicesError = true;

    render(<InvoiceQueuePage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Invoice queue unavailable");
    expect(screen.queryByTestId("invoice-table")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(QM.refetchInvoices).toHaveBeenCalledTimes(1);
  });

  it("shows an explicit metrics error when stats fail to load", () => {
    QM.statsError = true;

    render(<InvoiceQueuePage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Invoice metrics unavailable");
  });
});
