import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InvoiceTable, spectrumDuplicateTitle } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceTable";
import { InvoiceQueueTableSection } from "@/modules/accounting/modules/invoices/components/dashboard/InvoiceQueueTableSection";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { InvoiceListResponse } from "@/modules/accounting/modules/invoices/types/api";
import motionStyles from "@/modules/shared/components/motion/ActionMotion.module.css";
import { expectDomOrder, expectNoPositiveTabIndex } from "../tabOrderAssertions";

// The row's flag glyph (FlagToggleGlyph) uses the flag/unflag mutations, the
// permission gate, and the toaster. Neutralize those so the table renders
// without a QueryClient/permission provider; the glyph's state logic (flagged
// iff flaggedAt) is exercised here and fully in FlagToggleGlyph.test.tsx.
vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useFlagDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useUnflagDocument: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/shared/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  DEFAULT_MAPPINGS: [
    { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
    { name: "pay-application", label: "Pay Application", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
    { name: "purchase-order", label: "Purchase Order", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
    { name: "credit-memo", label: "Credit Memo", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
  ],
  useClassifications: () => ({
    classifications: [{ name: "invoice", label: "Invoice", status: "active" }],
    isError: false,
    isLoading: false,
  }),
}));

function makeInvoice(id: string, overrides: Partial<Invoice> = {}): Invoice {
  return {
    id,
    classification: "invoice",
    confidence: 0.9,
    overallConfidence: 0.9,
    file: `${id}.pdf`,
    email: { from: "vendor@example.com", subject: "Invoice", receivedAt: "2026-01-01T00:00:00Z" },
    status: "approved",
    queuedAt: "2026-01-01T00:00:00Z",
    extracted: {
      vendorName: `Vendor ${id}`,
      vendorAddress: null,
      invoiceNumber: id,
      invoiceDate: null,
      dueDate: null,
      amount: 100,
      jobNumber: "25-401",
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: null,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    lienWaiverRequired: true,
    ...overrides,
  };
}

function makePage(invoice: Invoice, page: number): InvoiceListResponse {
  return {
    invoices: [invoice],
    total: 2,
    page,
    limit: 1,
    pages: 2,
  };
}

function getRowForText(text: string): HTMLElement {
  const row = screen.getByText(text).closest("tr");
  if (!row) throw new Error(`Could not find table row for ${text}`);
  return row;
}

function TableHarness() {
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const data = page === 1
    ? makePage(makeInvoice("inv-1"), 1)
    : makePage(makeInvoice("inv-2"), 2);

  return (
    <>
      <button type="button" onClick={() => setPage(1)}>Page 1</button>
      <button type="button" onClick={() => setPage(2)}>Page 2</button>
      <div data-testid="selected-ids">{selectedIds.join(",")}</div>
      <InvoiceTable
        data={data}
        isLoading={false}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />
    </>
  );
}

describe("InvoiceTable controlled selection", () => {
  describe("queue table tab order", () => {
    it("keeps every enabled queue control in DOM order", () => {
      const { container } = render(
        <InvoiceQueueTableSection
          data={makePage(makeInvoice("queue-1"), 1)} error={false}
          filters={{ page: 1, limit: 1, search: "", status: "all" }}
          isLoading={false} selectedIds={[]} columnVisibility={{}} columnOrder={[]}
          onColumnOrderChange={vi.fn()} onColumnVisibilityChange={vi.fn()} onLimitChange={vi.fn()}
          onPageChange={vi.fn()} onRetry={vi.fn()} onRowClick={vi.fn()} onSelectionChange={vi.fn()} onSortChange={vi.fn()}
        />,
      );
      const order = [
        screen.getByRole("checkbox", { name: "Select all" }),
        screen.getByRole("button", { name: "Vendor / Invoice" }),
        screen.getByRole("button", { name: "Type" }),
        screen.getByRole("button", { name: "Amount" }),
        screen.getByRole("button", { name: "Received" }),
        screen.getByRole("checkbox", { name: "Select row" }),
        screen.getByRole("button", { name: "Flag for review" }),
        screen.getByRole("combobox"),
        screen.getByRole("button", { name: "Next page" }),
      ];
      expectDomOrder(order);
      expectNoPositiveTabIndex(container);
    });
  });

  it("shows the select all shortcut hint on the visible header control", () => {
    render(<TableHarness />);
    expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveAttribute("title", expect.stringContaining("Select all visible rows •"));
  });

  it("renders real shaped rows until the first queue response, then marks arriving rows", () => {
    const section = (data: InvoiceListResponse | undefined) => (
      <InvoiceQueueTableSection
        data={data}
        error={false}
        filters={{ page: 1, limit: 25, search: "", status: "all" }}
        isLoading={false}
        selectedIds={[]}
        columnVisibility={{}}
        columnOrder={[]}
        onColumnOrderChange={vi.fn()}
        onColumnVisibilityChange={vi.fn()}
        onLimitChange={vi.fn()}
        onPageChange={vi.fn()}
        onRetry={vi.fn()}
        onRowClick={vi.fn()}
        onSelectionChange={vi.fn()}
        onSortChange={vi.fn()}
      />
    );

    const { container, rerender } = render(section(undefined));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(container.querySelectorAll('tbody [data-slot="skeleton"]')).not.toHaveLength(0);
    expect(screen.queryByText("No invoices found")).not.toBeInTheDocument();
    expect(screen.queryByText("0-0 of 0")).not.toBeInTheDocument();

    rerender(section({ ...makePage(makeInvoice("ready"), 1), total: 1, pages: 1 }));
    expect(getRowForText("Vendor ready")).toHaveAttribute("data-arriving", "true");
    expect(screen.getByText("1-1 of 1")).toBeInTheDocument();
  });

  it("shapes loading cells to the visible queue columns", () => {
    const { container } = render(<InvoiceTable data={undefined} isLoading columnVisibility={{ emailFrom: false }} />);
    const cells = container.querySelectorAll("tbody tr:first-child td");
    expect(cells).toHaveLength(10);
    expect(cells[0].querySelector('[data-slot="skeleton"]')).toHaveClass("w-4");
    expect(cells[1].querySelector('[data-slot="skeleton"]')).toHaveClass("rounded-full");
    expect(cells[2].querySelector('[data-slot="skeleton"]')).toHaveClass("rounded-full");
    expect(cells[3].querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    expect(cells[4].querySelector('[data-slot="skeleton"]')).toHaveClass("w-16");
    expect(cells[8].querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    expect(cells[8].querySelectorAll('[data-slot="skeleton"]')[0]).toHaveClass("w-16");
    expect(cells[8].querySelectorAll('[data-slot="skeleton"]')[1]).toHaveClass("w-4");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
  });

  it.each([25, 50, 100])("animates all %i rows on the first ready paint with a dynamic timeout", (count) => {
    vi.useFakeTimers();
    const arrivalTimeout = Math.max(count - 1, 0) * 30 + 150 + 50;
    try {
      const data: InvoiceListResponse = {
        invoices: Array.from({ length: count }, (_, index) => makeInvoice(`row-${index}`)),
        total: count,
        page: 1,
        limit: count,
        pages: 1,
      };
      const { container, rerender } = render(<InvoiceTable data={undefined} isLoading />);
      rerender(<InvoiceTable data={data} isLoading={false} />);
      const rows = container.querySelectorAll("tbody tr");
      expect(rows).toHaveLength(count);
      for (let index = 0; index < count; index += 1) {
        expect(rows[index]).toHaveAttribute("data-arriving", "true");
        expect(rows[index]).toHaveAttribute("data-row-order", String(index));
      }
      act(() => vi.advanceTimersByTime(arrivalTimeout - 1));
      expect(rows[count - 1]).toHaveAttribute("data-arriving", "true");
      act(() => vi.advanceTimersByTime(1));
      expect(rows[count - 1]).not.toHaveAttribute("data-arriving");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not give replacement rows the active first-load motion", () => {
    const { rerender } = render(<InvoiceTable data={undefined} isLoading />);
    rerender(<InvoiceTable data={makePage(makeInvoice("first"), 1)} isLoading={false} />);
    expect(getRowForText("Vendor first")).toHaveAttribute("data-arriving", "true");
    rerender(<InvoiceTable data={makePage(makeInvoice("replacement"), 1)} isLoading={false} />);
    expect(getRowForText("Vendor replacement")).not.toHaveAttribute("data-arriving");
    expect(getRowForText("Vendor replacement")).not.toHaveAttribute("style");
  });

  it("marks only the first loaded rows and never re-arms for list changes or refetch", () => {
    vi.useFakeTimers();
    try {
      const firstPage = { ...makePage(makeInvoice("first"), 1), invoices: [makeInvoice("first"), makeInvoice("second")] };
      const { rerender } = render(<InvoiceTable data={undefined} isLoading />);
      rerender(<InvoiceTable data={firstPage} isLoading={false} />);
      expect(getRowForText("Vendor first")).toHaveAttribute("data-arriving", "true");
      expect(getRowForText("Vendor first")).toHaveAttribute("data-row-order", "0");
      expect(getRowForText("Vendor second")).toHaveAttribute("data-row-order", "1");
      act(() => vi.advanceTimersByTime(520));
      expect(getRowForText("Vendor first")).not.toHaveAttribute("data-arriving");

      rerender(<InvoiceTable data={makePage(makeInvoice("page-two"), 2)} isLoading={false} sortField="vendor" sortDir="asc" />);
      expect(getRowForText("Vendor page-two")).not.toHaveAttribute("data-arriving");
      rerender(<InvoiceTable data={makePage(makeInvoice("page-two"), 2)} isLoading={false} globalSearch selectedIds={["page-two"]} columnVisibility={{ emailFrom: false }} />);
      expect(getRowForText("Vendor page-two")).not.toHaveAttribute("data-arriving");
      rerender(<InvoiceTable data={undefined} isLoading />);
      rerender(<InvoiceTable data={makePage(makeInvoice("refetched"), 2)} isLoading={false} />);
      expect(getRowForText("Vendor refetched")).not.toHaveAttribute("data-arriving");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps queue selection instant while giving row hover its local timing", () => {
    render(<InvoiceTable data={makePage(makeInvoice("inv-1"), 1)} isLoading={false} />);

    const row = getRowForText("Vendor inv-1");
    expect(row).toHaveClass(motionStyles.queueRow);
    expect(within(row).getByRole("checkbox", { name: "Select row" })).toHaveClass(motionStyles.queueCheckbox);
  });

  it("renders the redesigned primary column order", () => {
    render(
      <InvoiceTable
        data={makePage(makeInvoice("inv-1"), 1)}
        isLoading={false}
        columnVisibility={{ emailFrom: false, emailSubject: false }}
      />,
    );

    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent?.replace(/\s+/g, " ").trim());

    expect(headers).toEqual([
      "",
      "",
      "Status",
      "Vendor / Invoice",
      "Job",
      "Type",
      "Waiver",
      "Amount",
      "Received",
    ]);
  });

  it("shows a pressed flag glyph from a list row's flaggedAt (the runtime data unblocked by the list serializer)", () => {
    render(
      <InvoiceTable
        data={makePage(
          makeInvoice("flagged-1", {
            flaggedAt: "2026-07-18T12:00:00.000Z",
            flagReason: "Possible duplicate",
            flaggedBy: "reviewer@example.com",
            flagged: false, // legacy boolean deliberately the OPPOSITE of the review flag
          }),
          1,
        )}
        isLoading={false}
      />,
    );

    const row = getRowForText("Vendor flagged-1");
    expect(within(row).getByRole("button", { name: "Remove review flag" })).toHaveAttribute("aria-pressed", "true");
    expect(row).toHaveClass("is-flagrow");
    // The prototype-aligned stripe is stylesheet-owned, not an inline hardcoded
    // color, and the review glyph remains an outline pennant.
    expect(row).not.toHaveAttribute("style");
    expect(within(row).getByRole("button", { name: "Remove review flag" }).querySelector("svg")).not.toHaveClass("fill-current");
    expect(within(row).getByRole("button", { name: "Remove review flag" })).toHaveAttribute(
      "title",
      "Possible duplicate — reviewer@example.com",
    );
  });

  it("shows an unpressed flag glyph when flaggedAt is null even if the legacy flagged boolean is true", () => {
    render(
      <InvoiceTable
        data={makePage(makeInvoice("plain-1", { flaggedAt: null, flagged: true }), 1)}
        isLoading={false}
      />,
    );

    const row = getRowForText("Vendor plain-1");
    const glyph = within(row).getByRole("button", { name: "Flag for review" });
    expect(glyph).toHaveAttribute("aria-pressed", "false");
    expect(within(row).queryByRole("button", { name: "Remove review flag" })).not.toBeInTheDocument();
  });

  it("labels global Trash rows, prevents active mutations, and identifies the Trash-safe route", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <InvoiceTable
        data={makePage(makeInvoice("trashed-1", { isTrash: true, deletedAt: "2026-08-01T00:00:00.000Z" }), 1)}
        isLoading={false}
        globalSearch
        onRowClick={onRowClick}
      />,
    );

    const row = getRowForText("Vendor trashed-1");
    expect(within(row).getByText("In Trash")).toBeInTheDocument();
    expect(within(row).getByLabelText("Select row")).toBeDisabled();
    expect(within(row).queryByRole("button", { name: /flag for review|remove review flag/i })).not.toBeInTheDocument();

    await user.click(row);
    expect(onRowClick).toHaveBeenCalledWith("trashed-1", "approved", true);
  });

  it("renders the canonical waiver status even when legacy fields conflict", () => {
    render(
      <InvoiceTable
        data={makePage(makeInvoice("inv-1", {
          waiverStatus: "attached",
          lienWaiverRequired: true,
          lienWaiverStatus: "missing",
        }), 1)}
        isLoading={false}
        columnVisibility={{ emailFrom: false, emailSubject: false }}
      />,
    );

    const cells = screen.getAllByRole("cell");
    expect(within(cells[3]).getByText("Vendor inv-1")).toHaveClass("truncate");
    expect(within(cells[3]).getByText("inv-1")).toHaveClass("truncate");
    expect(within(cells[2]).getByText("Approved")).toBeInTheDocument();
    expect(within(cells[2]).queryByText("Required")).not.toBeInTheDocument();
    expect(within(cells[6]).getByText("Attached")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Confidence" })).not.toBeInTheDocument();
    expect(screen.queryByRole("meter", { name: /confidence/i })).not.toBeInTheDocument();
  });

  it("links a pending possible duplicate directly to its original without opening the copy row", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <InvoiceTable
        data={makePage(makeInvoice("copy-2", { status: "pending", duplicateOf: "original-discarded" }), 1)}
        isLoading={false}
        onRowClick={onRowClick}
      />,
    );

    const link = screen.getByRole("link", { name: "Possible duplicate — open the original" });
    expect(link).toHaveAttribute("href", "/accounting/invoices/original-discarded");
    expect(link).toHaveAttribute("title", "Possible duplicate — open the original");
    expect(link.querySelector("svg")).toHaveClass("lucide-copy");
    expect(screen.queryByText("Possible duplicate")).not.toBeInTheDocument();

    await user.click(link);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("shows the duplicate glyph for an invoice that already exists in Spectrum (no Toolbox original)", () => {
    render(
      <InvoiceTable
        data={makePage(makeInvoice("geor-7310", { status: "pending", duplicateOf: null, spectrumDuplicate: { source: "PAYMENT_HIST", amount: 1500 } }), 1)}
        isLoading={false}
      />,
    );

    const glyph = screen.getByRole("img", { name: "Possible duplicate: Already in Spectrum (paid, $1,500.00)" });
    expect(glyph).toHaveAttribute("title", "Already in Spectrum (paid, $1,500.00)");
    expect(glyph.querySelector("svg")).toHaveClass("lucide-copy");
    expect(screen.queryByRole("link", { name: "Possible duplicate — open the original" })).not.toBeInTheDocument();
  });

  it("prefers the Toolbox original link when an invoice is both a Toolbox and a Spectrum duplicate", () => {
    render(
      <InvoiceTable
        data={makePage(makeInvoice("copy-3", { status: "pending", duplicateOf: "orig-3", spectrumDuplicate: { source: "OPEN_ITEMS", amount: 10 } }), 1)}
        isLoading={false}
      />,
    );

    expect(screen.getByRole("link", { name: "Possible duplicate — open the original" })).toHaveAttribute("href", "/accounting/invoices/orig-3");
    expect(screen.queryByTestId("spectrum-duplicate-glyph")).not.toBeInTheDocument();
  });

  it("colors both duplicate glyphs through the glyph tokens, with a static non-link Spectrum glyph", () => {
    render(
      <InvoiceTable
        data={{
          ...makePage(makeInvoice("copy-4", { status: "pending", duplicateOf: "orig-4" }), 1),
          invoices: [
            makeInvoice("copy-4", { status: "pending", duplicateOf: "orig-4" }),
            makeInvoice("geor-1", { status: "pending", duplicateOf: null, spectrumDuplicate: { source: "PAYMENT_HIST", amount: 1500 } }),
          ],
        }}
        isLoading={false}
      />,
    );

    const link = screen.getByRole("link", { name: "Possible duplicate — open the original" });
    expect(link).toHaveClass("text-[var(--rc-blocking-glyph)]", "hover:text-[var(--rc-blocking-glyph-hover)]");
    const glyph = screen.getByTestId("spectrum-duplicate-glyph");
    expect(glyph).toHaveClass("text-[var(--rc-blocking-glyph)]", "cursor-default");
    expect(glyph.className).not.toContain("hover:");
    expect(glyph.tagName).toBe("SPAN");
    expect(glyph.closest("a")).toBeNull();
    expect(`${link.className} ${glyph.className}`).not.toContain("amber");
  });

  it("keeps palette amber classes off the duplicate glyph source lines", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/modules/accounting/modules/invoices/components/invoices/InvoiceTable.tsx"),
      "utf8",
    );
    const glyphLines = source.split("\n").filter((line) => /<Copy\b|spectrum-duplicate-glyph|rc-blocking-glyph|open the original/.test(line));
    expect(glyphLines.length).toBeGreaterThanOrEqual(5);
    expect(glyphLines.filter((line) => /amber-/.test(line))).toEqual([]);
  });

  it("shows no duplicate glyph when the invoice is not in Spectrum and has no Toolbox original", () => {
    render(
      <InvoiceTable
        data={makePage(makeInvoice("clean-1", { status: "pending", duplicateOf: null, spectrumDuplicate: null }), 1)}
        isLoading={false}
      />,
    );

    expect(screen.queryByTestId("spectrum-duplicate-glyph")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Possible duplicate — open the original" })).not.toBeInTheDocument();
  });

  it("does not show a possible-duplicate advisory for a non-pending row", () => {
    render(
      <InvoiceTable
        data={makePage(makeInvoice("copy-2", { status: "approved", duplicateOf: "original" }), 1)}
        isLoading={false}
      />,
    );

    expect(screen.queryByRole("link", { name: "Possible duplicate — open the original" })).not.toBeInTheDocument();
  });

  it("prefers the matching vendor name and never displays its code", () => {
    const matched = makeInvoice("matched", {
      extracted: { ...makeInvoice("matched").extracted!, vendorName: "Extracted fallback" },
      matching: { vendor: { vendorCode: "V100", vendorName: "Canonical Vendor", confidence: 1, method: "exact" }, job: null, subcontract: null, sourceInvoiceTotal: null },
    });
    const nameOnly = makeInvoice("name-only", {
      extracted: { ...makeInvoice("name-only").extracted!, vendorName: "Do not render" },
      matching: { vendor: { vendorCode: null, vendorName: "Suggested Vendor", confidence: 0.8, method: "fuzzy" }, job: null, subcontract: null, sourceInvoiceTotal: null },
    });
    render(<InvoiceTable data={{ invoices: [matched, nameOnly], total: 2, page: 1, limit: 25, pages: 1 }} isLoading={false} />);

    expect(screen.getByText("Canonical Vendor")).toBeInTheDocument();
    expect(screen.getByText("Suggested Vendor")).toBeInTheDocument();
    expect(screen.queryByText(/V100/)).not.toBeInTheDocument();
    expect(screen.queryByText("Extracted fallback")).not.toBeInTheDocument();
    expect(screen.queryByText("Do not render")).not.toBeInTheDocument();
  });

  it("does not mute classifications that use the invoice workflow", () => {
    const data: InvoiceListResponse = {
      invoices: [
        makeInvoice("pay-app", { classification: "pay-application" }),
        makeInvoice("po", { classification: "purchase-order" }),
        makeInvoice("credit", { classification: "credit-memo" }),
        makeInvoice("receipt", { classification: "receipt" }),
      ],
      total: 4,
      page: 1,
      limit: 25,
      pages: 1,
    };

    render(
      <InvoiceTable
        data={data}
        isLoading={false}
        columnVisibility={{ emailFrom: false, emailSubject: false }}
      />,
    );

    expect(getRowForText("Vendor pay-app")).not.toHaveClass("text-muted-foreground");
    expect(getRowForText("Vendor po")).not.toHaveClass("text-muted-foreground");
    expect(getRowForText("Vendor credit")).not.toHaveClass("text-muted-foreground");
    expect(getRowForText("Vendor receipt")).toHaveClass("text-muted-foreground");
  });

  it("preserves selected invoice IDs across visible page changes", async () => {
    const user = userEvent.setup();

    render(<TableHarness />);

    await user.click(screen.getByLabelText("Select row"));
    expect(screen.getByTestId("selected-ids")).toHaveTextContent("inv-1");

    await user.click(screen.getByRole("button", { name: "Page 2" }));
    await user.click(screen.getByLabelText("Select row"));
    expect(screen.getByTestId("selected-ids")).toHaveTextContent("inv-1,inv-2");

    await user.click(screen.getByRole("button", { name: "Page 1" }));
    expect(screen.getByLabelText("Select row")).toBeChecked();
  });
});

describe("spectrumDuplicateTitle", () => {
  it.each([
    [{ source: "OPEN_ITEMS", amount: 10 }, "Already in Spectrum (unpaid (open items), $10.00)"],
    [{ source: "APPROVAL", amount: 2500 }, "Already in Spectrum (awaiting approval, $2,500.00)"],
    [{ source: "PAYMENT_HIST", amount: 1500 }, "Already in Spectrum (paid, $1,500.00)"],
    [{ source: "APPROVAL", amount: null }, "Already in Spectrum (awaiting approval)"],
    [{ source: "SOMETHING_NEW", amount: 5 }, "Already in Spectrum (submitted from Toolbox, $5.00)"],
  ])("builds the tooltip for %j", (hit, expected) => {
    expect(spectrumDuplicateTitle(hit)).toBe(expected);
  });

  it("returns null when there is no Spectrum hit", () => {
    expect(spectrumDuplicateTitle(null)).toBeNull();
  });

  it("uses the shared source label map instead of a local one", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/modules/accounting/modules/invoices/components/invoices/InvoiceTable.tsx"),
      "utf8",
    );
    // Name is split so a repo-wide grep for the removed constant stays empty.
    expect(source).not.toMatch(new RegExp("SPECTRUM_SOURCE" + "_LABEL"));
  });
});
