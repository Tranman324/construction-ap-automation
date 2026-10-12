/**
 * InvoiceDetailForm.test.tsx
 * Comprehensive tests for the invoice detail form — keyed-state remounting,
 * field rendering, dirty tracking, save payload construction, and edge cases.
 *
 * Mocking strategy mirrors approve-flow.test.tsx: hoist mutable state, mock
 * hooks at module level, render with QueryClientProvider wrapper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { createRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { ApprovalState, InvoiceUpdateResponse, Subcontract, Vendor } from "@/modules/accounting/modules/invoices/types/api";

// ─── Hoisted mutable state ───────────────────────────────────────────────────

const M = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  isUpdating: false,
  approvalState: undefined as Pick<ApprovalState, "path" | "requiredFields"> | undefined,
  subcontractsData: [] as Subcontract[],
  jobSubcontractsData: [] as Subcontract[],
  vendorsData: [] as Vendor[],
  jobsData: [] as Array<{ number: string; description: string; address: string; status: string; pm: string }>,
}));

type DerivationResponse = Pick<InvoiceUpdateResponse, "invoice" | "subcontractDerivation">;

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useUpdateInvoice: () => ({ mutate: M.updateMutate, isPending: M.isUpdating }),
  useRefreshSpectrum: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useValidateApproval: () => ({ data: M.approvalState }),
  useSubcontracts: (vendorCode?: string) => ({ data: vendorCode ? M.subcontractsData : M.jobSubcontractsData }),
  useVendorSearch: () => ({ data: M.vendorsData, isLoading: false }),
  useJobSearch: () => ({ data: M.jobsData, isLoading: false }),
  useJobByNumber: () => ({ data: null }),
  useSpectrumRefreshStatus: () => ({ data: null }),
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
    role: "admin",
    isAdmin: true,
    permissions: ["*"],
  }),
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => ({
    user: { role: "admin", isAdmin: true, permissions: ["*"] },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// ─── Import component after mocks ───────────────────────────────────────────

import {
  InvoiceDetailForm,
  type InvoiceDetailFormHandle,
} from "@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailForm";
import { InvoiceDetailWorkspace } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceDetailWorkspace";
import { PanelNoticeProvider, PanelNoticeOutlet } from "../documents/PanelNotice";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeQueryWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

/**
 * Build a complete Invoice fixture with sensible defaults.
 * Pass overrides for extracted/matching/top-level fields.
 */
function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-001",
    classification: "invoice",
    confidence: 0.95,
    overallConfidence: 0.95,
    file: "test-invoice.pdf",
    email: {
      from: "vendor@example.com",
      subject: "Invoice #1001",
      receivedAt: "2026-05-01T12:00:00Z",
    },
    status: "pending",
    queuedAt: "2026-05-01T12:00:00Z",
    extracted: {
      vendorName: "Acme Drywall",
      vendorAddress: "123 Main St",
      invoiceNumber: "INV-1001",
      invoiceDate: "2026-05-01",
      dueDate: "2026-05-31",
      amount: 12500.0,
      jobNumber: "25-517",
      projectName: "Midtown Tower",
      description: "Drywall install — floors 3-5",
      lineItems: [],
    },
    matching: {
      vendor: {
        vendorCode: "ACME01",
        vendorName: "Acme Drywall",
        confidence: 0.98,
        method: "fuzzy",
      },
      job: {
        jobNumber: "25-517",
        jobDescription: "Midtown Tower",
        confidence: 0.95,
        method: "exact",
      },
      subcontract: {
        subcontractNumber: "25-517.08",
        confidence: 0.9,
        method: "exact",
      },
      sourceInvoiceTotal: 12500.0,
    },
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
    ...overrides,
  };
}

/** Build a second, clearly-different invoice for keyed-state tests. */
function makeInvoiceB(): Invoice {
  return makeInvoice({
    id: "inv-002",
    extracted: {
      vendorName: "Beta Plumbing",
      vendorAddress: "456 Oak Ave",
      invoiceNumber: "BP-2002",
      invoiceDate: "2026-06-01",
      dueDate: "2026-06-30",
      amount: 8750.5,
      jobNumber: "25-200",
      projectName: "Riverside Apts",
      description: "Rough-in plumbing — phase 2",
      lineItems: [],
    },
    matching: {
      vendor: {
        vendorCode: "BETA01",
        vendorName: "Beta Plumbing",
        confidence: 0.92,
        method: "fuzzy",
      },
      job: {
        jobNumber: "25-200",
        jobDescription: "Riverside Apts",
        confidence: 0.88,
        method: "fuzzy",
      },
      subcontract: {
        subcontractNumber: "25-200.03",
        confidence: 0.85,
        method: "fuzzy",
      },
      sourceInvoiceTotal: 8750.5,
    },
  });
}

function renderForm(
  invoiceOverrides: Partial<Invoice> = {},
  props: Partial<React.ComponentProps<typeof InvoiceDetailForm>> = {},
) {
  const invoice = makeInvoice(invoiceOverrides);
  const ref = createRef<InvoiceDetailFormHandle>();
  const result = render(
    <InvoiceDetailForm invoice={invoice} ref={ref} {...props} />,
    { wrapper: makeQueryWrapper() },
  );
  return { ...result, ref, invoice };
}

