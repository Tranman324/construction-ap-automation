import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { vi } from "vitest";

import type { DashboardStats } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

interface SubmitControlMocks {
  allowed: boolean;
  discardMutateAsync: ReturnType<typeof vi.fn>;
  fetchInvoice: ReturnType<typeof vi.fn>;
  invoices: unknown[];
  mutateAsync: ReturnType<typeof vi.fn>;
  pathname: string;
  routerPush: ReturnType<typeof vi.fn>;
  searchParams: URLSearchParams;
  toastWarning: ReturnType<typeof vi.fn>;
}

const SC = vi.hoisted((): SubmitControlMocks => ({
  allowed: true,
  discardMutateAsync: vi.fn(),
  fetchInvoice: vi.fn(),
  invoices: [],
  mutateAsync: vi.fn(),
  pathname: "/accounting/invoices",
  routerPush: vi.fn(),
  searchParams: new URLSearchParams(""),
  toastWarning: vi.fn(),
}));

export function getSubmitControlMocks(): SubmitControlMocks {
  return SC;
}

vi.mock("next/navigation", () => ({
  usePathname: () => SC.pathname,
  useRouter: () => ({ push: SC.routerPush }),
  useSearchParams: () => SC.searchParams,
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => SC.allowed,
    hasAllPermissions: () => SC.allowed,
    role: SC.allowed ? "admin" : "viewer",
    isAdmin: SC.allowed,
    permissions: SC.allowed ? ["*"] : [],
  }),
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: {
    warning: SC.toastWarning,
  },
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  fetchInvoice: SC.fetchInvoice,
  useInvoices: () => ({
    data: {
      invoices: SC.invoices,
      total: SC.invoices.length,
      page: 1,
      limit: 100,
      pages: 1,
    },
    isLoading: false,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useDiscardInvoice: () => ({
    isPending: false,
    mutateAsync: SC.discardMutateAsync,
  }),
  useSubmitToSpectrum: () => ({
    isPending: false,
    mutateAsync: SC.mutateAsync,
  }),
}));

import { InvoiceQueueSubmitControl } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceQueueSubmitControl";

interface RenderControlOptions {
  stats?: DashboardStats;
  statsLoading?: boolean;
  selectedIds?: string[];
  selectedInvoices?: Invoice[];
  strictMode?: boolean;
}

export function resetSubmitControlMocks(): void {
  SC.allowed = true;
  SC.discardMutateAsync.mockReset();
  SC.discardMutateAsync.mockResolvedValue({});
  SC.fetchInvoice.mockReset();
  SC.invoices = [];
  SC.mutateAsync.mockReset();
  SC.mutateAsync.mockResolvedValue({ success: true, submitted: 1, message: "Submitted" });
  SC.pathname = "/accounting/invoices";
  SC.routerPush.mockReset();
  SC.searchParams = new URLSearchParams("");
  SC.toastWarning.mockReset();
  window.sessionStorage.clear();
}

export function makeStats(overrides: Partial<DashboardStats> = {}): DashboardStats {
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
    errors: 0,
    skipped: 0,
    todayProcessed: 6,
    avgConfidence: 0.9,
    missingLienWaivers: 0,
    amounts: { pending: 2500, approved: 5000, submitted: 12000, total: 19500 },
    ...overrides,
  };
}

export function makeExtracted(
  id: string,
  amount = 100,
  jobNumber = "25-401",
  vendorName = "Acme Concrete",
): NonNullable<Invoice["extracted"]> {
  return {
    vendorName,
    vendorAddress: null,
    invoiceNumber: id,
    invoiceDate: null,
    dueDate: null,
    amount,
    jobNumber,
    projectName: null,
    description: null,
    lineItems: [],
  };
}

export function makeInvoice(id: string, overrides: Partial<Invoice> = {}): Invoice {
  return {
    id,
    classification: "invoice",
    confidence: 0.9,
    file: `${id}.pdf`,
    email: { from: "vendor@example.com", subject: "Invoice", receivedAt: "2026-01-01T00:00:00Z" },
    status: "approved",
    queuedAt: "2026-01-01T00:00:00Z",
    extracted: makeExtracted(id),
    matching: null,
    overallConfidence: 0.9,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    ...overrides,
  };
}

export function renderControl({
  stats = makeStats(),
  statsLoading = false,
  selectedIds = [],
  selectedInvoices = [],
  strictMode = false,
}: RenderControlOptions = {}) {
  const control = (
    <InvoiceQueueSubmitControl
      stats={stats}
      statsLoading={statsLoading}
      selectedIds={selectedIds}
      selectedInvoices={selectedInvoices}
    />
  );

  return render(strictMode ? <StrictMode>{control}</StrictMode> : control);
}
