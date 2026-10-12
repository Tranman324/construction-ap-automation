import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TrashListResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

vi.mock("@/modules/accounting/modules/invoices/components/trash/TrashActions", async () => {
  const actual = await vi.importActual<typeof import("@/modules/accounting/modules/invoices/components/trash/TrashActions")>(
    "@/modules/accounting/modules/invoices/components/trash/TrashActions",
  );
  return {
    TrashActions: ({ invoice }: { invoice: Invoice }) => (
      <>
        <button type="button">Restore or delete</button>
        <actual.TrashActions invoice={invoice} />
      </>
    ),
  };
});

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  usePermanentDelete: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useClassifications: () => ({ classifications: [], isLoading: false, isError: true }),
}));

import { TrashTable } from "@/modules/accounting/modules/invoices/components/trash/TrashTable";
import { expectDomOrder, expectNoPositiveTabIndex } from "../tabOrderAssertions";

const invoice = {
  id: "invoice-1",
  email: {
    from: "billing@vendor.example",
    subject: "July progress billing",
    receivedAt: "2026-07-01T12:00:00.000Z",
  },
  classification: "invoice",
  extracted: { amount: 1250, vendorName: "Riverside Glass", invoiceNumber: "INV-43109" },
  matching: null,
  deletedAt: "2026-08-14T12:00:00.000Z",
  deletedBy: "Dana Brown",
} as Invoice;

const data: TrashListResponse = {
  invoices: [invoice],
  total: 1,
  limit: 25,
  offset: 0,
};

const props = {
  data,
  isLoading: false,
  page: 1,
  pages: 1,
  limit: 25,
  onPageChange: vi.fn(),
  onLimitChange: vi.fn(),
};

const TRASH_HEADERS = ["Status", "Vendor / Document", "Type", "Source", "Amount", "Discarded", "Actions"];

