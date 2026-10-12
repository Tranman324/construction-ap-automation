import React from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const M = vi.hoisted(() => ({
  invoiceDate: "2026-03-01",
  get: vi.fn((path: string) => {
    if (path === "/api/invoices/test-id") return Promise.resolve(makeInvoice(M.invoiceDate));
    return Promise.resolve([]);
  }),
  post: vi.fn((path: string) => {
    if (path === "/api/invoices/test-id/approve") {
      M.invoiceDate = "2026-08-01";
      return Promise.resolve({ invoice: makeInvoice(M.invoiceDate), action: {} });
    }
    return Promise.reject(new Error(`Unexpected POST ${path}`));
  }),
  patch: vi.fn((path: string, body: { invoiceDate: string }) => {
    if (path === "/api/invoices/test-id") {
      M.invoiceDate = body.invoiceDate;
      return Promise.resolve({
        invoice: makeInvoice(M.invoiceDate),
        action: {},
        approvalVerdict: { blockers: [], blockerDetails: [] },
      });
    }
    return Promise.reject(new Error(`Unexpected PATCH ${path}`));
  }),
}));

vi.mock("@/modules/shared/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/shared/lib/api")>();
  return { ...actual, api: { ...actual.api, get: M.get, post: M.post, patch: M.patch } };
});

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/accounting/modules/invoices/hooks/queries")>();
  return {
    ...actual,
    useValidateApproval: () => ({
      data: {
        blockers: [],
        blockerDetails: M.invoiceDate === "2026-08-01" ? [] : [{
          code: "CLOSED_PERIOD_DATE",
          invoiceDateMonth: "July 2026",
          currentMonth: "August 2026",
          suggestedInvoiceDate: "2026-08-01",
        }],
        codingDefaults: { glAccount: "5450", costType: "S", phaseCode: "15400", routingCode: "D", glDate: null },
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    }),
    useSubcontracts: () => ({ data: [] }),
    useVendorSearch: () => ({ data: [], isLoading: false }),
    useJobSearch: () => ({ data: [], isLoading: false }),
    useJobByNumber: () => ({ data: null }),
  };
});

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasAnyPermission: () => true, hasAllPermissions: () => true, role: "admin", isAdmin: true, permissions: ["*"] }),
}));

vi.mock("@/modules/shared/lib/auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/modules/accounting/modules/invoices/lib/auditEvents", () => ({
  emitInvoiceAuditEvent: vi.fn(),
  getInvoiceLabel: () => "INV-001",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { InvoiceActionBarWithTray as InvoiceActionBar } from "./closedPeriodTray.testUtils";
import { InvoiceDetailForm, type InvoiceDetailFormHandle } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailForm";
import { useInvoice } from "@/modules/accounting/modules/invoices/hooks/queries";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

function makeInvoice(invoiceDate: string): Invoice {
  return {
    id: "test-id", classification: "invoice", confidence: 0.9, overallConfidence: 0.9, file: "test.pdf",
    email: { from: "vendor@example.com", subject: "Invoice", receivedAt: "2026-03-01T00:00:00Z" },
    status: "pending", queuedAt: "2026-03-01T00:00:00Z",
    extracted: { vendorName: "Acme", vendorAddress: null, invoiceNumber: "INV-001", invoiceDate, dueDate: null, amount: 100, jobNumber: "25-517", projectName: null, description: null, lineItems: [] },
    matching: { vendor: { vendorCode: "V001", vendorName: "Acme", confidence: 1, method: "test" }, job: { jobNumber: "", confidence: 1, method: "test" }, subcontract: { subcontractNumber: "25-517.08", confidence: 1, method: "test" }, sourceInvoiceTotal: 100 },
    splitFrom: null, duplicateOf: null, reason: null, error: null, reclassifiedFrom: null, reclassifiedAt: null,
  };
}

function ActiveInvoiceDetailRoute() {
  const { data: invoice } = useInvoice("test-id");
  const formRef = React.useRef<InvoiceDetailFormHandle>(null);
  const [isActive, setIsActive] = React.useState(true);

  if (!isActive) return <p>navigated</p>;
  if (!invoice) return <p>loading</p>;

  return (
    <>
      <InvoiceDetailForm invoice={invoice} ref={formRef} />
      <InvoiceActionBar
        invoiceId={invoice.id}
        invoice={invoice}
        classification="invoice"
        formRef={formRef}
        hasUnsavedChanges={false}
        onActionSuccess={() => setIsActive(false)}
      />
    </>
  );
}

describe("closed-period recovery refetch", () => {
  it("keeps the active detail mounted and applies the canonical PATCH date", async () => {
    M.invoiceDate = "2026-03-01";
    M.get.mockClear();
    M.post.mockClear();
    M.patch.mockClear();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    render(<ActiveInvoiceDetailRoute />, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });

    await waitFor(() => expect(screen.getByDisplayValue("2026-03-01")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Use 2026-08-01" }));

    await waitFor(() => expect(screen.getByDisplayValue("2026-08-01")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Use 2026-08-01" })).not.toBeInTheDocument());
    expect(screen.queryByText("navigated")).not.toBeInTheDocument();
    expect(M.patch).toHaveBeenCalledWith("/api/invoices/test-id", { invoiceDate: "2026-08-01" });
    expect(M.post).not.toHaveBeenCalled();
    expect(M.get).toHaveBeenCalledTimes(1);
  });
});