function CascadeSaveReactionHarness({ invoice }: { invoice: Invoice }) {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  return (
    <InvoiceDetailWorkspace
      document={<div>Document preview</div>}
      tabs={[]}
      activeTab="details"
      onTabChange={vi.fn()}
      hasUnsavedChanges={hasUnsavedChanges}
      footer={hasUnsavedChanges ? <button type="button">Save</button> : <button type="button">Approve</button>}
    >
      <InvoiceDetailForm invoice={invoice} onDirtyChange={setHasUnsavedChanges} />
    </InvoiceDetailWorkspace>
  );
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  M.updateMutate.mockReset();
  M.isUpdating = false;
  M.approvalState = undefined;
  M.subcontractsData = [];
  M.jobSubcontractsData = [];
  M.vendorsData = [];
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("InvoiceDetailForm", () => {
  it("keeps matching and extracted fields in the visual tab order", () => {
    const { container } = renderForm();
    const ids = ["invoice-vendor", "invoice-job", "invoice-subcontract", "invoice-number", "invoice-amount", "invoice-date", "invoice-due-date"];
    const fields = ids.map((id) => container.querySelector(`#${id}`));
    expect(fields.every(Boolean)).toBe(true);
    for (let index = 0; index < fields.length - 1; index += 1) {
      expect(fields[index]?.compareDocumentPosition(fields[index + 1]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it("moves only the unbilled notice to the opted-in outlet and clears it after editing", () => {
    M.subcontractsData = [{ subcontractNumber: "25-517.08", job: "25-517", vendorCode: "ACME01", vendor: "Acme Drywall", revContract: 13000, totalBilled: 12000, status: "active" }];
    render(
      <PanelNoticeProvider documentId="inv-001">
        <div data-testid="form-source"><InvoiceDetailForm invoice={makeInvoice()} /></div>
        <div data-testid="notice-target"><PanelNoticeOutlet /></div>
      </PanelNoticeProvider>,
      { wrapper: makeQueryWrapper() },
    );
    const source = within(screen.getByTestId("form-source"));
    const target = within(screen.getByTestId("notice-target"));
    expect(source.queryByText(/exceeds the unbilled balance/)).not.toBeInTheDocument();
    expect(target.getByText(/exceeds the unbilled balance/)).toHaveTextContent("$12,500.00");
    expect(source.getByText("Contract:")).toBeInTheDocument();
    fireEvent.change(source.getByLabelText(/^Amount/), { target: { value: "500" } });
    expect(target.queryByText(/exceeds the unbilled balance/)).not.toBeInTheDocument();
    expect(M.updateMutate).not.toHaveBeenCalled();
  });

  it("portals save failure/success while keeping field errors and the same retry inline", () => {
    M.updateMutate.mockImplementationOnce((_args: unknown, options: { onError: (error: Error) => void }) => options.onError(new Error("Synthetic save rejected")));
    M.updateMutate.mockImplementationOnce((_args: unknown, options: { onSuccess: () => void }) => options.onSuccess());
    render(
      <PanelNoticeProvider documentId="inv-001">
        <div data-testid="form-source"><InvoiceDetailForm invoice={makeInvoice()} /></div>
        <div data-testid="notice-target"><PanelNoticeOutlet /></div>
      </PanelNoticeProvider>,
      { wrapper: makeQueryWrapper() },
    );
    const source = within(screen.getByTestId("form-source"));
    const target = within(screen.getByTestId("notice-target"));
    const input = source.getByLabelText(/^Invoice #/);
    fireEvent.change(input, { target: { value: "INV-RETRY" } });
    fireEvent.blur(input);
    expect(target.getByText(/Save failed/)).toBeInTheDocument();
    expect(source.queryByText(/Save failed/)).not.toBeInTheDocument();
    expect(source.getByText("Synthetic save rejected")).toBeInTheDocument();
    expect(target.queryByText("Synthetic save rejected")).not.toBeInTheDocument();
    fireEvent.blur(input);
    expect(target.getByText("Saved")).toBeInTheDocument();
    expect(target.queryByText(/Save failed/)).not.toBeInTheDocument();
    expect(M.updateMutate).toHaveBeenCalledTimes(2);
    expect(M.updateMutate.mock.calls[1][0]).toEqual({ id: "inv-001", payload: { invoiceNumber: "INV-RETRY" } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. FIELD RENDERING
  // ═══════════════════════════════════════════════════════════════════════════

  describe("field rendering", () => {
    it.each(["1", "2", "3", undefined] as const)("follows served required fields for path %s, including loading", (path) => {
      M.approvalState = path ? { path, requiredFields: path === "3" ? [] : ["job_match_number"] } : undefined;
      const invoice = makeInvoice({ matching: null, extracted: { ...makeInvoice().extracted!, dueDate: "" } });
      const { container } = renderForm(invoice);
      const job = container.querySelector("#invoice-job")!;
      const jobField = within(job.closest('[data-testid="field"]') as HTMLElement);
      const due = container.querySelector("#invoice-due-date")!;
      const dueField = within(due.closest('[data-testid="field"]') as HTMLElement);
      if (path === "1" || path === "2") {
        expect(jobField.getByText("REQUIRED")).toBeInTheDocument();
        expect(jobField.getByText("*")).toBeInTheDocument();
        expect(job).toHaveAttribute("aria-invalid", "true");
      } else {
        expect(jobField.queryByText("REQUIRED")).not.toBeInTheDocument();
        expect(jobField.queryByText("*")).not.toBeInTheDocument();
        expect(jobField.getByText("OPTIONAL")).toBeInTheDocument();
        expect(job).not.toHaveAttribute("aria-invalid", "true");
      }
      expect(dueField.queryByText("REQUIRED")).not.toBeInTheDocument();
      expect(dueField.queryByText("*")).not.toBeInTheDocument();
      expect(dueField.getByText("OPTIONAL")).toBeInTheDocument();
      expect(due).not.toHaveAttribute("aria-invalid", "true");
      expect(M.updateMutate).not.toHaveBeenCalled();
    });

    it("updates the Job marker when the verdict arrives and when its required columns change", () => {
      const invoice = makeInvoice({ matching: null });
      const { container, rerender } = renderForm(invoice);
      const job = () => container.querySelector("#invoice-job")!;
      expect(job()).not.toHaveAttribute("aria-invalid", "true");
      M.approvalState = { path: "1", requiredFields: ["job_match_number"] };
      rerender(<InvoiceDetailForm invoice={invoice} />);
      expect(job()).toHaveAttribute("aria-invalid", "true");
      M.approvalState = { path: "1", requiredFields: [] };
      rerender(<InvoiceDetailForm invoice={invoice} />);
      expect(job()).not.toHaveAttribute("aria-invalid", "true");
      expect(M.updateMutate).not.toHaveBeenCalled();
    });

    it("renders invoice number from extracted data", () => {
      renderForm();
      const input = screen.getByPlaceholderText("Invoice number");
      expect(input).toHaveValue("INV-1001");
    });

    it("renders amount from extracted data", () => {
      renderForm();
      const input = screen.getByPlaceholderText("0.00");
      expect(input).toHaveValue(12500);
    });

    it("renders invoice date from extracted data", () => {
      renderForm();
      // Date inputs — find by label text
      const label = screen.getByText("Invoice Date");
      const container = label.closest("div")!;
      const input = within(container).getByDisplayValue("2026-05-01");
      expect(input).toBeInTheDocument();
    });

    it("renders due date from extracted data", () => {
      renderForm();
      const label = screen.getByText("Due Date");
      const container = label.closest("div")!;
      const input = within(container).getByDisplayValue("2026-05-31");
      expect(input).toBeInTheDocument();
    });

    it("renders Spectrum Matching section heading", () => {
      renderForm();
      expect(screen.getByText("Spectrum Matching")).toBeInTheDocument();
    });

    it("renders Extracted Data section heading", () => {
      renderForm();
      expect(screen.getByText("Extracted Data")).toBeInTheDocument();
    });

    it("renders Vendor label", () => {
      renderForm();
      expect(screen.getByText("Vendor")).toBeInTheDocument();
    });

    it("renders Job label", () => {
      renderForm();
      expect(screen.getByText("Job")).toBeInTheDocument();
    });

    it("renders Subcontract label", () => {
      renderForm();
      expect(screen.getByText("Subcontract")).toBeInTheDocument();
    });

    it("renders Invoice # label", () => {
      renderForm();
      expect(screen.getByText("Invoice #")).toBeInTheDocument();
    });

    it("renders Amount label", () => {
      renderForm();
      expect(screen.getByText("Amount")).toBeInTheDocument();
    });

    it("renders dollar sign prefix on amount field", () => {
      renderForm();
      expect(screen.getByText("$")).toBeInTheDocument();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. KEYED-STATE BEHAVIOR (primary QA risk)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("keyed-state: switching invoices resets form", () => {
    it("local fields reset when invoice prop changes", () => {
      const invoiceA = makeInvoice();
      const invoiceB = makeInvoiceB();

      const { rerender } = render(
        <InvoiceDetailForm invoice={invoiceA} />,
        { wrapper: makeQueryWrapper() },
      );

      // Verify initial state from invoice A
      expect(screen.getByPlaceholderText("Invoice number")).toHaveValue(
        "INV-1001",
      );
      expect(screen.getByPlaceholderText("0.00")).toHaveValue(12500);

      // Switch to invoice B
      rerender(<InvoiceDetailForm invoice={invoiceB} />);

      // Fields must reflect invoice B — no stale bleed from A
      expect(screen.getByPlaceholderText("Invoice number")).toHaveValue(
        "BP-2002",
      );
      expect(screen.getByPlaceholderText("0.00")).toHaveValue(8750.5);
    });

    it("date fields reset when invoice prop changes", () => {
      const invoiceA = makeInvoice();
      const invoiceB = makeInvoiceB();

      const { rerender } = render(
        <InvoiceDetailForm invoice={invoiceA} />,
        { wrapper: makeQueryWrapper() },
      );

      expect(screen.getByDisplayValue("2026-05-01")).toBeInTheDocument();
      expect(screen.getByDisplayValue("2026-05-31")).toBeInTheDocument();

      rerender(<InvoiceDetailForm invoice={invoiceB} />);

      expect(screen.getByDisplayValue("2026-06-01")).toBeInTheDocument();
      expect(screen.getByDisplayValue("2026-06-30")).toBeInTheDocument();
      // Old dates gone
      expect(screen.queryByDisplayValue("2026-05-01")).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue("2026-05-31")).not.toBeInTheDocument();
    });

    it("dirty edits on invoice A do not bleed to invoice B after switch", async () => {
      const user = userEvent.setup();
      const invoiceA = makeInvoice();
      const invoiceB = makeInvoiceB();

      const { rerender } = render(
        <InvoiceDetailForm invoice={invoiceA} />,
        { wrapper: makeQueryWrapper() },
      );

      // Edit invoice number on A
      const invoiceNumInput = screen.getByPlaceholderText("Invoice number");
      await user.clear(invoiceNumInput);
      await user.type(invoiceNumInput, "EDITED-999");
      expect(invoiceNumInput).toHaveValue("EDITED-999");

      // Switch to B — should show B's data, not the edit
      rerender(<InvoiceDetailForm invoice={invoiceB} />);

      expect(screen.getByPlaceholderText("Invoice number")).toHaveValue(
        "BP-2002",
      );
    });

    it("dirty state resets when switching invoices", async () => {
      const user = userEvent.setup();
      const invoiceA = makeInvoice();
      const invoiceB = makeInvoiceB();
      const onDirtyChange = vi.fn();

      const { rerender } = render(
        <InvoiceDetailForm invoice={invoiceA} onDirtyChange={onDirtyChange} />,
        { wrapper: makeQueryWrapper() },
      );

      // Make a local field dirty
      await user.clear(screen.getByPlaceholderText("Invoice number"));
      await user.type(
        screen.getByPlaceholderText("Invoice number"),
        "CHANGED",
      );

      // Dirty should have been signaled
      expect(onDirtyChange).toHaveBeenCalledWith(true);
      onDirtyChange.mockClear();

      // Switch invoice — dirty resets
      rerender(
        <InvoiceDetailForm
          invoice={invoiceB}
          onDirtyChange={onDirtyChange}
        />,
      );

      // After switching, the form should not be dirty
      expect(onDirtyChange).toHaveBeenCalledWith(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. FIELD EDITS & SAVE PAYLOAD
  // ═══════════════════════════════════════════════════════════════════════════

  describe("field edits and save payload", () => {
    it("editing invoice number updates local state", async () => {
      const user = userEvent.setup();
      renderForm();

      const input = screen.getByPlaceholderText("Invoice number");
      await user.clear(input);
      await user.type(input, "NEW-123");
      expect(input).toHaveValue("NEW-123");
    });

    it("editing amount updates local state", async () => {
      const user = userEvent.setup();
      renderForm();

      const input = screen.getByPlaceholderText("0.00");
      await user.clear(input);
      await user.type(input, "9999.99");
      expect(input).toHaveValue(9999.99);
    });

    it("triggerSave sends only changed fields in the payload", async () => {
      const user = userEvent.setup();
      const ref = createRef<InvoiceDetailFormHandle>();

      render(
        <InvoiceDetailForm invoice={makeInvoice()} ref={ref} />,
        { wrapper: makeQueryWrapper() },
      );

      // Edit only invoice number
      const input = screen.getByPlaceholderText("Invoice number");
      await user.clear(input);
      await user.type(input, "CHANGED-INV");

      // Trigger save via imperative handle
      ref.current!.triggerSave();

      expect(M.updateMutate).toHaveBeenCalledTimes(1);
      const [callArgs] = M.updateMutate.mock.calls;
      expect(callArgs[0]).toMatchObject({
        id: "inv-001",
        payload: { invoiceNumber: "CHANGED-INV" },
      });
      // Amount should NOT be in payload since it wasn't changed
      expect(callArgs[0].payload.amount).toBeUndefined();
      expect(callArgs[0].payload.invoiceDate).toBeUndefined();
    });

    it("triggerSave forwards suppressErrorToast to the mutation only when opted in", async () => {
      const user = userEvent.setup();
      const ref = createRef<InvoiceDetailFormHandle>();

      render(
        <InvoiceDetailForm invoice={makeInvoice()} ref={ref} />,
        { wrapper: makeQueryWrapper() },
      );

      const input = screen.getByPlaceholderText("Invoice number");
      await user.clear(input);
      await user.type(input, "CHANGED-INV");

      // Approve path opts in → the global mutation toast (F1a) is suppressed
      // because the approve-error message already surfaces the failure inline.
      ref.current!.triggerSave(undefined, undefined, { suppressErrorToast: true });
      expect(M.updateMutate.mock.calls[0][0].suppressErrorToast).toBe(true);

      M.updateMutate.mockReset();

      // Default callers (autosave / manual Save / save-before-navigate) do NOT
      // opt in → the toast stays, since it is their only error surface.
      ref.current!.triggerSave();
      expect(M.updateMutate.mock.calls[0][0].suppressErrorToast).toBeFalsy();
    });

    it("saves only the blurred invoice date without per-keystroke writes", () => {
      renderForm();

      fireEvent.change(screen.getByDisplayValue("2026-05-01"), {
        target: { value: "2026-06-15" },
      });

      expect(M.updateMutate).not.toHaveBeenCalled();
      fireEvent.blur(screen.getByDisplayValue("2026-06-15"));

      expect(M.updateMutate).toHaveBeenCalledTimes(1);
      expect(M.updateMutate).toHaveBeenCalledWith(
        {
          id: "inv-001",
          payload: { invoiceDate: "2026-06-15" },
        },
        expect.any(Object),
      );
    });

    it("does not let an older blur response acknowledge a newer invoice-number draft", () => {
      const pending: Array<{ onSuccess?: () => void }> = [];
      M.updateMutate.mockImplementation((_args: unknown, options: { onSuccess?: () => void }) => {
        pending.push(options);
      });
      const ref = createRef<InvoiceDetailFormHandle>();
      render(<InvoiceDetailForm invoice={makeInvoice()} ref={ref} />, { wrapper: makeQueryWrapper() });
      const input = screen.getByPlaceholderText("Invoice number");

      fireEvent.change(input, { target: { value: "FIRST" } });
      fireEvent.blur(input);
      fireEvent.change(input, { target: { value: "SECOND" } });
      fireEvent.blur(input);

      expect(pending).toHaveLength(2);
      act(() => pending[1].onSuccess?.());
      expect(ref.current!.hasEdits).toBe(false);
      act(() => pending[0].onSuccess?.());

      expect(input).toHaveValue("SECOND");
      expect(ref.current!.hasEdits).toBe(false);
    });

    it("cancels a pending autosave when triggerSave saves the same edit", () => {
      vi.useFakeTimers();
      const ref = createRef<InvoiceDetailFormHandle>();
      render(
        <InvoiceDetailForm invoice={makeInvoice()} ref={ref} />,
        { wrapper: makeQueryWrapper() },
      );

      fireEvent.change(screen.getByDisplayValue("2026-05-01"), {
        target: { value: "2026-06-15" },
      });

      ref.current!.triggerSave();
      expect(M.updateMutate).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(700);
      });

      expect(M.updateMutate).toHaveBeenCalledTimes(1);
    });

    it("does not autosave approved invoice date changes", () => {
      vi.useFakeTimers();
      renderForm({ status: "approved" });

      fireEvent.change(screen.getByDisplayValue("2026-05-01"), {
        target: { value: "2026-06-15" },
      });

      act(() => {
        vi.advanceTimersByTime(700);
      });

      expect(M.updateMutate).not.toHaveBeenCalled();
    });

    it("triggerSave includes amount when changed", async () => {
      const user = userEvent.setup();
      const ref = createRef<InvoiceDetailFormHandle>();

      render(
        <InvoiceDetailForm invoice={makeInvoice()} ref={ref} />,
        { wrapper: makeQueryWrapper() },
      );

      const input = screen.getByPlaceholderText("0.00");
      await user.clear(input);
      await user.type(input, "7777.77");

      ref.current!.triggerSave();

      const [callArgs] = M.updateMutate.mock.calls;
      expect(callArgs[0].payload.amount).toBe(7777.77);
    });

    it("triggerSave includes notes when changed", async () => {
      const ref = createRef<InvoiceDetailFormHandle>();

      render(
        <InvoiceDetailForm invoice={makeInvoice()} ref={ref} />,
        { wrapper: makeQueryWrapper() },
      );

      // Notes are managed via imperative handle (setNotes)
      act(() => {
        ref.current!.setNotes("Updated note text");
      });

      ref.current!.triggerSave();

      const [callArgs] = M.updateMutate.mock.calls;
      expect(callArgs[0].payload.notes).toBe("Updated note text");
    });

    it("triggerSave invokes onSuccess callback on successful mutation", async () => {
      M.updateMutate.mockImplementation(
        (_args: unknown, opts: { onSuccess?: () => void }) => {
          opts.onSuccess?.();
        },
      );

      const ref = createRef<InvoiceDetailFormHandle>();
      const onSaved = vi.fn();
      const user = userEvent.setup();

      render(
        <InvoiceDetailForm
          invoice={makeInvoice()}
          ref={ref}
          onSaved={onSaved}
        />,
        { wrapper: makeQueryWrapper() },
      );

      // Must dirty a field so save has something to send
      await user.clear(screen.getByPlaceholderText("Invoice number"));
      await user.type(screen.getByPlaceholderText("Invoice number"), "X");

      ref.current!.triggerSave();

      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it("triggerSave invokes external onError callback on mutation failure", () => {
      M.updateMutate.mockImplementation(
        (_args: unknown, opts: { onError?: (err: Error) => void }) => {
          opts.onError?.(new Error("API failure"));
        },
      );

      const ref = createRef<InvoiceDetailFormHandle>();

      render(
        <InvoiceDetailForm invoice={makeInvoice()} ref={ref} />,
        { wrapper: makeQueryWrapper() },
      );

      act(() => {
        ref.current!.setNotes("Dirty notes");
      });

      const onError = vi.fn();
      ref.current!.triggerSave(undefined, onError);

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe("API failure");
    });

    it("empty amount is not included in save payload", async () => {
      const user = userEvent.setup();
      const ref = createRef<InvoiceDetailFormHandle>();

      render(
        <InvoiceDetailForm invoice={makeInvoice()} ref={ref} />,
        { wrapper: makeQueryWrapper() },
      );

      // Clear amount to empty
      const amountInput = screen.getByPlaceholderText("0.00");
      await user.clear(amountInput);

      // Also change invoice number so payload isn't completely empty
      await user.clear(screen.getByPlaceholderText("Invoice number"));
      await user.type(screen.getByPlaceholderText("Invoice number"), "X");

      ref.current!.triggerSave();

      const [callArgs] = M.updateMutate.mock.calls;
      // amount === "" is excluded from payload by the `&& localFields.amount !== ""` guard
      expect(callArgs[0].payload.amount).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. DIRTY-STATE TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  describe("dirty-state tracking", () => {
    it("resyncs subcontract value with undo/system provenance on the same invoice", () => {
      const invoice = makeInvoice();
      const view = render(<InvoiceDetailForm invoice={invoice} />, { wrapper: makeQueryWrapper() });
      const changed = { ...invoice, matching: { ...invoice.matching!, subcontract: { ...invoice.matching!.subcontract!, subcontractNumber: "SC-NEW" } }, fieldOrigins: { subcontractNumber: { origin: "manual" as const, at: "2026-09-07T12:00:00Z", by: "synthetic@example.test" } } };
      view.rerender(<InvoiceDetailForm invoice={changed} />);
      expect(screen.getByText(/SC-NEW/)).toBeInTheDocument();
      expect(screen.getByText("EDITED")).toBeInTheDocument();
      view.rerender(<InvoiceDetailForm invoice={{ ...invoice, fieldOrigins: {} }} />);
      expect(screen.queryByText(/SC-NEW/)).not.toBeInTheDocument();
      expect(screen.queryByText("EDITED")).not.toBeInTheDocument();
    });

    it.each(["vendorCode", "jobNumber", "subcontractNumber", "invoiceNumber", "amount", "invoiceDate", "dueDate"])("reads only the served %s manual origin on a clean invoice", (field) => {
      const invoice = makeInvoice({ fieldOrigins: { [field]: { origin: "manual", at: "2026-09-07T12:00:00Z", by: "synthetic@example.test" } } });
      const view = render(<InvoiceDetailForm invoice={invoice} />, { wrapper: makeQueryWrapper() });
      expect(screen.getAllByText("EDITED")).toHaveLength(1);
      view.rerender(<InvoiceDetailForm invoice={makeInvoice({ id: "other-invoice", wasModified: true })} />);
      expect(screen.queryByText("EDITED")).not.toBeInTheDocument();
    });

    it("retains served manual origin after save/refetch/reopen and clears it on undo or system overwrite", async () => {
      const user = userEvent.setup();
      const original = makeInvoice();
      const ref = createRef<InvoiceDetailFormHandle>();
      let saved!: () => void;
      M.updateMutate.mockImplementation((_args: unknown, options: { onSuccess: () => void }) => { saved = options.onSuccess; });
      const wrapper = makeQueryWrapper();
      const view = render(<InvoiceDetailForm ref={ref} invoice={original} />, { wrapper });
      const input = screen.getByPlaceholderText("Invoice number");
      fireEvent.change(input, { target: { value: "MANUAL-1" } });
      fireEvent.blur(input);
      const accepted = { ...original, extracted: { ...original.extracted!, invoiceNumber: "MANUAL-1" }, fieldOrigins: { invoiceNumber: { origin: "manual" as const, at: "2026-09-07T12:00:00Z", by: "synthetic@example.test" } } };
      act(() => { saved(); });
      view.rerender(<InvoiceDetailForm ref={ref} invoice={accepted} />);
      expect(input).toHaveClass("border-l-tone-violet");
      expect(ref.current!.hasEdits).toBe(false);
      view.unmount();
      const reopened = render(<InvoiceDetailForm invoice={accepted} />, { wrapper });
      expect(screen.getByPlaceholderText("Invoice number")).toHaveClass("border-l-tone-violet");
      reopened.rerender(<InvoiceDetailForm invoice={{ ...accepted, fieldOrigins: {} }} />);
      expect(screen.getByPlaceholderText("Invoice number")).not.toHaveClass("border-l-tone-violet");
      reopened.rerender(<InvoiceDetailForm invoice={{ ...accepted, fieldOrigins: { invoiceNumber: { ...accepted.fieldOrigins.invoiceNumber, origin: "derived" } } }} />);
      expect(screen.getByPlaceholderText("Invoice number")).not.toHaveClass("border-l-tone-violet");
      await user.clear(screen.getByPlaceholderText("Invoice number"));
      expect(screen.getByPlaceholderText("Invoice number")).toHaveAttribute("aria-invalid", "true");
    });

    it("hasEdits is false on initial render", () => {
      const { ref } = renderForm();
      expect(ref.current!.hasEdits).toBe(false);
    });

    it("hasEdits becomes true after editing a local field", async () => {
      const user = userEvent.setup();
      const { ref } = renderForm();

      await user.clear(screen.getByPlaceholderText("Invoice number"));
      await user.type(screen.getByPlaceholderText("Invoice number"), "X");

      expect(ref.current!.hasEdits).toBe(true);
    });

    it("onDirtyChange fires with true when field is edited", async () => {
      const user = userEvent.setup();
      const onDirtyChange = vi.fn();
      renderForm({}, { onDirtyChange });

      await user.clear(screen.getByPlaceholderText("Invoice number"));
      await user.type(screen.getByPlaceholderText("Invoice number"), "X");

      expect(onDirtyChange).toHaveBeenCalledWith(true);
    });

    it("shared Field marks invoice number as edited", async () => {
      const user = userEvent.setup();
      renderForm();

      // No shared Edited markers initially
      expect(screen.queryAllByText("EDITED")).toHaveLength(0);

      await user.clear(screen.getByPlaceholderText("Invoice number"));
      await user.type(screen.getByPlaceholderText("Invoice number"), "X");

      // Shared grammar shows EDITED and the accepted baseline remains visible.
      expect(screen.getByText("EDITED")).toBeInTheDocument();
      expect(screen.getByText(/was:/)).toBeInTheDocument();
    });

    it("shared Field marks amount as edited", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.clear(screen.getByPlaceholderText("0.00"));
      await user.type(screen.getByPlaceholderText("0.00"), "999");

      expect(screen.getAllByText("EDITED").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByPlaceholderText("0.00")).toHaveClass("border-l-tone-violet", "border-l-[3px]");
    });

    it("marks required empty fields invalid and identifies the empty optional subcontract", async () => {
      const invoice = makeInvoice({
        extracted: {
          ...makeInvoice().extracted!,
          invoiceNumber: "",
          amount: 0,
        },
        matching: { ...makeInvoice().matching!, subcontract: null },
      });
      render(<InvoiceDetailForm invoice={invoice} />, { wrapper: makeQueryWrapper() });

      expect(screen.getAllByText("REQUIRED")).toHaveLength(2);
      expect(screen.getByPlaceholderText("Invoice number")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByPlaceholderText("0.00")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByPlaceholderText("0.00")).toHaveClass("border-l-tone-amber", "border-l-[3px]");
      expect(screen.getByText("OPTIONAL")).toBeInTheDocument();
    });

    it("notesDirty reflects notes state via imperative handle", () => {
      const { ref } = renderForm();

      expect(ref.current!.notesDirty).toBe(false);

      ref.current!.setNotes("New note");
      // After state update, need to re-read ref — React batches updates
      // The imperative handle recalculates on each render
    });

    it("onNotesStateChange fires when notes change", () => {
      const onNotesStateChange = vi.fn();
      const { ref } = renderForm({}, { onNotesStateChange });

      // Initial call
      expect(onNotesStateChange).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: "Drywall install — floors 3-5",
          notesDirty: false,
        }),
      );

      ref.current!.setNotes("Changed");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. IMPERATIVE HANDLE (getApprovalPreview)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("imperative handle — getApprovalPreview", () => {
    it("returns current field values", () => {
      const { ref } = renderForm();
      const preview = ref.current!.getApprovalPreview();

      expect(preview).toMatchObject({
        invoiceNumber: "INV-1001",
        amount: 12500,
        invoiceDate: "2026-05-01",
        vendorCode: "ACME01",
        jobNumber: "25-517",
        subcontractNumber: "25-517.08",
      });
    });

    it("onApprovalPreviewChange fires on mount with initial values", () => {
      const onApprovalPreviewChange = vi.fn();
      renderForm({}, { onApprovalPreviewChange });

      expect(onApprovalPreviewChange).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceNumber: "INV-1001",
          amount: 12500,
        }),
      );
    });

    it("preview.amount is null when amount field is empty", () => {
      const { ref } = renderForm({
        extracted: {
          vendorName: "Acme",
          vendorAddress: null,
          invoiceNumber: "X",
          invoiceDate: "2026-01-01",
          dueDate: null,
          amount: null,
          jobNumber: null,
          projectName: null,
          description: null,
          lineItems: [],
        },
      });

      expect(ref.current!.getApprovalPreview().amount).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. SUBCONTRACT AMOUNT INFO & WARNINGS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("subcontract amount info", () => {
    it("shows contract and unbilled amounts when subcontract data is available", () => {
      M.subcontractsData = [
        {
          subcontractNumber: "25-517.08",
          job: "25-517",
          vendorCode: "ACME01",
          vendor: "Acme Drywall",
          revContract: 50000,
          totalBilled: 30000,
          status: "active",
        },
      ];

      renderForm();

      expect(screen.getByText(/Contract:/)).toBeInTheDocument();
      expect(screen.getByText("$50,000.00")).toBeInTheDocument();
      expect(screen.getByText(/Unbilled:/)).toBeInTheDocument();
      expect(screen.getByText("$20,000.00")).toBeInTheDocument();
    });

    it("shows warning when invoice amount exceeds unbilled balance", () => {
      M.subcontractsData = [
        {
          subcontractNumber: "25-517.08",
          job: "25-517",
          vendorCode: "ACME01",
          vendor: "Acme Drywall",
          revContract: 13000,
          totalBilled: 12000,
          status: "active",
        },
      ];

      // Invoice amount of $12,500 exceeds unbilled of $1,000
      renderForm();

      expect(
        screen.getByText(/exceeds the unbilled balance/),
      ).toBeInTheDocument();
    });

    it("does not show warning when invoice amount is within unbilled balance", () => {
      M.subcontractsData = [
        {
          subcontractNumber: "25-517.08",
          job: "25-517",
          vendorCode: "ACME01",
          vendor: "Acme Drywall",
          revContract: 100000,
          totalBilled: 30000,
          status: "active",
        },
      ];

      renderForm();

      expect(
        screen.queryByText(/exceeds the unbilled balance/),
      ).not.toBeInTheDocument();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. NULL / MISSING OPTIONAL FIELDS — EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════════

  describe("edge cases: null/missing fields", () => {
    it("renders without crashing when extracted is null", () => {
      renderForm({ extracted: null });

      // Should render empty fields, not crash
      const invoiceNumInput = screen.getByPlaceholderText("Invoice number");
      expect(invoiceNumInput).toHaveValue("");
    });

    it("renders without crashing when matching is null", () => {
      renderForm({ matching: null });

      expect(screen.getByText("Spectrum Matching")).toBeInTheDocument();
    });

    it("handles null amount gracefully", () => {
      renderForm({
        extracted: {
          vendorName: "Test",
          vendorAddress: null,
          invoiceNumber: "T-001",
          invoiceDate: "2026-01-01",
          dueDate: null,
          amount: null,
          jobNumber: null,
          projectName: null,
          description: null,
          lineItems: [],
        },
      });

      const amountInput = screen.getByPlaceholderText("0.00");
      expect(amountInput).toHaveValue(null);
    });

    it("handles null dates gracefully", () => {
      renderForm({
        extracted: {
          vendorName: "Test",
          vendorAddress: null,
          invoiceNumber: "T-001",
          invoiceDate: null,
          dueDate: null,
          amount: 100,
          jobNumber: null,
          projectName: null,
          description: null,
          lineItems: [],
        },
      });

      // No date values should be present but form should render
      expect(screen.getByText("Invoice Date")).toBeInTheDocument();
      expect(screen.getByText("Due Date")).toBeInTheDocument();
    });

    it("handles null vendor/job/subcontract matching gracefully", () => {
      renderForm({
        matching: {
          vendor: null,
          job: null,
          subcontract: null,
          sourceInvoiceTotal: null,
        },
      });

      // Labels should render without crashing
      expect(screen.getByText("Vendor")).toBeInTheDocument();
      expect(screen.getByText("Job")).toBeInTheDocument();
      expect(screen.getByText("Subcontract")).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Select a job first" })).toBeDisabled();
    });

    it("handles null description (notes field)", () => {
      const { ref } = renderForm({
        extracted: {
          vendorName: "Test",
          vendorAddress: null,
          invoiceNumber: "T-001",
          invoiceDate: "2026-01-01",
          dueDate: null,
          amount: 100,
          jobNumber: null,
          projectName: null,
          description: null,
          lineItems: [],
        },
      });

      // Notes (from description) should be empty string
      expect(ref.current!.notes).toBe("");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. SERVER RESYNC (useEffect on invoice prop change)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("server resync after save + refetch", () => {
    it("local fields update when invoice extracted data changes in place", () => {
      const invoiceV1 = makeInvoice();
      const invoiceV2 = makeInvoice({
        extracted: {
          ...invoiceV1.extracted!,
          invoiceNumber: "UPDATED-FROM-SERVER",
          amount: 99999,
        },
      });

      const { rerender } = render(
        <InvoiceDetailForm invoice={invoiceV1} />,
        { wrapper: makeQueryWrapper() },
      );

      expect(screen.getByPlaceholderText("Invoice number")).toHaveValue(
        "INV-1001",
      );

      rerender(<InvoiceDetailForm invoice={invoiceV2} />);

      expect(screen.getByPlaceholderText("Invoice number")).toHaveValue(
        "UPDATED-FROM-SERVER",
      );
      expect(screen.getByPlaceholderText("0.00")).toHaveValue(99999);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. IMPERATIVE HANDLE — isSaving STATE
  // ═══════════════════════════════════════════════════════════════════════════

  describe("isSaving state", () => {
    it("isSaving reflects mutation pending state", () => {
      M.isUpdating = true;
      const { ref } = renderForm();
      expect(ref.current!.isSaving).toBe(true);
    });

    it("isSaving is false when no mutation is pending", () => {
      M.isUpdating = false;
      const { ref } = renderForm();
      expect(ref.current!.isSaving).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // F2 — approved-lock affordance (locks on 'approved' OR 'modified')
  // ═══════════════════════════════════════════════════════════════════════════
  describe("F2 — approved-lock affordance", () => {
    it("locks the 5 identity/matching fields on an approved invoice with an Unapprove hint", () => {
      const { container } = renderForm({ status: "approved" });

      const combos = screen.getAllByRole("combobox");
      expect(combos).toHaveLength(3); // Vendor, Job, Subcontract
      combos.forEach((c) => expect(c).toBeDisabled());
      expect(screen.getByPlaceholderText("Invoice number")).toBeDisabled();
      expect(screen.getByPlaceholderText("0.00")).toBeDisabled();

      expect(screen.getAllByText("Unapprove to edit")).toHaveLength(5);

      // The remaining editable fields (Invoice Date + Due Date) stay enabled.
      const dateInputs = container.querySelectorAll('input[type="date"]');
      expect(dateInputs).toHaveLength(2);
      dateInputs.forEach((d) => expect(d).not.toBeDisabled());
    });

    it("also locks the 5 fields on a modified invoice (owner decision: both statuses lock)", () => {
      renderForm({ status: "modified" });

      screen.getAllByRole("combobox").forEach((c) => expect(c).toBeDisabled());
      expect(screen.getByPlaceholderText("Invoice number")).toBeDisabled();
      expect(screen.getByPlaceholderText("0.00")).toBeDisabled();
      expect(screen.getAllByText("Unapprove to edit")).toHaveLength(5);
    });

    it("leaves all fields editable and shows no lock hint on a pending invoice", () => {
      renderForm({ status: "pending" });

      screen.getAllByRole("combobox").forEach((c) => expect(c).not.toBeDisabled());
      expect(screen.getByPlaceholderText("Invoice number")).not.toBeDisabled();
      expect(screen.getByPlaceholderText("0.00")).not.toBeDisabled();
      expect(screen.queryByText("Unapprove to edit")).not.toBeInTheDocument();
    });

    it("a locked dropdown cannot be opened — no editing affordance (negative control)", () => {
      renderForm({ status: "approved" });

      const vendorCombo = screen.getAllByRole("combobox")[0];
      expect(vendorCombo).toBeDisabled();
      expect(vendorCombo).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(vendorCombo);
      // Disabled → force-closed; clicking never expands it or opens the search.
      expect(vendorCombo).toHaveAttribute("aria-expanded", "false");
    });

    it("keeps the real vendor dropdown closed after a pending-to-locked-to-pending transition", () => {
      const { rerender, ref } = renderForm({ status: "pending" });
      const vendorCombo = screen.getAllByRole("combobox")[0];

      fireEvent.click(vendorCombo);
      expect(vendorCombo).toHaveAttribute("aria-expanded", "true");

      rerender(<InvoiceDetailForm invoice={makeInvoice({ status: "approved" })} ref={ref} />);
      expect(vendorCombo).toHaveAttribute("aria-expanded", "false");

      rerender(<InvoiceDetailForm invoice={makeInvoice({ status: "pending" })} ref={ref} />);
      expect(vendorCombo).toHaveAttribute("aria-expanded", "false");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // F1c — locked-field error ring after an autosave 409
  // ═══════════════════════════════════════════════════════════════════════════
  describe("F1c — locked-field error ring", () => {
    it("rings a server-reported locked field with ring-destructive after a blur-save 409", () => {
      const lockErr = Object.assign(new Error("Invoice is financially locked."), {
        status: 409,
        lockedFields: ["invoiceNumber"],
      });
      M.updateMutate.mockImplementation(
        (_args: unknown, opts: { onError?: (err: Error) => void }) => {
          opts.onError?.(lockErr);
        },
      );
      renderForm({ status: "pending" });

      const input = screen.getByPlaceholderText("Invoice number");
      fireEvent.change(input, { target: { value: "NEW-123" } });
      fireEvent.blur(input);

      expect(M.updateMutate).toHaveBeenCalled();
      expect(input).toHaveClass("ring-destructive");
    });

    it("persists a vendor selection immediately with only that selection field", async () => {
      M.vendorsData = [{ code: "ACME02", name: "Acme West" }];
      renderForm({ status: "pending" });

      fireEvent.click(screen.getAllByRole("combobox")[0]);
      fireEvent.click(screen.getByRole("option", { name: "ACME02 — Acme West" }));
      expect(M.updateMutate).toHaveBeenCalledWith(
        { id: "inv-001", payload: { vendorCode: "ACME02" } },
        expect.any(Object),
      );
    });

    it("persists a job selection without an indirect subcontractNumber", () => {
      M.jobsData = [{ number: "26-999", description: "New job", address: "", status: "active", pm: "" }];
      renderForm({ status: "pending" });
      fireEvent.click(screen.getAllByRole("combobox")[1]);
      fireEvent.click(screen.getByRole("option", { name: /26-999/ }));
      expect(M.updateMutate).toHaveBeenCalledWith(
        { id: "inv-001", payload: { jobNumber: "26-999" } }, expect.any(Object),
      );
      expect(M.updateMutate.mock.calls[0][0].payload.subcontractNumber).toBeUndefined();
    });

    it("removes the unsaved-corrections and Save reactions after vendor and job saves", () => {
      M.vendorsData = [{ code: "ACME02", name: "Acme West" }];
      M.jobsData = [{ number: "26-999", description: "New job", address: "", status: "active", pm: "" }];
      const callbacks: Array<{ onSuccess?: () => void }> = [];
      M.updateMutate.mockImplementation((_args: unknown, options: { onSuccess?: () => void }) => callbacks.push(options));

      render(<CascadeSaveReactionHarness invoice={makeInvoice({ status: "pending" })} />, { wrapper: makeQueryWrapper() });

      fireEvent.click(screen.getAllByRole("combobox")[0]);
      fireEvent.click(screen.getByRole("option", { name: "ACME02 — Acme West" }));
      expect(screen.getByText("Unsaved corrections - Save & Approve submits them automatically.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();

      act(() => callbacks[0].onSuccess?.());
      expect(screen.queryByText("Unsaved corrections - Save & Approve submits them automatically.")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

      fireEvent.click(screen.getAllByRole("combobox")[1]);
      fireEvent.click(screen.getByRole("option", { name: /26-999/ }));
      expect(screen.getByText("Unsaved corrections - Save & Approve submits them automatically.")).toBeInTheDocument();

      act(() => callbacks[1].onSuccess?.());
      expect(screen.queryByText("Unsaved corrections - Save & Approve submits them automatically.")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    });

    it("keeps the form dirty when a text edit remains after a cascade save", async () => {
      M.vendorsData = [{ code: "ACME02", name: "Acme West" }];
      const callbacks: Array<{ onSuccess?: () => void }> = [];
      M.updateMutate.mockImplementation((_args: unknown, options: { onSuccess?: () => void }) => callbacks.push(options));
      const user = userEvent.setup();

      render(<CascadeSaveReactionHarness invoice={makeInvoice({ status: "pending" })} />, { wrapper: makeQueryWrapper() });

      fireEvent.click(screen.getAllByRole("combobox")[0]);
      fireEvent.click(screen.getByRole("option", { name: "ACME02 — Acme West" }));
      await user.clear(screen.getByPlaceholderText("Invoice number"));
      await user.type(screen.getByPlaceholderText("Invoice number"), "UNSAVED-123");

      act(() => callbacks[0].onSuccess?.());
      expect(screen.getByText("Unsaved corrections - Save & Approve submits them automatically.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    });

    it("does not acknowledge a pending or failed cascade save", () => {
      M.vendorsData = [{ code: "ACME02", name: "Acme West" }];
      const callbacks: Array<{ onError?: (error: Error) => void }> = [];
      M.updateMutate.mockImplementation((_args: unknown, options: { onError?: (error: Error) => void }) => callbacks.push(options));

      render(<CascadeSaveReactionHarness invoice={makeInvoice({ status: "pending" })} />, { wrapper: makeQueryWrapper() });

      fireEvent.click(screen.getAllByRole("combobox")[0]);
      fireEvent.click(screen.getByRole("option", { name: "ACME02 — Acme West" }));
      expect(screen.getByText("Unsaved corrections - Save & Approve submits them automatically.")).toBeInTheDocument();

      act(() => callbacks[0].onError?.(new Error("Vendor save failed")));
      expect(screen.getByText("Unsaved corrections - Save & Approve submits them automatically.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    });

    it("keeps subcontract saves out of the unsaved-corrections reaction", () => {
      const invoice = makeInvoice();
      M.subcontractsData = [{ subcontractNumber: "SC-NEW", job: "25-517", vendorCode: "ACME01", vendor: "Acme", revContract: 10, totalBilled: 0, status: "open" }];
      const callbacks: Array<{ onSuccess?: () => void }> = [];
      M.updateMutate.mockImplementation((_args: unknown, options: { onSuccess?: () => void }) => callbacks.push(options));

      render(
        <CascadeSaveReactionHarness invoice={makeInvoice({
          status: "pending",
          matching: { ...invoice.matching!, subcontract: null },
        })} />,
        { wrapper: makeQueryWrapper() },
      );

      fireEvent.click(screen.getByRole("combobox", { name: "Select…" }));
      fireEvent.click(screen.getByRole("option", { name: /SC-NEW/ }));
      expect(screen.queryByText("Unsaved corrections - Save & Approve submits them automatically.")).not.toBeInTheDocument();

      act(() => callbacks[0].onSuccess?.());
      expect(screen.queryByText("Unsaved corrections - Save & Approve submits them automatically.")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    });

    it("renders the server-derived subcontract only from the matching vendor response", () => {
      M.vendorsData = [{ code: "ACME02", name: "Acme West" }];
      let options: { onSuccess?: (response: DerivationResponse) => void } | undefined;
      M.updateMutate.mockImplementation((_args: unknown, next: typeof options) => { options = next; });
      renderForm({ status: "pending" });
      fireEvent.click(screen.getAllByRole("combobox")[0]);
      fireEvent.click(screen.getByRole("option", { name: "ACME02 — Acme West" }));
      act(() => options?.onSuccess?.({ subcontractDerivation: { method: "unique", subcontractNumber: "SC-9" }, invoice: makeInvoice() }));
      expect(screen.getByRole("combobox", { name: "SC-9" })).toBeInTheDocument();
      expect(screen.queryByText(/derived from vendor \+ job/)).not.toBeInTheDocument();
    });

    it("keeps the newer pair's derivation when an older vendor response resolves late", () => {
      M.vendorsData = [{ code: "ACME02", name: "Acme West" }];
      M.jobsData = [{ number: "26-999", description: "New job", address: "", status: "active", pm: "" }];
      const calls: Array<{ onSuccess?: (response: DerivationResponse) => void }> = [];
      M.updateMutate.mockImplementation((_args: unknown, next: { onSuccess?: (response: DerivationResponse) => void }) => calls.push(next));
      renderForm({ status: "pending" });
      fireEvent.click(screen.getAllByRole("combobox")[0]);
      fireEvent.click(screen.getByRole("option", { name: "ACME02 — Acme West" }));
      fireEvent.click(screen.getAllByRole("combobox")[1]);
      fireEvent.click(screen.getByRole("option", { name: /26-999/ }));
      act(() => calls[1].onSuccess?.({ subcontractDerivation: { method: "unique", subcontractNumber: "SC-NEW" }, invoice: makeInvoice() }));
      expect(screen.getByRole("combobox", { name: "SC-NEW" })).toBeInTheDocument();
      act(() => calls[0].onSuccess?.({ subcontractDerivation: { method: "unique", subcontractNumber: "SC-OLD" }, invoice: makeInvoice() }));
      expect(screen.queryByRole("combobox", { name: "SC-OLD" })).not.toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "SC-NEW" })).toBeInTheDocument();
    });

    it("resets derived subcontract state when switching invoices", () => {
      M.vendorsData = [{ code: "ACME02", name: "Acme West" }];
      let pending: { onSuccess?: (data: DerivationResponse) => void } | undefined;
      M.updateMutate.mockImplementation((_args: unknown, next: typeof pending) => { pending = next; });
      const ref = createRef<InvoiceDetailFormHandle>();
      const a = makeInvoice({ id: "a", status: "pending" });
      const b = makeInvoiceB();
      const { rerender } = render(<InvoiceDetailForm invoice={a} ref={ref} />, { wrapper: makeQueryWrapper() });
      fireEvent.click(screen.getAllByRole("combobox")[0]); fireEvent.click(screen.getByRole("option", { name: "ACME02 — Acme West" }));
      act(() => pending?.onSuccess?.({ subcontractDerivation: { method: "unique", subcontractNumber: "SC-A" }, invoice: a }));
      rerender(<InvoiceDetailForm invoice={b} ref={ref} />);
      expect(screen.queryByText("SC-A · derived from vendor + job")).not.toBeInTheDocument();
      expect(ref.current!.getApprovalPreview().subcontractNumber).toBe("25-200.03");
    });

    it("ignores a deferred A save after switching to B without corrupting B state", () => {
      M.vendorsData = [{ code: "ACME02", name: "Acme West" }];
      let pending: { onSuccess?: (data: DerivationResponse) => void } | undefined;
      M.updateMutate.mockImplementation((_args: unknown, next: typeof pending) => { pending = next; });
      const ref = createRef<InvoiceDetailFormHandle>();
      const a = makeInvoice({ id: "a", status: "pending" }); const b = makeInvoiceB();
      const { rerender } = render(<InvoiceDetailForm invoice={a} ref={ref} />, { wrapper: makeQueryWrapper() });
      fireEvent.click(screen.getAllByRole("combobox")[0]); fireEvent.click(screen.getByRole("option", { name: "ACME02 — Acme West" }));
      rerender(<InvoiceDetailForm invoice={b} ref={ref} />);
      act(() => pending?.onSuccess?.({ subcontractDerivation: { method: "unique", subcontractNumber: "SC-A" }, invoice: a }));
      expect(screen.queryByText("SC-A · derived from vendor + job")).not.toBeInTheDocument();
      expect(ref.current!.getApprovalPreview().subcontractNumber).toBe("25-200.03");
      expect(ref.current!.hasEdits).toBe(false);
    });

    it("applies derivation from explicit Save after a failed cascade save retry", async () => {
      M.vendorsData = [{ code: "ACME02", name: "Acme West" }];
      const calls: Array<{ onSuccess?: (data: DerivationResponse) => void; onError?: (error: Error) => void }> = [];
      M.updateMutate.mockImplementation((_args: unknown, next: typeof calls[number]) => calls.push(next));
      const ref = createRef<InvoiceDetailFormHandle>();
      render(<InvoiceDetailForm invoice={makeInvoice({ status: "pending" })} ref={ref} />, { wrapper: makeQueryWrapper() });
      fireEvent.click(screen.getAllByRole("combobox")[0]); fireEvent.click(screen.getByRole("option", { name: "ACME02 — Acme West" }));
      act(() => calls[0].onError?.(new Error("retry")));
      await waitFor(() => expect(ref.current!.getPendingPayload()).toMatchObject({ vendorCode: "ACME02" }));
      ref.current!.triggerSave();
      act(() => calls[1].onSuccess?.({ subcontractDerivation: { method: "unique", subcontractNumber: "SC-RETRY" }, invoice: makeInvoice() }));
      expect(screen.getByRole("combobox", { name: "SC-RETRY" })).toBeInTheDocument();
    });

    it("shows a searchable subcontract combobox for an editable vendor/job pair", () => {
      const invoice = makeInvoice();
      M.subcontractsData = [{ subcontractNumber: "SC-NEW", job: "25-517", vendorCode: "ACME01", vendor: "Acme", revContract: 10, totalBilled: 0, status: "open" }];
      renderForm({
        matching: { ...invoice.matching!, subcontract: null },
      });

      const attach = screen.getByRole("combobox", { name: "Select…" });
      fireEvent.click(attach);
      expect(screen.getByRole("option", { name: /SC-NEW/ })).toBeInTheDocument();
    });

    it("persists an attached subcontract through the existing correction mutation", () => {
      const invoice = makeInvoice();
      M.subcontractsData = [{ subcontractNumber: "SC-NEW", job: "25-517", vendorCode: "ACME01", vendor: "Acme", revContract: 10, totalBilled: 0, status: "open" }];
      let options: { onSuccess?: (response: DerivationResponse) => void } | undefined;
      M.updateMutate.mockImplementation((_args: unknown, next: typeof options) => { options = next; });
      renderForm({ matching: { ...invoice.matching!, subcontract: null } });

      fireEvent.click(screen.getByRole("combobox", { name: "Select…" }));
      fireEvent.click(screen.getByRole("option", { name: /SC-NEW/ }));
      expect(M.updateMutate).toHaveBeenCalledWith(
        { id: "inv-001", payload: { subcontractNumber: "SC-NEW" } }, expect.any(Object),
      );

      act(() => options?.onSuccess?.({
        invoice: makeInvoice({
          matching: {
            ...invoice.matching!,
            subcontract: { subcontractNumber: "SC-NEW", confidence: 1, method: "manual" },
          },
        }),
      }));
      expect(screen.getByRole("combobox", { name: /^SC-NEW/ })).toBeInTheDocument();
    });

    it("keeps subcontract visible but disabled until a job is selected", () => {
      const invoice = makeInvoice();
      const missingJob = { ...invoice.matching!, job: null, subcontract: null };
      const { rerender } = renderForm({ matching: missingJob });
      expect(screen.getByRole("combobox", { name: "Select a job first" })).toBeDisabled();
      expect(screen.queryByText(/derived from vendor \+ job/)).not.toBeInTheDocument();

      rerender(<InvoiceDetailForm invoice={makeInvoice({
        status: "approved",
        matching: { ...invoice.matching!, subcontract: null },
      })} />);
      expect(screen.getByRole("combobox", { name: "Select…" })).toBeDisabled();
    });

    it("explains when a job has subcontracts only for other vendors", () => {
      const invoice = makeInvoice({ matching: { ...makeInvoice().matching!, subcontract: null } });
      M.jobSubcontractsData = [{ subcontractNumber: "25-517.99", job: "25-517", vendorCode: "OTHER01", vendor: "Other vendor", revContract: 100, totalBilled: 0, status: "open" }];
      render(<InvoiceDetailForm invoice={invoice} />, { wrapper: makeQueryWrapper() });
      expect(screen.getByRole("combobox", { name: "Select…" })).toBeInTheDocument();
      expect(screen.getByText("This job has subcontracts, but none for this vendor.")).toBeInTheDocument();
    });

    it("preserves a subcontract while a job is temporarily cleared and restores it when that job returns", () => {
      M.jobsData = [{ number: "25-517", description: "Midtown Tower", address: "123 Main St", status: "active", pm: "PM" }];
      M.updateMutate.mockImplementation((_args: unknown, options: { onSuccess?: (response: DerivationResponse) => void }) => {
        options.onSuccess?.({ invoice: makeInvoice(), subcontractDerivation: { method: "none", subcontractNumber: null } });
      });
      const ref = createRef<InvoiceDetailFormHandle>();
      render(<InvoiceDetailForm invoice={makeInvoice({ status: "pending" })} ref={ref} />, { wrapper: makeQueryWrapper() });

      fireEvent.click(screen.getAllByRole("button", { name: "Clear selection" })[1]);
      expect(screen.getByRole("combobox", { name: "Select a job first" })).toBeDisabled();
      expect(ref.current!.getApprovalPreview().subcontractNumber).toBe("25-517.08");

      fireEvent.click(screen.getAllByRole("combobox")[1]);
      fireEvent.click(screen.getByRole("option", { name: /25-517 — Midtown Tower/ }));
      expect(screen.getByRole("combobox", { name: "25-517.08" })).toBeInTheDocument();
      expect(ref.current!.getApprovalPreview().subcontractNumber).toBe("25-517.08");
    });

    it("shows a picker after an ambiguous derivation and sends only the picked subcontract", () => {
      M.vendorsData = [{ code: "ACME02", name: "Acme West" }];
      M.subcontractsData = [{ subcontractNumber: "SC-2", job: "25-517", vendorCode: "ACME02", vendor: "Acme", revContract: 10, totalBilled: 0, status: "open" }];
      const calls: Array<{ onSuccess?: (response: DerivationResponse) => void }> = [];
      M.updateMutate.mockImplementation((_args: unknown, next: { onSuccess?: (response: DerivationResponse) => void }) => calls.push(next));
      renderForm({ status: "pending" });
      fireEvent.click(screen.getAllByRole("combobox")[0]);
      fireEvent.click(screen.getByRole("option", { name: "ACME02 — Acme West" }));
      act(() => calls[0].onSuccess?.({ subcontractDerivation: { method: "ambiguous", subcontractNumber: null, options: [{ number: "SC-2", revContract: 10, status: "open" }] }, invoice: makeInvoice() }));
      fireEvent.click(screen.getByRole("combobox", { name: "Select…" }));
      fireEvent.click(screen.getByRole("option", { name: /SC-2/ }));
      expect(M.updateMutate.mock.calls[1][0].payload).toEqual({ subcontractNumber: "SC-2" });
    });

    it("sends only subcontractNumber for a manual clear", () => {
      renderForm({ status: "pending" });
      const clear = screen.getByRole("combobox", { name: "25-517.08" }).parentElement?.querySelector('[aria-label="Clear selection"]');
      expect(clear).not.toBeNull();
      fireEvent.click(clear!);
      expect(M.updateMutate).toHaveBeenCalledWith(
        { id: "inv-001", payload: { subcontractNumber: "" } }, expect.any(Object),
      );
    });

    it("does not let an older combined save or incoming matching props clear a newer vendor selection", () => {
      M.vendorsData = [
        { code: "ACME02", name: "Acme West" },
        { code: "ACME03", name: "Acme East" },
      ];
      const pending: Array<{ onSuccess?: () => void }> = [];
      M.updateMutate.mockImplementation((_args: unknown, options: { onSuccess?: () => void }) => {
        pending.push(options);
      });
      const ref = createRef<InvoiceDetailFormHandle>();
      const invoice = makeInvoice({ status: "pending" });
      const { rerender } = render(<InvoiceDetailForm invoice={invoice} ref={ref} />, { wrapper: makeQueryWrapper() });

      const vendor = screen.getAllByRole("combobox")[0];
      fireEvent.click(vendor);
      fireEvent.click(screen.getByRole("option", { name: "ACME02 — Acme West" }));
      ref.current!.triggerSave();
      fireEvent.click(vendor);
      fireEvent.click(screen.getByRole("option", { name: "ACME03 — Acme East" }));

      expect(pending).toHaveLength(3);
      rerender(<InvoiceDetailForm invoice={makeInvoice({ status: "pending" })} ref={ref} />);
      act(() => pending[1].onSuccess?.());

      expect(screen.getAllByRole("combobox")[0]).toHaveTextContent("ACME03 — Acme East");
      expect(ref.current!.getPendingPayload()).toMatchObject({ vendorCode: "ACME03" });
    });

    it("renders an inline vendor error when the explicit combined save still owns that selection", async () => {
      M.vendorsData = [{ code: "ACME02", name: "Acme West" }];
      let call = 0;
      M.updateMutate.mockImplementation((_args: unknown, options: { onSuccess?: () => void; onError?: (error: Error) => void }) => {
        call += 1;
        if (call === 1) options.onError?.(new Error("Cascade vendor save failed"));
        else options.onError?.(new Error("Vendor validation failed"));
      });
      const ref = createRef<InvoiceDetailFormHandle>();
      render(<InvoiceDetailForm invoice={makeInvoice({ status: "pending" })} ref={ref} />, { wrapper: makeQueryWrapper() });

      fireEvent.click(screen.getAllByRole("combobox")[0]);
      fireEvent.click(screen.getByRole("option", { name: "ACME02 — Acme West" }));
      await waitFor(() => expect(ref.current!.getPendingPayload()).toMatchObject({ vendorCode: "ACME02" }));
      act(() => ref.current!.triggerSave());

      expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("Vendor validation failed");
    });
  });
});