describe("TrashTable", () => {
  describe("trash table tab order", () => {
    it("keeps the focusable row, real recovery actions, and pagination in DOM order", () => {
      const { container } = render(<TrashTable {...props} pages={2} onRowClick={vi.fn()} />);
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expectDomOrder([
        screen.getAllByRole("row")[1],
        screen.getByRole("button", { name: "Restore" }),
        screen.getByRole("button", { name: "Delete Permanently" }),
        screen.getByRole("combobox"),
        screen.getByRole("button", { name: "Next page" }),
      ]);
      expectNoPositiveTabIndex(container);
    });
  });

  it("uses status, identity, amount, date, and action shapes while loading", () => {
    const { container } = render(<TrashTable {...props} data={undefined} isLoading />);
    const cells = container.querySelectorAll("tbody tr:first-child td");
    expect(cells).toHaveLength(TRASH_HEADERS.length);
    expect(cells[0].querySelector('[data-slot="skeleton"]')).toHaveClass("rounded-full");
    expect(cells[1].querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    expect(cells[4].querySelector('[data-slot="skeleton"]')).toHaveClass("w-16");
    expect(cells[5].querySelector('[data-slot="skeleton"]')).toHaveClass("w-16");
    expect(cells[6].querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    expect(cells[6].querySelectorAll('[data-slot="skeleton"]')[0]).toHaveClass("w-20", "h-8");
    expect(cells[6].querySelectorAll('[data-slot="skeleton"]')[1]).toHaveClass("w-28", "h-8");
  });

  it("arms the loaded row once and leaves later pages and refetches visible", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<TrashTable {...props} data={undefined} isLoading />);
      rerender(<TrashTable {...props} />);
      const row = screen.getByText("Riverside Glass").closest("tr");
      expect(row).toHaveAttribute("data-arriving", "true");
      expect(row).toHaveAttribute("data-row-order", "0");
      act(() => vi.advanceTimersByTime(520));
      expect(row).not.toHaveAttribute("data-arriving");

      rerender(<TrashTable {...props} data={{ ...data, invoices: [{ ...invoice, id: "page-two" }] }} page={2} />);
      expect(screen.getByText("Riverside Glass").closest("tr")).not.toHaveAttribute("data-arriving");
      rerender(<TrashTable {...props} data={undefined} isLoading />);
      rerender(<TrashTable {...props} />);
      expect(screen.getByText("Riverside Glass").closest("tr")).not.toHaveAttribute("data-arriving");
    } finally {
      vi.useRealTimers();
    }
  });

  it("arms every visible trash row regardless of count", () => {
    const many = { ...data, invoices: Array.from({ length: 14 }, (_, index) => ({ ...invoice, id: `trash-${index}` })), total: 14 };
    const { container, rerender } = render(<TrashTable {...props} data={undefined} isLoading />);
    rerender(<TrashTable {...props} data={many} />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(14);
    expect(rows[12]).toHaveAttribute("data-arriving", "true");
    expect(rows[13]).toHaveAttribute("data-arriving", "true");
  });

  it("reveals the loaded row immediately when the tab becomes hidden", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    try {
      const { rerender } = render(<TrashTable {...props} data={undefined} isLoading />);
      rerender(<TrashTable {...props} />);
      const row = screen.getByText("Riverside Glass").closest("tr");
      expect(row).toHaveAttribute("data-arriving", "true");
      visibility.mockReturnValue("hidden");
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      expect(row).not.toHaveAttribute("data-arriving");
    } finally {
      visibility.mockRestore();
    }
  });

  it("keeps email-only records identifiable without inventing a vendor or invoice number", () => {
    render(<TrashTable {...props} data={{ ...data, invoices: [{
      ...invoice, file: "", extracted: null, matching: null,
    }] }} />);
    expect(screen.getByText("billing@vendor.example")).toBeInTheDocument();
    expect(screen.getByText("July progress billing")).toBeInTheDocument();
    expect(screen.queryByText("Riverside Glass")).not.toBeInTheDocument();
    expect(screen.queryByText("INV-43109")).not.toBeInTheDocument();
  });

  it("shows the served vendor code and name while keeping document identity", () => {
    render(<TrashTable {...props} data={{ ...data, invoices: [{
      ...invoice, matching: { vendor: { vendorCode: "RIVR01", vendorName: "Riverside Glass" } },
    } as Invoice] }} />);
    expect(screen.getByText("RIVR01 — Riverside Glass")).toBeInTheDocument();
    expect(screen.getByText("INV-43109")).toBeInTheDocument();
  });

  it("labels records with no metadata honestly and retains their record identity", () => {
    render(<TrashTable {...props} data={{ ...data, invoices: [{
      ...invoice, file: "", extracted: null, matching: null,
      email: { from: "", subject: "", receivedAt: invoice.email.receivedAt },
    }] }} />);
    expect(screen.getByText("Unidentified sender")).toBeInTheDocument();
    expect(screen.getByText("Document invoice-1")).toBeInTheDocument();
  });

  it.each([
    ["2026-08-14T12:00:00.000Z", "2026-08-12T12:00:00.000Z", "08/14/26"],
    [null, "2026-08-12T12:00:00.000Z", "08/12/26"],
    [null, null, "—"],
  ])("uses delete/discard timestamps, never receivedAt (%s, %s)", (deletedAt, discardedAt, expected) => {
    render(<TrashTable {...props} data={{ ...data, invoices: [{ ...invoice, deletedAt, discardedAt }] }} />);
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[5]).toHaveTextContent(expected);
    expect(cells[5]).not.toHaveTextContent("07/01/26");
  });

  it("renders the prototype-aligned trash columns and existing actions", () => {
    render(<TrashTable {...props} />);

    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(TRASH_HEADERS);
    expect(screen.getAllByText("Discarded")).toHaveLength(2);
    expect(screen.getByText("Riverside Glass")).toBeInTheDocument();
    expect(screen.getByText("INV-43109")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Discarded by Dana Brown")).toBeInTheDocument();
    expect(document.querySelector(".tbx-date")).toHaveTextContent("08/14/26");
    expect(screen.getByRole("button", { name: "Restore or delete" })).toBeInTheDocument();
  });

  it("uses the same approved columns in the loading layout", () => {
    render(<TrashTable {...props} data={undefined} isLoading />);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(TRASH_HEADERS);
  });

  it("renders filtered provenance as concise source detail in the Source column", () => {
    const sourceInvoices = [
      { ...invoice, id: "manual", discardSource: "manual" },
      { ...invoice, id: "legacy", discardSource: null },
      { ...invoice, id: "auto", discardSource: "auto-ai", notes: "email signature image\nprivate second line" },
      { ...invoice, id: "rule", discardSource: "rule-filter", notes: "duplicate page" },
      { ...invoice, id: "junk", discardSource: "junk-hash", notes: "blank page" },
    ] as Invoice[];

    render(<TrashTable {...props} data={{ ...data, invoices: sourceInvoices, total: sourceInvoices.length }} />);

    expect(screen.getAllByText("Manual")).toHaveLength(2);
    expect(screen.getAllByText("Junk filter")).toHaveLength(3);
    expect(screen.getByText("email signature image")).toBeInTheDocument();
    expect(screen.queryByText("private second line")).not.toBeInTheDocument();
  });

  it("keeps source details in the source cell", () => {
    const filterInvoice = {
      ...invoice,
      discardSource: "junk-hash",
      notes: "signature-name-pattern",
    } as Invoice;
    render(<TrashTable {...props} data={{ ...data, invoices: [filterInvoice] }} />);

    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(within(cells[3]).getByText("Junk filter")).toBeInTheDocument();
    expect(within(cells[3]).getByText("signature-name-pattern")).toBeInTheDocument();
    expect(within(cells[1]).queryByText("Junk filter")).not.toBeInTheDocument();
  });
});
