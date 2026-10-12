import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentPanel } from "@/modules/accounting/modules/invoices/components/documents/DocumentPanel";
import { createStatementDocumentSpec } from "@/modules/accounting/modules/invoices/components/documents/statementDocumentSpec";
import type { AddStatementLinePayload } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice, StatementLine } from "@/modules/accounting/modules/invoices/types/invoice";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/modules/shared/components/ui/toaster", () => ({
  toast: toastMock,
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown", () => ({
  VendorDropdown: ({
    value,
    vendorName,
    onChange,
  }: {
    value: string | null;
    vendorName?: string | null;
    onChange: (value: string | null) => void;
  }) => (
    <button type="button" onClick={() => onChange("V200")}>
      Vendor {value ?? "none"} {vendorName ?? ""}
    </button>
  ),
}));

const statementLines: StatementLine[] = [
  { id: "line-1", invoiceNumber: "INV-100", date: "2026-06-01", amount: 100, status: "matched", clear: true, source: "extracted" },
  { id: "line-2", invoiceNumber: "INV-101", date: "2026-06-08", amount: 200, status: "in_toolbox_not_spectrum", clear: true, source: "extracted" },
  { id: "line-3", invoiceNumber: "INV-102", date: "2026-06-15", amount: 300, status: "not_received", clear: false, source: "extracted" },
  { id: "line-4", invoiceNumber: "INV-103", date: "2026-06-22", amount: 400, status: "amount_differs", clear: false, source: "extracted" },
];

function makeReconcileState(lines: readonly StatementLine[]) {
  const clear = lines.filter((line) => line.clear).length;
  const blockers = lines
    .filter((line) => !line.clear)
    .map((line) => ({
      code: "STATEMENT_LINE_UNRESOLVED",
      lineId: line.id,
      message: `${line.invoiceNumber} must be resolved before reconciliation.`,
    }));
  return {
    blockers,
    counts: { total: lines.length, clear, unresolved: lines.length - clear },
    canReconcile: blockers.length === 0,
    permittedActions: blockers.length === 0 ? ["reconcile" as const] : [],
  };
}

function makeStatement(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "statement-200",
    classification: "statement",
    confidence: 0.81,
    file: "statement-200.pdf",
    email: {
      from: "email-sender-vendor@example.com",
      subject: "June statement",
      receivedAt: "2026-06-15T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-15T12:00:00.000Z",
    extracted: {
      vendorName: null,
      vendor: "Document Vendor",
      vendorAddress: null,
      invoiceNumber: "ST-200",
      invoiceDate: "2026-06-10T12:00:00.000Z",
      dueDate: null,
      amount: 1000,
      balance: 1000,
      statementPeriod: "June 2026",
      statementLines,
      jobNumber: null,
      projectName: null,
      description: null,
      lineItems: [],
    },
    statementLines,
    matching: {
      vendor: { vendorCode: "V100", vendorName: "Matched Vendor", confidence: 0.92, method: "document" },
      job: null,
      subcontract: null,
      sourceInvoiceTotal: null,
    },
    overallConfidence: 0.81,
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    reconcile: makeReconcileState(statementLines),
    statementAttributes: {
      statementPeriod: { value: "June 2026", source: "extracted" },
      balance: { value: 1000, source: "computed" },
    },
    ...overrides,
  };
}

function getVendorPicker() {
  const picker = screen.getAllByRole("button")
    .find((button) => button.textContent?.trim().startsWith("Vendor"));
  expect(picker).toBeDefined();
  return picker!;
}

function makeStatementWithLines(lines: StatementLine[], overrides: Partial<Invoice> = {}): Invoice {
  const base = makeStatement(overrides);
  return {
    ...base,
    statementLines: lines,
    extracted: base.extracted ? { ...base.extracted, statementLines: lines } : base.extracted,
    reconcile: overrides.reconcile ?? makeReconcileState(lines),
  };
}

