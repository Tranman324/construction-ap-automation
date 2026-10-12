import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoiceListResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { InvoiceFilters } from "@/modules/accounting/modules/invoices/types/ui";

const SHELF_MOCKS = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: new URLSearchParams(),
  queries: [] as InvoiceFilters[],
}));

function makeDocument(id: string, classification: Invoice["classification"] = "coi"): Invoice {
  return {
    id,
    classification,
    confidence: 0.9,
    overallConfidence: 0.9,
    file: `${id}.pdf`,
    email: { from: "vendor@example.com", subject: id, receivedAt: "2026-07-01T00:00:00Z" },
    status: "reviewed",
    queuedAt: "2026-07-01T00:00:00Z",
    extracted: null,
    matching: null,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

const shelfData: InvoiceListResponse = {
  invoices: [makeDocument("doc-1")], total: 1, page: 2, limit: 50, pages: 2,
};
const waiverData: InvoiceListResponse = {
  invoices: [makeDocument("waiver-1", "lien-waiver")], total: 1, page: 1, limit: 50, pages: 1,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: SHELF_MOCKS.push }),
  usePathname: () => "/accounting/invoices",
  useSearchParams: () => SHELF_MOCKS.searchParams,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useInvoices: (filters: InvoiceFilters) => {
    SHELF_MOCKS.queries.push(filters);
    return {
      data: filters.classification === "lien-waiver" && filters.status === "pending" ? waiverData : shelfData,
      isLoading: false,
    };
  },
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/InvoiceTable", () => ({
  InvoiceTable: ({ data, onRowClick }: { data?: InvoiceListResponse; onRowClick?: (id: string) => void }) => (
    <div data-testid="document-table">
      Filed rows: {data?.total ?? 0}
      <button type="button" onClick={() => onRowClick?.("doc-1")}>Open document</button>
    </div>
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/PaginationBar", () => ({
  PaginationBar: ({ total }: { total: number }) => <div>Document total: {total}</div>,
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/DocumentShelfSelectionBar", () => ({
  DocumentShelfSelectionBar: () => null,
}));

vi.mock("@/modules/accounting/modules/invoices/components/documents/LienWaiverEditPanel", () => ({
  LienWaiverEditPanel: () => <div data-testid="waiver-edit-path" />,
}));

import { DocumentShelfWorkspace } from "@/modules/accounting/modules/invoices/components/documents/DocumentShelfWorkspace";

describe("DocumentShelfWorkspace", () => {
  beforeEach(() => {
    SHELF_MOCKS.push.mockReset();
    SHELF_MOCKS.queries = [];
    SHELF_MOCKS.searchParams = new URLSearchParams(
      "status=documents&panel=coi&docStatus=reviewed&search=acme&page=2&limit=50",
    );
  });

  it("queries filed documents and opens detail with complete dashboard context", async () => {
    const user = userEvent.setup();
    render(<DocumentShelfWorkspace />);

    expect(SHELF_MOCKS.queries).toContainEqual(expect.objectContaining({
      filed: true,
      panel: "coi",
      status: "reviewed",
      search: "acme",
      page: 2,
      limit: 50,
    }));
    expect(screen.getByTestId("document-table")).toHaveTextContent("Filed rows: 1");
    expect(screen.getByTestId("waiver-edit-path")).toBeInTheDocument();
    expect(screen.queryByLabelText("Document panels")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Document status")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open document" }));

    expect(SHELF_MOCKS.push).toHaveBeenCalledWith(
      "/accounting/documents/doc-1?from=%2Faccounting%2Finvoices%3Fstatus%3Ddocuments%26panel%3Dcoi%26docStatus%3Dreviewed%26search%3Dacme%26page%3D2%26limit%3D50&status=documents&panel=coi&docStatus=reviewed&search=acme&page=2&limit=50",
    );
  });

  it("keeps the lien-waiver attention path inside the Documents dashboard tab", async () => {
    const user = userEvent.setup();
    render(<DocumentShelfWorkspace />);

    await user.click(screen.getByRole("button", { name: /1 lien waiver missing vendor or job/i }));

    expect(SHELF_MOCKS.push).toHaveBeenCalledWith(
      "/accounting/invoices?status=documents&panel=lien-waiver&docStatus=pending&search=acme&limit=50",
    );
  });
});