function CachedStatementPanel({
  initialRecord,
  onReconcile,
}: {
  initialRecord: Invoice;
  onReconcile: (record: Invoice) => Promise<{ invoice: Invoice }> | { invoice: Invoice };
}) {
  const [record, setRecord] = useState(initialRecord);
  return (
    <DocumentPanel
      record={record}
      spec={createStatementDocumentSpec({
        onFileDocument: vi.fn(),
        onReconcile: async (current) => {
          const response = await onReconcile(current);
          setRecord(response.invoice);
          return response;
        },
      })}
    />
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("createStatementDocumentSpec", () => {
  it("does not expose a SharePoint filename field even when the server permits editing", () => {
    const record = makeStatement();
    record.filing = { ...record.filing, fileName: { value: "Canonical.pdf", provenance: "computed", permittedActions: ["edit"], blockers: [] } };
    render(<DocumentPanel record={record} spec={createStatementDocumentSpec()} />);
    expect(screen.queryByRole("textbox", { name: "File name" })).not.toBeInTheDocument();
  });

  beforeEach(() => {
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it("announces each served unresolved statement line exactly once", () => {
    const spec = createStatementDocumentSpec({ onResolveStatementLine: vi.fn() });
    const statement = makeStatement();
    const form = spec.initForm(statement);
    const output = spec.build({ record: statement, form, setForm: () => undefined, patchForm: () => undefined });
    const lineAlerts = output.alerts?.filter((alert) => alert.id.startsWith("statement-reconcile-")) ?? [];

    expect(lineAlerts.map((alert) => alert.id)).toEqual([
      "statement-reconcile-line-3",
      "statement-reconcile-line-4",
    ]);
    expect(new Set(lineAlerts.map((alert) => alert.id)).size).toBe(2);
    expect(lineAlerts.map((alert) => alert.action?.label)).toEqual(["Add to AP", "Accept AP"]);
  });

  it("renders the server-resolved statement vendor when extracted, matching, and email values conflict", () => {
    const statement = makeStatement({
      filing: {
        fileName: { value: "STMT canonical.pdf", provenance: "computed", permittedActions: [], blockers: [] },
        vendor: { value: "Canonical statement vendor", provenance: "manual", permittedActions: [], blockers: [] },
      },
    });
    render(<DocumentPanel record={statement} spec={createStatementDocumentSpec()} />);
    expect(screen.getByText(/Canonical statement vendor/)).toBeInTheDocument();
    expect(screen.queryByText("Edit statement details")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Statement period")).toHaveValue("June 2026");
    expect(screen.getByLabelText("Statement balance")).toHaveValue("1000.00");
  });

  it("renders document-match fields, line actions, add-line flow, and reconciles manually once clear", async () => {
    const user = userEvent.setup();
    let resolvedLines = [...statementLines];
    const onResolveStatementLine = vi.fn().mockImplementation((_record: Invoice, lineId: string, payload: { resolutionType: "accept_line" | "use_ap_amount" }) => {
      resolvedLines = resolvedLines.map((line) => line.id === lineId ? {
        ...line,
        clear: true,
        resolvedAt: "2026-07-15T12:00:00.000Z",
        resolutionType: payload.resolutionType,
        resolvedBy: "Tester",
      } : line);
      const updatedLine = resolvedLines.find((line) => line.id === lineId)!;
      return { invoice: makeStatementWithLines(resolvedLines), statementLines: resolvedLines, updatedLine };
    });
    const onReconcile = vi.fn().mockImplementation(() => ({
      invoice: makeStatementWithLines(resolvedLines, { reconciled: true, filed: true }),
    }));
    const onFileDocument = vi.fn().mockResolvedValue(undefined);
    const onUpdateDocument = vi.fn().mockImplementation((_record: Invoice, payload: { vendorCode?: string }) => {
      const canonical = makeStatement();
      return payload.vendorCode
        ? {
            ...canonical,
            matching: {
              ...canonical.matching,
              vendor: { ...canonical.matching!.vendor!, vendorCode: payload.vendorCode },
            },
            statusChanges: [],
          }
        : canonical;
    });
    const onUpdateStatementAttributes = vi.fn().mockImplementation((_record: Invoice, payload: { balance?: number | null }) => ({
      invoice: makeStatement({
        statementAttributes: {
          statementPeriod: { value: "July 2026", source: "manual" },
          balance: { value: payload.balance ?? 1000, source: "manual" },
        },
      }),
    }));
    const onAddStatementLine = vi.fn().mockImplementation((_record: Invoice, payload: AddStatementLinePayload) => ({
      statementLines: [
        ...statementLines,
        {
          id: "manual-1",
          invoiceNumber: payload.invoiceNumber,
          date: payload.date,
          amount: Number(payload.amount),
          status: "matched",
          source: "manual",
        },
      ],
      addedLine: {
        id: "manual-1",
        invoiceNumber: payload.invoiceNumber,
        date: payload.date,
        amount: Number(payload.amount),
        status: "matched",
        source: "manual",
      },
      invoice: makeStatement(),
    }));

    function Harness() {
      const [record, setRecord] = useState(makeStatement());
      return <DocumentPanel record={record} spec={createStatementDocumentSpec({
        onFileDocument,
        onReconcile: async (current) => {
          const response = onReconcile(current);
          setRecord(response.invoice);
          return response;
        },
        onAddStatementLine,
        onResolveStatementLine,
        onUpdateDocument,
        onUpdateStatementAttributes,
        canEditStatementAttributes: true,
      })} />;
    }

    render(<Harness />);

    expect(screen.getByText("Account Summary")).toBeInTheDocument();
    expect(screen.getByText("Statement Lines")).toBeInTheDocument();
    expect(screen.queryByText("Selected vendor code: V100")).not.toBeInTheDocument();
    expect(screen.queryByText("Document vendor: Document Vendor")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("June 2026")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1000.00")).toBeInTheDocument();
    expect(screen.getByText("Located")).toBeInTheDocument();
    expect(screen.getByText("2/4")).toBeInTheDocument();
    expect(screen.getByText("Toolbox")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add to AP" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Accept AP" })).toHaveLength(1);
    expect(screen.getByText("Not yet tied out")).toBeInTheDocument();

    await user.click(getVendorPicker());
    await waitFor(() => {
      expect(onUpdateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: "statement-200" }),
        { vendorCode: "V200" },
      );
    });
    fireEvent.change(screen.getByDisplayValue("June 2026"), { target: { value: "July 2026" } });
    fireEvent.change(screen.getByDisplayValue("1000.00"), { target: { value: "1200.50" } });
    fireEvent.blur(screen.getByDisplayValue("1200.50"));
    expect(screen.getByDisplayValue("July 2026")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1200.50")).toBeInTheDocument();
    await waitFor(() => {
      expect(onUpdateStatementAttributes).toHaveBeenCalledWith(
        expect.objectContaining({ id: "statement-200" }),
        { balance: 1200.5 },
      );
    });

    await user.click(screen.getByRole("button", { name: "Add Line" }));
    expect(screen.getByText("Invoice number is required.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Invoice number"), { target: { value: "INV-200" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-06-30" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "125.50" } });
    await user.click(screen.getByRole("button", { name: "Add Line" }));
    expect(onAddStatementLine).toHaveBeenCalledWith(
      expect.objectContaining({ id: "statement-200" }),
      { invoiceNumber: "INV-200", date: "2026-06-30", amount: 125.5 },
    );
    expect(await screen.findByText("INV-200")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Shelve" })).toBeEnabled();
    await user.click(screen.getAllByRole("button", { name: "Add to AP" })[0]);
    expect(onReconcile).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: "Accept AP" })[0]);

    expect(onReconcile).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reconcile Invoices" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Reconcile Invoices" }));

    await waitFor(() => {
      expect(onReconcile).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Reconciled" })).toBeDisabled());
  });

  it("uses Shelve as the primary CTA for queued statements that are not fully reconciled", async () => {
    const user = userEvent.setup();
    const onFileDocument = vi.fn().mockResolvedValue(undefined);

    render(
      <DocumentPanel
        record={makeStatement()}
        spec={createStatementDocumentSpec({ onFileDocument, onReconcile: vi.fn() })}
      />,
    );

    const shelveButton = screen.getByRole("button", { name: "Shelve" });
    expect(shelveButton).toBeEnabled();

    await user.click(shelveButton);

    await waitFor(() => {
      expect(onFileDocument).toHaveBeenCalledWith(expect.objectContaining({ id: "statement-200" }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Reconcile Invoices" })).toBeDisabled());
  });

  it("uses Reconcile Invoices as the primary CTA for queued statements once all lines are clear", async () => {
    const user = userEvent.setup();
    const onReconcile = vi.fn().mockResolvedValue(undefined);
    const clearLines: StatementLine[] = statementLines.map((line) => ({ ...line, status: "matched" as const, clear: true }));

    render(
      <DocumentPanel
        record={makeStatementWithLines(clearLines)}
        spec={createStatementDocumentSpec({ onFileDocument: vi.fn(), onReconcile })}
      />,
    );

    const reconcileButton = screen.getByRole("button", { name: "Reconcile Invoices" });
    expect(reconcileButton).toBeEnabled();

    await user.click(reconcileButton);

    await waitFor(() => {
      expect(onReconcile).toHaveBeenCalledWith(expect.objectContaining({ id: "statement-200" }));
    });
  });

  it("uses the server-permitted action instead of locally deriving statement readiness", async () => {
    const user = userEvent.setup();
    const serverClearedLines: StatementLine[] = statementLines.map((line) => ({
      ...line,
      clear: true,
    }));

    render(
      <DocumentPanel
        record={makeStatementWithLines(serverClearedLines, {
          reconcile: {
            blockers: [],
            counts: { total: 4, clear: 4, unresolved: 0 },
            canReconcile: true,
            permittedActions: ["reconcile"],
          },
        })}
        spec={createStatementDocumentSpec({ onFileDocument: vi.fn(), onReconcile: vi.fn() })}
      />,
    );

    expect(screen.getByRole("button", { name: "Reconcile Invoices" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menuitem", { name: "Reconcile Invoices" })).not.toHaveAttribute("data-disabled");
  });

  it("blocks reconciliation when a successful reconcile response omits canonical state", async () => {
    const user = userEvent.setup();
    const clearLines = statementLines.map((line) => ({ ...line, clear: true }));
    render(<CachedStatementPanel
      initialRecord={makeStatementWithLines(clearLines)}
      onReconcile={vi.fn().mockResolvedValue({ invoice: { ...makeStatementWithLines(clearLines), reconcile: undefined } })}
    />);
    await user.click(screen.getByRole("button", { name: "Reconcile Invoices" }));
    expect(await screen.findByText("Statement line unresolved — Reconciliation status is unavailable. Refresh this statement before reconciling.")).toBeInTheDocument();
  });

  it("fails closed when a successful reconcile response omits its invoice envelope", async () => {
    const user = userEvent.setup();
    const clearLines = statementLines.map((line) => ({ ...line, clear: true }));
    render(
      <DocumentPanel
        record={makeStatementWithLines(clearLines)}
        spec={createStatementDocumentSpec({ onFileDocument: vi.fn(), onReconcile: vi.fn().mockResolvedValue({}) })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reconcile Invoices" }));

    expect(await screen.findByText("Reconciliation failed — Reconcile endpoint returned no statement.")).toBeInTheDocument();
    // Blockers keep their navigation and never become dismissible [fix-2].
    expect(screen.getByRole("button", { name: "Review details" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconcile Invoices" })).toBeEnabled();
  });

  it.each([403, 409])("keeps statement form values and renders the canonical %i reconciliation error", async (status) => {
    const user = userEvent.setup();
    const clearLines = statementLines.map((line) => ({ ...line, clear: true }));
    const error = { status, message: `Canonical reconciliation ${status} message` };
    const onReconcile = vi.fn().mockRejectedValue(error);
    render(
      <DocumentPanel
        record={makeStatementWithLines(clearLines)}
        spec={createStatementDocumentSpec({ onFileDocument: vi.fn(), onReconcile })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reconcile Invoices" }));

    expect(await screen.findByText(`Reconciliation failed — ${error.message}`)).toBeInTheDocument();
    expect(screen.getByDisplayValue("June 2026")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1000.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconcile Invoices" })).toBeEnabled();
    expect(onReconcile).toHaveBeenCalledTimes(1);
  });

  it("blocks reconciliation when a successful statement-line mutation omits canonical state", async () => {
    const user = userEvent.setup();
    const clearLines = statementLines.map((line) => ({ ...line, clear: true }));
    const onRematchStatementLines = vi.fn().mockResolvedValue({
      invoice: { ...makeStatementWithLines(clearLines), reconcile: undefined },
      statementLines: clearLines,
      statusChanges: [],
    });

    render(
      <DocumentPanel
        record={makeStatementWithLines(clearLines)}
        spec={createStatementDocumentSpec({
          onAddStatementLine: vi.fn(),
          onReconcile: vi.fn(),
          onRematchStatementLines,
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Reconcile Invoices" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Re-check Lines" }));

    expect(await screen.findByText("Statement line unresolved — Reconciliation status is unavailable. Refresh this statement before reconciling.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconcile Invoices" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menuitem", { name: "Reconcile Invoices" })).toHaveAttribute("data-disabled");
  });

  it("fails closed when a successful statement-line mutation omits statement lines", async () => {
    const user = userEvent.setup();
    const clearLines = statementLines.map((line) => ({ ...line, clear: true }));
    const onRematchStatementLines = vi.fn().mockResolvedValue({
      invoice: undefined,
      statusChanges: [],
    });

    render(
      <DocumentPanel
        record={makeStatementWithLines(clearLines)}
        spec={createStatementDocumentSpec({
          onAddStatementLine: vi.fn(),
          onReconcile: vi.fn(),
          onRematchStatementLines,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Re-check Lines" }));

    expect(await screen.findByText("Statement line unresolved — Reconciliation status is unavailable. Refresh this statement before reconciling.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconcile Invoices" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menuitem", { name: "Reconcile Invoices" })).toHaveAttribute("data-disabled");
  });

  it("surfaces a plain API rejection from re-checking statement lines and preserves reconciliation authority", async () => {
    const user = userEvent.setup();
    const clearLines = statementLines.map((line) => ({ ...line, clear: true }));
    const onRematchStatementLines = vi.fn().mockRejectedValue({
      status: 400,
      message: "Statement has no lines to re-check",
    });

    render(
      <DocumentPanel
        record={makeStatementWithLines(clearLines)}
        spec={createStatementDocumentSpec({
          onAddStatementLine: vi.fn(),
          onReconcile: vi.fn(),
          onRematchStatementLines,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Re-check Lines" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("Re-check lines failed", { description: "Statement has no lines to re-check" });
    });
    expect(screen.getByText("Re-check lines failed — Statement has no lines to re-check")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconcile Invoices" })).toBeEnabled();
  });

  it("disables re-checking when the statement has no lines", async () => {
    const user = userEvent.setup();
    const onRematchStatementLines = vi.fn();

    render(
      <DocumentPanel
        record={makeStatementWithLines([])}
        spec={createStatementDocumentSpec({
          onAddStatementLine: vi.fn(),
          onRematchStatementLines,
        })}
      />,
    );

    const recheck = screen.getByRole("button", { name: "Re-check Lines" });
    expect(recheck).toBeDisabled();
    await user.click(recheck);
    expect(onRematchStatementLines).not.toHaveBeenCalled();
  });

  it("renders the server blocker and disables every reconciliation entry", async () => {
    const user = userEvent.setup();
    const serverClearLines: StatementLine[] = statementLines.map((line) => ({ ...line, clear: true }));

    render(
      <DocumentPanel
        record={makeStatementWithLines(serverClearLines, {
          reconcile: {
            blockers: [{
              code: "STATEMENT_LINE_UNRESOLVED",
              lineId: "line-3",
              message: "INV-102 remains unresolved on the server.",
            }],
            counts: { total: 4, clear: 3, unresolved: 1 },
            canReconcile: false,
            permittedActions: [],
          },
        })}
        spec={createStatementDocumentSpec({ onFileDocument: vi.fn(), onReconcile: vi.fn() })}
      />,
    );

    expect(screen.getByText("INV-102 — INV-102 remains unresolved on the server.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shelve" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Reconcile Invoices" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menuitem", { name: "Reconcile Invoices" })).toHaveAttribute("data-disabled");
  });

  it("keeps Reconcile Invoices as the primary CTA for shelved unreconciled statements", () => {
    render(
      <DocumentPanel
        record={makeStatement({ filed: true })}
        spec={createStatementDocumentSpec({ onFileDocument: vi.fn(), onReconcile: vi.fn() })}
      />,
    );

    const reconcileButton = screen.getByRole("button", { name: "Reconcile Invoices" });
    expect(reconcileButton).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Shelve" })).not.toBeInTheDocument();
  });

  it("shows a disabled Reconciled CTA for already reconciled shelved statements", () => {
    const clearLines: StatementLine[] = statementLines.map((line) => ({ ...line, status: "matched" as const, clear: true }));

    render(
      <DocumentPanel
        record={makeStatementWithLines(clearLines, { filed: true, reconciled: true })}
        spec={createStatementDocumentSpec({ onFileDocument: vi.fn(), onReconcile: vi.fn() })}
      />,
    );

    expect(screen.getByRole("button", { name: "Reconciled" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Reconcile Invoices" })).not.toBeInTheDocument();
  });

  it("updates a statement line from the API response array and toasts rematch status changes", async () => {
    const user = userEvent.setup();
    const updatedLines: StatementLine[] = statementLines.map((line) => (
      line.id === "line-3"
        ? { ...line, invoiceNumber: "INV-777", status: "matched" }
        : line
    ));
    const onUpdateStatementLine = vi.fn().mockImplementation(() => ({
      invoice: makeStatement(),
      statementLines: updatedLines,
      updatedLine: updatedLines[2],
    }));

    render(
      <DocumentPanel
        record={makeStatement()}
        spec={createStatementDocumentSpec({
          onAddStatementLine: vi.fn(),
          onUpdateStatementLine,
          onDeleteStatementLine: vi.fn(),
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit INV-102" }));
    await user.clear(screen.getAllByLabelText("Invoice number")[0]);
    await user.type(screen.getAllByLabelText("Invoice number")[0], "INV-777");
    await user.click(screen.getByRole("button", { name: "Save changes for INV-102" }));

    await waitFor(() => {
      expect(onUpdateStatementLine).toHaveBeenCalledWith(
        expect.objectContaining({ id: "statement-200" }),
        "line-3",
        { invoiceNumber: "INV-777" },
      );
    });
    expect((await screen.findAllByText("INV-777")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("INV-102")).not.toBeInTheDocument();
    expect(toastMock.success).toHaveBeenCalledWith(
      "Line INV-777 now matched",
      { description: "Statement matching was refreshed." },
    );
  });

  it("removes a statement line after lightweight confirm and replaces rows from the response", async () => {
    const user = userEvent.setup();
    const onDeleteStatementLine = vi.fn().mockResolvedValue({
      invoice: makeStatement(),
      statementLines: statementLines.filter((line) => line.id !== "line-3"),
      removedLine: statementLines[2],
    });

    render(
      <DocumentPanel
        record={makeStatement()}
        spec={createStatementDocumentSpec({
          onAddStatementLine: vi.fn(),
          onUpdateStatementLine: vi.fn(),
          onDeleteStatementLine,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove INV-102" }));
    expect(screen.getByText("Remove INV-102 ($300.00)?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(onDeleteStatementLine).toHaveBeenCalledWith(
        expect.objectContaining({ id: "statement-200" }),
        "line-3",
      );
    });
    expect(screen.queryByText("INV-102")).not.toBeInTheDocument();
    expect(screen.getAllByText("INV-103").length).toBeGreaterThanOrEqual(1);
  });

  it("re-checks statement lines and replaces rows from changed rematch results", async () => {
    const user = userEvent.setup();
    const rematchedLines: StatementLine[] = statementLines.map((line) => (
      line.id === "line-3" ? { ...line, status: "matched" } : line
    ));
    const onRematchStatementLines = vi.fn().mockResolvedValue({
      invoice: makeStatement(),
      statementLines: rematchedLines,
      statusChanges: [{
        lineId: "line-3",
        invoiceNumber: "INV-102",
        status: ["not_received", "matched"],
      }],
    });

    render(
      <DocumentPanel
        record={makeStatement()}
        spec={createStatementDocumentSpec({
          onAddStatementLine: vi.fn(),
          onRematchStatementLines,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Re-check Lines" }));

    await waitFor(() => {
      expect(onRematchStatementLines).toHaveBeenCalledWith(expect.objectContaining({ id: "statement-200" }));
    });
    expect(screen.queryByText("Not received")).not.toBeInTheDocument();
    expect(toastMock.success).toHaveBeenCalledWith(
      "1 line updated: INV-102 now matched \u2713",
      { description: undefined },
    );
  });

  it("toasts when re-check finds no statement line status changes", async () => {
    const user = userEvent.setup();
    const onRematchStatementLines = vi.fn().mockResolvedValue({
      invoice: makeStatement(),
      statementLines,
      statusChanges: [],
    });

    render(
      <DocumentPanel
        record={makeStatement()}
        spec={createStatementDocumentSpec({
          onAddStatementLine: vi.fn(),
          onRematchStatementLines,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Re-check Lines" }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith("No changes - statuses current.");
    });
  });

  it("refreshes statement line statuses after vendor assignment returns rematched lines", async () => {
    const user = userEvent.setup();
    const rematchedLines: StatementLine[] = statementLines.map((line) => (
      line.id === "line-3" ? { ...line, status: "matched" } : line
    ));
    const onUpdateDocument = vi.fn().mockResolvedValue({
      ...makeStatement(),
      statementLines: rematchedLines,
      statusChanges: [{
        lineId: "line-3",
        invoiceNumber: "INV-102",
        status: ["not_received", "matched"],
      }],
      extracted: {
        ...makeStatement().extracted!,
        statementLines: rematchedLines,
      },
    });

    render(
      <DocumentPanel
        record={makeStatement()}
        spec={createStatementDocumentSpec({ onUpdateDocument })}
      />,
    );

    await user.click(getVendorPicker());

    await waitFor(() => {
      expect(onUpdateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: "statement-200" }),
        { vendorCode: "V200" },
      );
    });
    expect(screen.queryByText("Not received")).not.toBeInTheDocument();
    expect(toastMock.success).toHaveBeenCalledWith(
      "1 line updated: INV-102 now matched \u2713",
      { description: undefined },
    );
  });

  it("preserves the selected vendor and renders the literal server refusal", async () => {
    const user = userEvent.setup();
    const onUpdateDocument = vi.fn().mockRejectedValue(new Error("A statement vendor is required before rematching."));

    render(
      <DocumentPanel
        record={makeStatement()}
        spec={createStatementDocumentSpec({ onUpdateDocument })}
      />,
    );

    await user.click(getVendorPicker());

    expect(await screen.findByText("Vendor update failed — A statement vendor is required before rematching.")).toBeInTheDocument();
    expect(getVendorPicker()).toHaveTextContent("Vendor V100");
  });

  it("replaces a manual balance with the server's canonical value on save", async () => {
    const onUpdateStatementAttributes = vi.fn().mockResolvedValue({
      invoice: makeStatement({
        statementAttributes: {
          statementPeriod: { value: "June 2026", source: "extracted" },
          balance: { value: 875.25, source: "computed" },
        },
      }),
    });

    render(
      <DocumentPanel
        record={makeStatement({
          statementAttributes: {
            statementPeriod: { value: "July 2026", source: "manual" },
            balance: { value: 1200, source: "manual" },
          },
        })}
        spec={createStatementDocumentSpec({
          onUpdateStatementAttributes,
          canEditStatementAttributes: true,
        })}
      />,
    );

    const balanceField = () => screen.getByLabelText("Statement balance").closest('[data-testid="field"]') as HTMLElement;
    // b61cf0bf intentionally removed the inline "Clear manual …" links (see statementDocumentViews.test.tsx); b9ea93eb removed source labels.
    expect(screen.queryByRole("button", { name: "Clear manual balance" })).not.toBeInTheDocument();
    expect(within(balanceField()).getByTestId("invoice-field-marker")).toHaveTextContent("EDITED");
    fireEvent.blur(screen.getByLabelText("Statement balance"));

    await waitFor(() => {
      expect(onUpdateStatementAttributes).toHaveBeenCalledWith(
        expect.objectContaining({ id: "statement-200" }),
        { balance: 1200 },
      );
    });
    // The server's canonical fallback value replaces the manual value in the visible field.
    await waitFor(() => expect(screen.getByLabelText("Statement balance")).toHaveValue("875.25"));
    expect(screen.queryByDisplayValue("1200.00")).not.toBeInTheDocument();
  });

  it.each([403, 409, 422])("keeps the edited form and literal server error visible on statement-attribute %i refusal", async (status) => {
    const user = userEvent.setup();
    const message = `Statement attribute ${status} refusal`;
    const onUpdateStatementAttributes = vi.fn().mockRejectedValue({ message, status });

    render(
      <DocumentPanel
        record={makeStatement()}
        spec={createStatementDocumentSpec({
          onUpdateStatementAttributes,
          canEditStatementAttributes: true,
        })}
      />,
    );

    const balance = screen.getByLabelText("Statement balance");
    await user.clear(balance);
    await user.type(balance, "1300");
    fireEvent.blur(balance);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByDisplayValue("1300")).toBeInTheDocument();
    expect(onUpdateStatementAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ id: "statement-200" }),
      { balance: 1300 },
    );
  });

  it("keeps the latest canonical statement save when concurrent attribute requests settle out of order", async () => {
    const first = deferred<{ invoice: Invoice }>();
    const second = deferred<{ invoice: Invoice }>();
    const onUpdateStatementAttributes = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render(
      <DocumentPanel
        record={makeStatement()}
        spec={createStatementDocumentSpec({ onUpdateStatementAttributes, canEditStatementAttributes: true })}
      />,
    );

    fireEvent.change(screen.getByLabelText("Statement period"), { target: { value: "July 2026" } });
    fireEvent.blur(screen.getByLabelText("Statement period"));
    await waitFor(() => expect(onUpdateStatementAttributes).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Statement balance"), { target: { value: "1300" } });
    fireEvent.blur(screen.getByLabelText("Statement balance"));
    await waitFor(() => expect(onUpdateStatementAttributes).toHaveBeenCalledTimes(2));

    second.resolve({
      invoice: makeStatement({
        statementAttributes: {
          statementPeriod: { value: "July 2026", source: "manual" },
          balance: { value: 1300, source: "manual" },
        },
      }),
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    first.reject(new Error("Stale refusal"));
    await waitFor(() => expect(screen.queryByText("Stale refusal")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Statement period")).toHaveValue("July 2026");
    expect(screen.getByLabelText("Statement balance")).toHaveValue("1300.00");
  });

  it("keeps vendor and attribute save sequencing independent across two statements", async () => {
    const user = userEvent.setup();
    const firstVendor = deferred<Invoice>();
    const secondVendor = deferred<Invoice>();
    const firstAttributes = deferred<{ invoice: Invoice }>();
    const secondAttributes = deferred<{ invoice: Invoice }>();
    const firstRecord = makeStatement({ id: "statement-a", file: "statement-a.pdf" });
    const secondRecord = makeStatement({ id: "statement-b", file: "statement-b.pdf" });
    const onUpdateDocument = vi.fn((record: Invoice) => record.id === firstRecord.id ? firstVendor.promise : secondVendor.promise);
    const onUpdateStatementAttributes = vi.fn((record: Invoice) => record.id === firstRecord.id ? firstAttributes.promise : secondAttributes.promise);
    const spec = createStatementDocumentSpec({ onUpdateDocument, onUpdateStatementAttributes, canEditStatementAttributes: true });

    render(
      <>
        <div data-testid="statement-a"><DocumentPanel record={firstRecord} spec={spec} /></div>
        <div data-testid="statement-b"><DocumentPanel record={secondRecord} spec={spec} /></div>
      </>,
    );
    const firstPanel = screen.getByTestId("statement-a");
    const secondPanel = screen.getByTestId("statement-b");
    await user.click(within(firstPanel).getByRole("button", { name: /Vendor V100/ }));
    await user.click(within(secondPanel).getByRole("button", { name: /Vendor V100/ }));
    fireEvent.change(firstPanel.querySelector('[aria-label="Statement period"]')!, { target: { value: "July A" } });
    fireEvent.blur(firstPanel.querySelector('[aria-label="Statement period"]')!);
    fireEvent.change(secondPanel.querySelector('[aria-label="Statement period"]')!, { target: { value: "July B" } });
    fireEvent.blur(secondPanel.querySelector('[aria-label="Statement period"]')!);
    await waitFor(() => {
      expect(onUpdateDocument).toHaveBeenCalledTimes(2);
      expect(onUpdateStatementAttributes).toHaveBeenCalledTimes(2);
    });

    secondVendor.resolve(makeStatement({ id: secondRecord.id, matching: { ...secondRecord.matching!, vendor: { ...secondRecord.matching!.vendor!, vendorCode: "V200" } } }));
    secondAttributes.resolve({ invoice: makeStatement({ id: secondRecord.id, statementAttributes: { statementPeriod: { value: "July B", source: "manual" }, balance: { value: 1000, source: "computed" } } }) });
    firstVendor.resolve(makeStatement({ id: firstRecord.id, matching: { ...firstRecord.matching!, vendor: { ...firstRecord.matching!.vendor!, vendorCode: "V200" } } }));
    firstAttributes.resolve({ invoice: makeStatement({ id: firstRecord.id, statementAttributes: { statementPeriod: { value: "July A", source: "manual" }, balance: { value: 1000, source: "computed" } } }) });

    await waitFor(() => {
      expect(firstPanel).toHaveTextContent("EDITED");
      expect(secondPanel).toHaveTextContent("EDITED");
    });
  });

  it("preserves newer same-field and disjoint drafts when an older statement save resolves", async () => {
    const pending = deferred<{ invoice: Invoice }>();
    const onUpdateStatementAttributes = vi.fn().mockReturnValue(pending.promise);
    render(
      <DocumentPanel
        record={makeStatement()}
        spec={createStatementDocumentSpec({ onUpdateStatementAttributes, canEditStatementAttributes: true })}
      />,
    );

    fireEvent.change(screen.getByLabelText("Statement period"), { target: { value: "July 2026" } });
    fireEvent.blur(screen.getByLabelText("Statement period"));
    await waitFor(() => expect(onUpdateStatementAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ id: "statement-200" }),
      { statementPeriod: "July 2026" },
    ));
    fireEvent.change(screen.getByLabelText("Statement period"), { target: { value: "August 2026 draft" } });
    fireEvent.change(screen.getByLabelText("Statement balance"), { target: { value: "1400 draft" } });

    pending.resolve({
      invoice: makeStatement({
        statementAttributes: {
          statementPeriod: { value: "July 2026", source: "manual" },
          balance: { value: 1000, source: "computed" },
        },
      }),
    });

    // b9ea93eb removed the "Manual" source label; flush the resolved save directly instead of waiting on it.
    await act(async () => { await pending.promise; });
    expect(screen.getByLabelText("Statement period")).toHaveValue("August 2026 draft");
    expect(screen.getByLabelText("Statement balance")).toHaveValue("1400 draft");
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("merges a deferred line response without overwriting newer statement drafts", async () => {
    const record = makeStatement();
    const pending = deferred<{
      invoice: Invoice;
      statementLines: StatementLine[];
      addedLine: StatementLine;
    }>();
    const spec = createStatementDocumentSpec({ onAddStatementLine: vi.fn().mockReturnValue(pending.promise) });
    let form = {
      ...spec.initForm(record),
      newLineInvoiceNumber: "INV-OLD",
      newLineDate: "2026-06-30",
      newLineAmount: "125.50",
    };
    const output = spec.build({
      record,
      form,
      setForm: (next) => { form = typeof next === "function" ? next(form) : next; },
      patchForm: (patch) => { form = { ...form, ...patch }; },
    });
    const linePanel = output.sections?.find((section) => section.id === "lines")?.children as ReactElement<{
      onAddLine: () => Promise<void>;
    }>;

    const save = linePanel.props.onAddLine();
    form = {
      ...form,
      vendorCode: "V-DRAFT",
      statementPeriod: "August draft",
      statementBalance: "1400 draft",
      newLineInvoiceNumber: "INV-NEW",
      newLineDate: "2026-07-31",
      newLineAmount: "225.75",
    };
    const addedLine: StatementLine = {
      id: "manual-new",
      invoiceNumber: "INV-OLD",
      date: "2026-06-30",
      amount: 125.5,
      status: "matched",
      clear: true,
      source: "manual",
    };
    const canonicalLines = [...statementLines, addedLine];
    pending.resolve({ invoice: makeStatementWithLines(canonicalLines), statementLines: canonicalLines, addedLine });
    await save;

    expect(form).toMatchObject({
      vendorCode: "V-DRAFT",
      statementPeriod: "August draft",
      statementBalance: "1400 draft",
      newLineInvoiceNumber: "INV-NEW",
      newLineDate: "2026-07-31",
      newLineAmount: "225.75",
      addingLine: false,
    });
    expect(form.lines.at(-1)?.invoiceNumber).toBe("INV-OLD");
  });

  it("handles protected-line 409s without replacing local statement lines", async () => {
    const user = userEvent.setup();
    const onUpdateStatementLine = vi.fn().mockRejectedValue({
      status: 409,
      message: "Line is protected",
      code: "LINE_STATUS_PROTECTED",
    });

    render(
      <DocumentPanel
        record={makeStatement()}
        spec={createStatementDocumentSpec({
          onAddStatementLine: vi.fn(),
          onUpdateStatementLine,
          onDeleteStatementLine: vi.fn(),
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit INV-102" }));
    await user.clear(screen.getAllByLabelText("Invoice number")[0]);
    await user.type(screen.getAllByLabelText("Invoice number")[0], "INV-BOUNCED");
    await user.click(screen.getByRole("button", { name: "Save changes for INV-102" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "Statement line update failed",
        { description: "Unmatch this line before editing." },
      );
    });
    await user.click(screen.getByRole("button", { name: "Cancel edit for INV-102" }));
    expect(screen.getAllByText("INV-102").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("INV-BOUNCED")).not.toBeInTheDocument();
  });

  it("keeps a line unresolved when the resolve mutation fails", async () => {
    const user = userEvent.setup();
    const onResolveStatementLine = vi.fn().mockRejectedValue(new Error("API unavailable"));
    render(
      <DocumentPanel
        record={makeStatement()}
        spec={createStatementDocumentSpec({ onResolveStatementLine })}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "Add to AP" })[0]);
    expect(screen.getAllByRole("button", { name: "Add to AP" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Accepted line")).not.toBeInTheDocument();
    expect(toastMock.error).toHaveBeenCalledWith("Statement line resolution failed", {
      description: "API unavailable",
    });
  });
});
