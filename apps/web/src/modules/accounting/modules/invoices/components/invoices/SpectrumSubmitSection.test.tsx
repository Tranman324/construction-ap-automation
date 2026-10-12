import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/modules/shared/lib/api";

import { SpectrumSubmitSection, type SpectrumSubmitFooterControl } from "@/modules/accounting/modules/invoices/components/invoices/SpectrumSubmitSection";
import { PanelNoticeProvider, PanelNoticeOutlet } from "../documents/PanelNotice";
import type { Invoice, ClassificationType } from "@/modules/accounting/modules/invoices/types/invoice";
import costTypeGlContract from "../../../../../../../../../test-fixtures/invoices/cost-type-gl-contract.json";

const approvalSchemaFromContract = {
  codingDefaults: {
    costTypeGlMap: {
      map: { ...costTypeGlContract.pairs },
    },
  },
};

const MOCKS = vi.hoisted(() => ({
  realUpdate: false,
  submitMutate: vi.fn(),
  updateMutate: vi.fn(),
  routerPush: vi.fn(),
  searchParams: new URLSearchParams(),
  routingError: false,
  routingCodes: [{ code: "D", description: "AP Default Routing" }] as Array<{ code: string; description: string }>,
  glAccounts: [] as Array<{ code: string; description: string }>,
  glError: false,
  phaseCodes: [] as Array<{ phase_code: string; description: string; default_cost_type: string }>,
  costTypes: [] as Array<{ value: string; label: string }>,
  // Served approval verdict. Default: derive coding defaults from the invoice's
  // subcontract presence (mirrors the documented backend), overridable per test
  // via `approvalOverride` (unavailable/refetch cases) and `requiredFields`.
  approvalOverride: null as null | { data: unknown; isLoading: boolean; isError: boolean },
  requiredFields: [] as string[],
  // Mirrors GET /api/approval-schema from the shared test-only contract. `L`
  // is deliberately absent so the unmapped path is exercised.
  approvalSchema: null as unknown,
}));

interface SubmitMutationOptions {
  onError: (error: unknown) => void;
  onSuccess: (data: unknown) => void;
  onSettled: () => void;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: MOCKS.routerPush }),
  useSearchParams: () => MOCKS.searchParams,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/accounting/modules/invoices/hooks/mutations")>();
  return ({
  useSubmitToSpectrum: () => ({ mutate: MOCKS.submitMutate, isPending: false }),
  useUpdateInvoice: () => MOCKS.realUpdate ? actual.useUpdateInvoice() : ({ mutate: MOCKS.updateMutate, mutateAsync: (args: unknown) => new Promise((resolve, reject) => MOCKS.updateMutate(args, { onSuccess: resolve, onError: reject })), isPending: false }),
}); });

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  approvalVerdictQueryKey: (invoice: Invoice) => ["test-approval", invoice.id],
  useJobByNumber: () => ({ data: null }),
  useSubcontracts: () => ({ data: [] }),
  useRoutingCodes: () => ({
    data: { pm_to_routing: {}, routing_codes: MOCKS.routingCodes },
    isError: MOCKS.routingError,
  }),
  usePhaseCodes: () => ({ data: { phase_codes: MOCKS.phaseCodes, cost_types: ["S", "M"] } }),
  useGlAccounts: () => ({ data: MOCKS.glAccounts, isLoading: false, isError: MOCKS.glError }),
  useGlAccountByCode: (code?: string | null) => ({
    data: MOCKS.glAccounts.find((account) => account.code === code) ?? null,
  }),
  useCostTypes: () => ({ data: { costTypes: MOCKS.costTypes } }),
  // Served Spectrum cost-type→GL master (approvalRules.json codingDefaults).
  useApprovalSchema: () => ({ data: MOCKS.approvalSchema }),
  useValidateApproval: (invoice?: { matching?: { subcontract?: { subcontractNumber?: string } | null } | null }) => {
    if (MOCKS.approvalOverride) return MOCKS.approvalOverride;
    const hasSub = !!invoice?.matching?.subcontract?.subcontractNumber;
    return {
      data: {
        path: hasSub ? "1" : "3",
        requiredFields: MOCKS.requiredFields,
        blockers: [],
        unbilledBalance: null,
        asOf: "2026-07-18T00:00:00.000Z",
        codingDefaults: {
          glAccount: hasSub ? "5450" : "5300",
          costType: hasSub ? "S" : "M",
          phaseCode: null,
          routingCode: "D",
          glDate: null,
        },
        suggestedRoutingCode: null,
        suggestedRoutingPm: null,
      },
      isLoading: false,
      isError: false,
    };
  },
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

function makeInvoice(classification: ClassificationType): Invoice {
  return {
    id: `${classification}-id`,
    classification,
    confidence: 0.9,
    overallConfidence: 0.9,
    file: `${classification}.pdf`,
    email: {
      from: "vendor@example.com",
      subject: "Invoice",
      receivedAt: "2026-06-01T12:00:00.000Z",
    },
    status: "approved",
    queuedAt: "2026-06-01T12:00:00.000Z",
    extracted: {
      vendorName: "Vendor",
      vendorAddress: null,
      invoiceNumber: "INV-001",
      invoiceDate: "2026-06-01",
      dueDate: null,
      amount: 100,
      jobNumber: "25-401",
      projectName: null,
      description: null,
      lineItems: [],
    },
    matching: {
      vendor: { vendorCode: "V001", vendorName: "Vendor", confidence: 0.9, method: "test" },
      job: { jobNumber: "25-401", confidence: 0.9, method: "test" },
      subcontract: null,
      sourceInvoiceTotal: null,
    },
    splitFrom: null,
    duplicateOf: null,
    reason: null,
    error: null,
    reclassifiedFrom: null,
    reclassifiedAt: null,
  };
}

function writeWorkflowSnapshot() {
  window.sessionStorage.setItem("spectrum-submit-workflow-v1", JSON.stringify({
    results: {
      phase: "results",
      candidates: [],
      rows: [
        {
          invoiceId: "invoice-id",
          submitted: false,
          resolved: false,
          discarded: false,
          issue: "Original Spectrum issue",
        },
      ],
      submittedCount: 0,
      failedCount: 1,
    },
    activeInvoiceId: "invoice-id",
  }));
}

function readWorkflowSnapshot() {
  return JSON.parse(window.sessionStorage.getItem("spectrum-submit-workflow-v1") ?? "{}") as {
    results: { rows: Array<{ invoiceId: string; submitted: boolean; resolved: boolean; issue: string | null }> };
  };
}

beforeEach(() => {
  MOCKS.realUpdate = false;
  MOCKS.submitMutate.mockReset();
  MOCKS.updateMutate.mockReset();
  MOCKS.routerPush.mockReset();
  MOCKS.searchParams = new URLSearchParams();
  MOCKS.routingError = false;
  MOCKS.routingCodes = [{ code: "D", description: "AP Default Routing" }];
  MOCKS.glAccounts = [];
  MOCKS.glError = false;
  MOCKS.phaseCodes = [];
  MOCKS.costTypes = [];
  MOCKS.approvalSchema = approvalSchemaFromContract;
  MOCKS.approvalOverride = null;
  MOCKS.requiredFields = [];
  window.sessionStorage.clear();
});

// ── Pre-selection regression snapshot (Task 3.4 → served in 4.2) ─────────────
// Locks the DEFAULT pre-selected coding values (GL account + cost type). The
// coding defaults now come from the SERVED approval verdict
// (GET /api/validate-approval/:id `codingDefaults`), NOT a client literal — the
// mock plays the backend's documented role (subcontract → GL 5450 / cost S,
// otherwise GL 5300 / cost M). Served option lists provide the display labels.
// The assertion pins the SERVED-value rendering.
const SEEDED_GL_ACCOUNTS = [
  { code: "5450", description: "Subcontract Job Cost" },
  { code: "5300", description: "Materials Job Cost" },
  { code: "5500", description: "Job Equipment" },
];
const SEEDED_COST_TYPES = [
  { value: "S", label: "S - Subcontract" },
  { value: "M", label: "M - Material" },
  { value: "L", label: "L - Labor" },
  { value: "O", label: "O - Other" },
  { value: "E", label: "E - Equipment" },
  { value: "B", label: "B - Bond" },
];

function subcontractInvoice(): Invoice {
  const inv = makeInvoice("invoice");
  inv.matching = {
    ...inv.matching!,
    subcontract: { subcontractNumber: "25-401.01", confidence: 0.9, method: "test" },
  };
  return inv;
}

describe("SpectrumSubmitSection pre-selection defaults (regression snapshot)", () => {
  it("acknowledges overlapping saves to different fields through the real mutation hook", async () => {
    MOCKS.realUpdate = true;
    MOCKS.phaseCodes = [{ phase_code: "01", description: "Synthetic phase", default_cost_type: "" }];
    const user = userEvent.setup();
    const invoice = { ...subcontractInvoice(), status: "pending" as const, glAccount: "5450", phaseCode: "00" };
    const origin = { origin: "manual" as const, at: "2026-09-07T12:00:00Z", by: "synthetic@example.test" };
    const patch = vi.spyOn(api, "patch");
    let finishGl!: (value: unknown) => void;
    let finishPhase!: (value: unknown) => void;
    patch.mockReturnValueOnce(new Promise((resolve) => { finishGl = resolve; }));
    patch.mockReturnValueOnce(new Promise((resolve) => { finishPhase = resolve; }));
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const display = (value: Invoice) => <QueryClientProvider client={client}><SpectrumSubmitSection invoice={value} /></QueryClientProvider>;
    const view = render(display(invoice));
    try {
      await user.click(screen.getByRole("combobox", { name: /5450 - Subcontract Job Cost/ }));
      await user.click(screen.getByRole("option", { name: /5300 - Materials Job Cost/ }));
      await user.click(screen.getByLabelText("Phase Code"));
      await user.click(screen.getByRole("option", { name: /01 - Synthetic phase/ }));
      expect(patch).toHaveBeenCalledTimes(2);
      const glSaved = { ...invoice, glAccount: "5300", fieldOrigins: { glAccount: origin } };
      view.rerender(display(glSaved));
      await act(async () => finishGl({ invoice: glSaved, approvalVerdict: {} }));
      const bothSaved = { ...glSaved, phaseCode: "01", fieldOrigins: { ...glSaved.fieldOrigins, phaseCode: origin } };
      view.rerender(display(bothSaved));
      await act(async () => finishPhase({ invoice: bothSaved, approvalVerdict: {} }));
      view.rerender(display({ ...invoice, fieldOrigins: {} }));
      expect(screen.getByRole("combobox", { name: /5450 - Subcontract Job Cost/ })).not.toHaveClass("border-l-tone-violet");
      expect(screen.queryByText("EDITED")).not.toBeInTheDocument();
    } finally {
      view.unmount();
      client.clear();
      patch.mockRestore();
    }
  });

  it("keeps a newer A→B→A selection through the first response until its own acknowledgment", async () => {
    const user = userEvent.setup();
    const origin = { origin: "manual" as const, at: "2026-09-07T12:00:00Z", by: "synthetic@example.test" };
    const invoice = { ...subcontractInvoice(), status: "pending" as const, glAccount: "5450", fieldOrigins: { glAccount: origin } };
    const view = render(<SpectrumSubmitSection invoice={invoice} />);
    await user.click(screen.getByRole("combobox", { name: /5450 - Subcontract Job Cost/ }));
    await user.click(screen.getByRole("option", { name: /5300 - Materials Job Cost/ }));
    const first = MOCKS.updateMutate.mock.calls[0][1];
    await user.click(screen.getByRole("combobox", { name: /5300 - Materials Job Cost/ }));
    await user.click(screen.getByRole("option", { name: /5450 - Subcontract Job Cost/ }));
    const second = MOCKS.updateMutate.mock.calls[1][1];
    const responseB = { ...invoice, glAccount: "5300" };
    view.rerender(<SpectrumSubmitSection invoice={responseB} />);
    await act(async () => first.onSuccess({ invoice: responseB }));
    expect(screen.getByRole("combobox", { name: /5450 - Subcontract Job Cost/ })).toBeInTheDocument();
    view.rerender(<SpectrumSubmitSection invoice={invoice} />);
    await act(async () => second.onSuccess({ invoice }));
    view.rerender(<SpectrumSubmitSection invoice={{ ...responseB, fieldOrigins: {} }} />);
    expect(screen.getByRole("combobox", { name: /5300 - Materials Job Cost/ })).not.toHaveClass("border-l-tone-violet");
  });

  it("releases confirmed local GL selections so undo restores value and origin together", async () => {
    const user = userEvent.setup();
    const invoice = { ...subcontractInvoice(), status: "pending" as const, glAccount: "5450" };
    const origin = { origin: "manual" as const, at: "2026-09-07T12:00:00Z", by: "synthetic@example.test" };
    const view = render(<SpectrumSubmitSection invoice={invoice} />);
    await user.click(screen.getByRole("combobox", { name: /5450 - Subcontract Job Cost/ }));
    await user.click(screen.getByRole("option", { name: /5300 - Materials Job Cost/ }));
    expect(MOCKS.updateMutate).toHaveBeenCalledWith(expect.objectContaining({ payload: { glAccount: "5300" } }), expect.objectContaining({ onSuccess: expect.any(Function) }));
    const accepted = { ...invoice, glAccount: "5300", fieldOrigins: { glAccount: origin } };
    view.rerender(<SpectrumSubmitSection invoice={accepted} />);
    await act(async () => MOCKS.updateMutate.mock.calls[0][1].onSuccess({ invoice: accepted }));
    expect(screen.getByRole("combobox", { name: /5300 - Materials Job Cost/ })).toHaveClass("border-l-tone-violet");
    view.rerender(<SpectrumSubmitSection invoice={{ ...invoice, fieldOrigins: {} }} />);
    expect(screen.getByRole("combobox", { name: /5450 - Subcontract Job Cost/ })).not.toHaveClass("border-l-tone-violet");
  });

  it.each(["routingCode", "phaseCode", "glAccount", "costType"])("renders persisted %s provenance and removes it when server origin changes", (field) => {
    const invoice = { ...subcontractInvoice(), routingCode: "D", phaseCode: "01", glAccount: "5450", costType: "S" };
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    MOCKS.phaseCodes = [{ phase_code: "01", description: "Synthetic phase", default_cost_type: "S" }];
    const origin = { origin: "manual" as const, at: "2026-09-07T12:00:00Z", by: "synthetic@example.test" };
    const view = render(<SpectrumSubmitSection invoice={{ ...invoice, fieldOrigins: { [field]: origin } }} />);
    expect(screen.getAllByText("EDITED")).toHaveLength(1);
    view.rerender(<SpectrumSubmitSection invoice={{ ...invoice, fieldOrigins: { [field]: { ...origin, origin: "derived" } } }} />);
    expect(screen.queryByText("EDITED")).not.toBeInTheDocument();
    view.rerender(<SpectrumSubmitSection invoice={{ ...invoice, wasModified: true }} />);
    expect(screen.queryByText("EDITED")).not.toBeInTheDocument();
  });

  beforeEach(() => {
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
  });

  it("pre-selects GL 5450 + cost type S for a subcontract invoice", () => {
    render(<SpectrumSubmitSection invoice={subcontractInvoice()} />);
    expect(screen.getByText("5450 - Subcontract Job Cost")).toBeInTheDocument();
    expect(screen.getByText("S - Subcontract")).toBeInTheDocument();
  });

  it("pre-selects GL 5300 + cost type M for a non-subcontract invoice", () => {
    render(<SpectrumSubmitSection invoice={makeInvoice("invoice")} />);
    expect(screen.getByText("5300 - Materials Job Cost")).toBeInTheDocument();
    expect(screen.getByText("M - Material")).toBeInTheDocument();
  });
});

describe("SpectrumSubmitSection pre-flight validation feedback", () => {
  it("portals reference warnings and rejection details while keeping submit ownership", async () => {
    MOCKS.approvalSchema = null;
    MOCKS.submitMutate.mockImplementation((_payload: unknown, options: SubmitMutationOptions) => {
      options.onError({ status: 400, message: "Synthetic Spectrum rejection", details: { reason: "payload_validation", errors: ["Synthetic field detail"] } });
      options.onSettled();
    });
    const onSubmitControlChange = vi.fn();
    render(
      <PanelNoticeProvider documentId="invoice-id">
        <div data-testid="spectrum-source"><SpectrumSubmitSection invoice={subcontractInvoice()} onSubmitControlChange={onSubmitControlChange} /></div>
        <div data-testid="notice-target"><PanelNoticeOutlet /></div>
      </PanelNoticeProvider>,
    );
    const source = within(screen.getByTestId("spectrum-source"));
    const target = within(screen.getByTestId("notice-target"));
    expect(target.getByText(/Cost types unavailable/)).toBeInTheDocument();
    expect(target.getByText(/Cost type to GL rules unavailable/)).toBeInTheDocument();
    expect(target.getByText(/was not found in backend subcontracts data/)).toBeInTheDocument();
    expect(source.queryByText(/Cost types unavailable/)).not.toBeInTheDocument();
    expect(source.getByLabelText(/^Routing Code/)).toBeInTheDocument();
    await waitFor(() => expect(onSubmitControlChange).toHaveBeenCalled());
    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => control.onSubmit());
    expect(MOCKS.submitMutate).toHaveBeenCalledTimes(1);
    expect(target.getByText("Previously rejected: Synthetic Spectrum rejection")).toBeInTheDocument();
    expect(target.getByText("Synthetic Spectrum rejection")).toBeInTheDocument();
    expect(target.getAllByText("Synthetic field detail")).toHaveLength(2);
    expect(source.queryByText(/Synthetic Spectrum rejection/)).not.toBeInTheDocument();
  });

  it("portals successful submission feedback and clears the previous rejection", () => {
    MOCKS.submitMutate.mockImplementation((_payload: unknown, options: SubmitMutationOptions) => {
      options.onSuccess({ success: true, submitted: 1, message: "Synthetic submission accepted", results: [{ id: "invoice-id", success: true }] });
      options.onSettled();
    });
    const onSubmitControlChange = vi.fn();
    render(
      <PanelNoticeProvider documentId="invoice-id">
        <div data-testid="spectrum-source"><SpectrumSubmitSection invoice={{ ...makeInvoice("invoice"), lastSpectrumError: "Previous synthetic rejection" }} onSubmitControlChange={onSubmitControlChange} /></div>
        <div data-testid="notice-target"><PanelNoticeOutlet /></div>
      </PanelNoticeProvider>,
    );
    const target = within(screen.getByTestId("notice-target"));
    expect(target.getByText(/Previous synthetic rejection/)).toBeInTheDocument();
    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => control.onSubmit());
    expect(target.getByText("Synthetic submission accepted")).toBeInTheDocument();
    expect(target.queryByText(/Previous synthetic rejection/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("spectrum-source")).queryByText("Synthetic submission accepted")).not.toBeInTheDocument();
  });

  it("shows the latest pre-flight lines in the rejection and prior-rejection banners", async () => {
    const preflightErrors = Array.from(
      { length: 12 },
      (_, index) => `invoice INV-001 detail[${index + 1}]: invalid Spectrum field`,
    );
    MOCKS.submitMutate.mockImplementation((_payload: unknown, options: SubmitMutationOptions) => {
      options.onError({
        status: 400,
        message: "Spectrum submission payload failed validation — no invoices were submitted.",
        details: { reason: "payload_validation", errors: preflightErrors },
      });
      options.onSettled();
    });
    const onSubmitControlChange = vi.fn();
    render(<SpectrumSubmitSection invoice={makeInvoice("invoice")} onSubmitControlChange={onSubmitControlChange} />);

    await waitFor(() => expect(onSubmitControlChange).toHaveBeenCalled());
    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => control.onSubmit());

    expect(screen.getByText("Previously rejected: Spectrum submission payload failed validation — no invoices were submitted.")).toBeInTheDocument();
    expect(screen.getByText("Spectrum submission payload failed validation — no invoices were submitted.")).toBeInTheDocument();
    expect(screen.getAllByText(preflightErrors[0])).toHaveLength(2);
    expect(screen.getAllByText(preflightErrors[9])).toHaveLength(2);
    expect(screen.queryByText(preflightErrors[10])).not.toBeInTheDocument();
    expect(screen.getAllByText("+2 more")).toHaveLength(2);
  });

  it("keeps the existing fallback detail when an error has no pre-flight error array", async () => {
    MOCKS.submitMutate.mockImplementation((_payload: unknown, options: SubmitMutationOptions) => {
      options.onError(new Error("Network offline"));
      options.onSettled();
    });
    const onSubmitControlChange = vi.fn();
    render(<SpectrumSubmitSection invoice={makeInvoice("invoice")} onSubmitControlChange={onSubmitControlChange} />);

    await waitFor(() => expect(onSubmitControlChange).toHaveBeenCalled());
    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => control.onSubmit());

    expect(screen.getByText("Previously rejected: Network offline")).toBeInTheDocument();
    expect(screen.getByText(/No extra error detail was returned\. Check backend logs for this invoice\./)).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d+ more$/)).not.toBeInTheDocument();
  });
});

// ── Served-verdict wiring: override survival + multi-phase requiredFields ─────
describe("SpectrumSubmitSection served verdict wiring", () => {
  function verdict(routingCode: string, requiredFields: string[] = []) {
    return {
      data: {
        path: "1",
        requiredFields,
        blockers: [],
        unbilledBalance: null,
        asOf: "2026-07-18T00:00:00.000Z",
        codingDefaults: { glAccount: "5450", costType: "S", phaseCode: null, routingCode, glDate: null },
        suggestedRoutingCode: null,
        suggestedRoutingPm: null,
      },
      isLoading: false,
      isError: false,
    };
  }

  it("keeps a user routing override across a verdict refetch (M-001)", () => {
    MOCKS.routingError = true; // routing renders as a plain input we can drive
    const invoice = subcontractInvoice();
    const { rerender } = render(<SpectrumSubmitSection invoice={invoice} />);

    // Seeded from the served routing default.
    expect((screen.getByPlaceholderText("Routing code") as HTMLInputElement).value).toBe("D");

    // User overrides the routing code.
    fireEvent.change(screen.getByPlaceholderText("Routing code"), { target: { value: "JS" } });
    expect((screen.getByPlaceholderText("Routing code") as HTMLInputElement).value).toBe("JS");

    // A refetch returns a DIFFERENT served routing default. The user's override
    // must survive (invoice-identity key + untouched sentinel).
    MOCKS.approvalOverride = verdict("AP");
    rerender(<SpectrumSubmitSection invoice={invoice} />);
    expect((screen.getByPlaceholderText("Routing code") as HTMLInputElement).value).toBe("JS");
  });

  it("lets an untouched field follow the served default on refetch", () => {
    MOCKS.routingError = true;
    const invoice = subcontractInvoice();
    const { rerender } = render(<SpectrumSubmitSection invoice={invoice} />);
    expect((screen.getByPlaceholderText("Routing code") as HTMLInputElement).value).toBe("D");

    // Field untouched → it tracks the new served default (proves the sentinel
    // does not freeze fields the user has not changed).
    MOCKS.approvalOverride = verdict("AP");
    rerender(<SpectrumSubmitSection invoice={invoice} />);
    expect((screen.getByPlaceholderText("Routing code") as HTMLInputElement).value).toBe("AP");
  });

  it("marks phase and cost as required when the served verdict requires them", () => {
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    MOCKS.requiredFields = ["gl_account", "phase_code", "cost_type", "routing_code"];
    render(<SpectrumSubmitSection invoice={subcontractInvoice()} />);

    const labelText = (name: string) => screen.getByText(name).closest("label")?.textContent ?? "";
    expect(labelText("Phase Code")).toContain("*");
    expect(labelText("Cost Type")).toContain("*");
    expect(labelText("GL Account")).toContain("*");
  });

  it("drops the phase/cost required markers for a multi-phase-allocated invoice", () => {
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    // Path-1 multi-phase-allocated requiredFields — phase_code/cost_type dropped.
    MOCKS.requiredFields = [
      "invoice_number", "vendor_code", "invoice_date", "gl_date",
      "amount", "job_match_number", "gl_account",
    ];
    render(<SpectrumSubmitSection invoice={subcontractInvoice()} />);

    const labelText = (name: string) => screen.getByText(name).closest("label")?.textContent ?? "";
    expect(labelText("GL Account")).toContain("*");
    expect(labelText("Phase Code")).not.toContain("*");
    expect(labelText("Cost Type")).not.toContain("*");
  });

  it("keeps allocated Phase Code disabled with its explanation, without an extra marker", () => {
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    const invoice = subcontractInvoice();
    invoice.multiPhaseCandidate = true;
    invoice.phaseAllocations = [{ phase_code: "01", cost_type: "S", amount: 100, description: "Concrete" }];

    render(<SpectrumSubmitSection invoice={invoice} />);

    expect(screen.queryByText("SET ELSEWHERE")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /select phase code/i })).toBeDisabled();
    expect(screen.getByText("Allocation sets the phase per line.")).toBeInTheDocument();
  });
});

// ── Reference-data error state (no silent fallback) ──────────────────────────
// When the served GL/cost-type catalogs are unavailable, the panel must render
// an explicit hint and MUST NOT fall back to a hardcoded option label.
describe("SpectrumSubmitSection reference-data error states", () => {
  it("renders an explicit GL-accounts-unavailable hint and no hardcoded fallback label", () => {
    // A failed GL fetch (not an empty search result) surfaces the unavailable hint.
    MOCKS.glError = true;
    MOCKS.glAccounts = [];
    MOCKS.costTypes = [];
    render(<SpectrumSubmitSection invoice={subcontractInvoice()} />);

    expect(screen.getByText(/GL accounts unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText("5450 - Subcontract Job Cost")).not.toBeInTheDocument();
    expect(screen.queryByText("5500 - Job Equipment")).not.toBeInTheDocument();
  });
});

// ── Phase catalog is fetched whole (limit=200) — no first-page truncation ─────
describe("SpectrumSubmitSection phase dropdown", () => {
  it("renders the full phase catalog, not just the first 50", async () => {
    const user = userEvent.setup();
    MOCKS.phaseCodes = Array.from({ length: 55 }, (_, i) => ({
      phase_code: `P${String(i + 1).padStart(3, "0")}`,
      description: `Phase ${i + 1}`,
      default_cost_type: "M",
    }));
    render(<SpectrumSubmitSection invoice={subcontractInvoice()} />);

    await user.click(screen.getByRole("combobox", { name: /Select phase code/i }));

    // The 55th phase (well past the old default 50-item page) is present.
    expect(screen.getByRole("option", { name: /P055 - Phase 55/ })).toBeInTheDocument();
  });
});

afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

// ── F4: cost type drives the GL from the served Spectrum master ──────────────
// The pairing table lives in approvalRules.json (codingDefaults.costTypeGlMap)
// and is served via GET /api/approval-schema — never duplicated client-side.
// Spectrum rejects job-coded lines whose distribution GL disagrees with the
// cost type, and the backend blocks it at approve (COST_TYPE_GL_MISMATCH), so
// the UI must keep the pair consistent as the user edits.
describe("SpectrumSubmitSection cost-type → GL pre-fill", () => {
  function lastOverride(onOverrideChange: ReturnType<typeof vi.fn>) {
    return onOverrideChange.mock.calls.at(-1)?.[0] as { glAccount: string; costType: string };
  }

  async function waitForAutosaveWindow() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 750));
    });
  }

  it("keeps both writers inert when the served map is null", async () => {
    const user = userEvent.setup();
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    MOCKS.phaseCodes = [
      { phase_code: "01000", description: "General Requirements", default_cost_type: "E" },
    ];
    MOCKS.approvalSchema = {
      codingDefaults: { costTypeGlMap: { map: null } },
    };
    const onOverrideChange = vi.fn();
    const invoice = subcontractInvoice();
    invoice.status = "pending";

    render(<SpectrumSubmitSection invoice={invoice} onOverrideChange={onOverrideChange} />);
    const costTypeWriter = screen.getByRole("combobox", { name: /S - Subcontract/ });
    const phaseWriter = screen.getByRole("combobox", { name: /Select phase code/i });
    onOverrideChange.mockClear();

    await user.click(costTypeWriter);
    await user.click(phaseWriter);
    await waitForAutosaveWindow();

    expect(costTypeWriter).toBeDisabled();
    expect(phaseWriter).toBeDisabled();
    expect(onOverrideChange).not.toHaveBeenCalled();
    expect(MOCKS.updateMutate).not.toHaveBeenCalled();
  });

  it("rejects a direct cost-type write when the served map is empty", async () => {
    const user = userEvent.setup();
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    MOCKS.approvalSchema = {
      codingDefaults: { costTypeGlMap: { map: {} } },
    };
    const onOverrideChange = vi.fn();
    const invoice = subcontractInvoice();
    invoice.status = "pending";

    render(<SpectrumSubmitSection invoice={invoice} onOverrideChange={onOverrideChange} />);
    const costTypeWriter = screen.getByRole("combobox", { name: /S - Subcontract/ });
    onOverrideChange.mockClear();

    await user.click(costTypeWriter);
    const equipmentOption = screen.queryByRole("option", { name: /E - Equipment/ });
    if (equipmentOption) await user.click(equipmentOption);
    await waitForAutosaveWindow();

    expect(MOCKS.updateMutate).not.toHaveBeenCalled();
    expect(onOverrideChange).not.toHaveBeenCalled();
    expect(costTypeWriter).toBeDisabled();
  });

  it("rejects a phase-derived cost-type write when the served map is empty", async () => {
    const user = userEvent.setup();
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    MOCKS.phaseCodes = [
      { phase_code: "01000", description: "General Requirements", default_cost_type: "E" },
    ];
    MOCKS.approvalSchema = {
      codingDefaults: { costTypeGlMap: { map: {} } },
    };
    const onOverrideChange = vi.fn();
    const invoice = subcontractInvoice();
    invoice.status = "pending";

    render(<SpectrumSubmitSection invoice={invoice} onOverrideChange={onOverrideChange} />);
    const phaseWriter = screen.getByRole("combobox", { name: /Select phase code/i });
    onOverrideChange.mockClear();

    await user.click(phaseWriter);
    const phaseOption = screen.queryByRole("option", { name: /01000 - General Requirements/ });
    if (phaseOption) await user.click(phaseOption);
    await waitForAutosaveWindow();

    expect(MOCKS.updateMutate).not.toHaveBeenCalled();
    expect(onOverrideChange).not.toHaveBeenCalled();
    expect(phaseWriter).toBeDisabled();
  });

  it("gates cost-type writers while the schema is cold and preserves a GL chosen before it arrives", async () => {
    const user = userEvent.setup();
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    MOCKS.phaseCodes = [
      { phase_code: "01000", description: "General Requirements", default_cost_type: "E" },
    ];
    MOCKS.approvalSchema = undefined;
    const onOverrideChange = vi.fn();
    const invoice = subcontractInvoice();
    invoice.status = "pending";

    const { rerender } = render(
      <SpectrumSubmitSection invoice={invoice} onOverrideChange={onOverrideChange} />,
    );

    expect(screen.getByRole("combobox", { name: /S - Subcontract/ })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /Select phase code/i })).toBeDisabled();
    expect(screen.getByText(/cost type to GL rules unavailable/i)).toBeInTheDocument();
    expect(MOCKS.updateMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("combobox", { name: /5450 - Subcontract Job Cost/ }));
    await user.click(screen.getByRole("option", { name: /5300 - Materials Job Cost/ }));
    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "S", glAccount: "5300" });
    });

    MOCKS.approvalSchema = approvalSchemaFromContract;
    rerender(<SpectrumSubmitSection invoice={invoice} onOverrideChange={onOverrideChange} />);

    expect(screen.getByRole("combobox", { name: /S - Subcontract/ })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: /Select phase code/i })).toBeEnabled();
    expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "S", glAccount: "5300" });

    await user.click(screen.getByRole("combobox", { name: /S - Subcontract/ }));
    await user.click(screen.getByRole("option", { name: /E - Equipment/ }));
    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "E", glAccount: "5500" });
    });
  });

  it("re-derives the GL from the served master when the cost type changes", async () => {
    const user = userEvent.setup();
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    const onOverrideChange = vi.fn();

    // Subcontract invoice: served defaults are cost type S / GL 5450.
    const invoice = subcontractInvoice();
    invoice.status = "pending";
    render(<SpectrumSubmitSection invoice={invoice} onOverrideChange={onOverrideChange} />);
    expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "S", glAccount: "5450" });

    // The trigger's accessible name is its CURRENT value (served default S).
    await user.click(screen.getByRole("combobox", { name: /S - Subcontract/ }));
    await user.click(screen.getByRole("option", { name: /E - Equipment/ }));

    // E → 5500 per JC_COST_TYPE_MASTER, not the stale 5450.
    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "E", glAccount: "5500" });
    });
    expect(MOCKS.updateMutate).toHaveBeenCalledWith({
      id: "invoice-id",
      payload: { costType: "E", glAccount: "5500" },
    }, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it("leaves the GL untouched for a cost type with no GL in the master", async () => {
    const user = userEvent.setup();
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    const onOverrideChange = vi.fn();

    render(<SpectrumSubmitSection invoice={subcontractInvoice()} onOverrideChange={onOverrideChange} />);

    // 'L' (Labor) is deliberately absent from the master — no GL to derive.
    // The trigger's accessible name is its CURRENT value (served default S).
    await user.click(screen.getByRole("combobox", { name: /S - Subcontract/ }));
    await user.click(screen.getByRole("option", { name: /L - Labor/ }));

    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "L", glAccount: "5450" });
    });
  });

  it("keeps a GL the user hand-edits after the cost-type change", async () => {
    const user = userEvent.setup();
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    const onOverrideChange = vi.fn();

    render(<SpectrumSubmitSection invoice={subcontractInvoice()} onOverrideChange={onOverrideChange} />);

    // The trigger's accessible name is its CURRENT value (served default S).
    await user.click(screen.getByRole("combobox", { name: /S - Subcontract/ }));
    await user.click(screen.getByRole("option", { name: /E - Equipment/ }));
    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ glAccount: "5500" });
    });

    // An explicit GL choice after the cost-type change pins the field; nothing
    // re-derives it until the cost type changes again.
    await user.click(screen.getByRole("combobox", { name: /5500 - Job Equipment/ }));
    await user.click(screen.getByRole("option", { name: /5300 - Materials Job Cost/ }));

    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "E", glAccount: "5300" });
    });
  });

  it("reconciles a derivation-owned GL when the served mapping changes", async () => {
    const user = userEvent.setup();
    MOCKS.glAccounts = [
      ...SEEDED_GL_ACCOUNTS,
      { code: "5600", description: "Other Job Cost" },
    ];
    MOCKS.costTypes = SEEDED_COST_TYPES;
    const onOverrideChange = vi.fn();
    const invoice = subcontractInvoice();
    const { rerender } = render(
      <SpectrumSubmitSection invoice={invoice} onOverrideChange={onOverrideChange} />,
    );

    await user.click(screen.getByRole("combobox", { name: /S - Subcontract/ }));
    await user.click(screen.getByRole("option", { name: /E - Equipment/ }));
    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "E", glAccount: "5500" });
    });

    MOCKS.approvalSchema = {
      codingDefaults: {
        costTypeGlMap: {
          map: { ...costTypeGlContract.pairs, E: "5600" },
        },
      },
    };
    rerender(<SpectrumSubmitSection invoice={invoice} onOverrideChange={onOverrideChange} />);

    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "E", glAccount: "5600" });
    });
    expect(screen.getByRole("combobox", { name: /5600 - Other Job Cost/ })).toBeInTheDocument();
  });

  it("preserves a manual GL when the served mapping changes", async () => {
    const user = userEvent.setup();
    MOCKS.glAccounts = [
      ...SEEDED_GL_ACCOUNTS,
      { code: "5600", description: "Other Job Cost" },
    ];
    MOCKS.costTypes = SEEDED_COST_TYPES;
    const onOverrideChange = vi.fn();
    const invoice = subcontractInvoice();
    const { rerender } = render(
      <SpectrumSubmitSection invoice={invoice} onOverrideChange={onOverrideChange} />,
    );

    await user.click(screen.getByRole("combobox", { name: /S - Subcontract/ }));
    await user.click(screen.getByRole("option", { name: /E - Equipment/ }));
    await user.click(screen.getByRole("combobox", { name: /5500 - Job Equipment/ }));
    await user.click(screen.getByRole("option", { name: /5300 - Materials Job Cost/ }));
    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "E", glAccount: "5300" });
    });

    MOCKS.approvalSchema = {
      codingDefaults: {
        costTypeGlMap: {
          map: { ...costTypeGlContract.pairs, E: "5600" },
        },
      },
    };
    rerender(<SpectrumSubmitSection invoice={invoice} onOverrideChange={onOverrideChange} />);

    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "E", glAccount: "5300" });
    });
    expect(screen.getByRole("combobox", { name: /5300 - Materials Job Cost/ })).toBeInTheDocument();
  });

  it("clears the GL value owned by cost-type derivation when cost type is cleared", async () => {
    const user = userEvent.setup();
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    const onOverrideChange = vi.fn();

    render(<SpectrumSubmitSection invoice={subcontractInvoice()} onOverrideChange={onOverrideChange} />);

    await user.click(screen.getByRole("combobox", { name: /S - Subcontract/ }));
    await user.click(screen.getByRole("option", { name: /E - Equipment/ }));
    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "E", glAccount: "5500" });
    });

    const costTypeField = screen.getByText("Cost Type").closest("div");
    expect(costTypeField).not.toBeNull();
    await user.click(within(costTypeField!).getByLabelText("Clear selection"));

    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "", glAccount: "" });
    });
  });

  it("keeps a hand-edited GL when cost type is cleared", async () => {
    const user = userEvent.setup();
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    const onOverrideChange = vi.fn();

    render(<SpectrumSubmitSection invoice={subcontractInvoice()} onOverrideChange={onOverrideChange} />);

    await user.click(screen.getByRole("combobox", { name: /S - Subcontract/ }));
    await user.click(screen.getByRole("option", { name: /E - Equipment/ }));
    await user.click(screen.getByRole("combobox", { name: /5500 - Job Equipment/ }));
    await user.click(screen.getByRole("option", { name: /5300 - Materials Job Cost/ }));

    const costTypeField = screen.getByText("Cost Type").closest("div");
    expect(costTypeField).not.toBeNull();
    await user.click(within(costTypeField!).getByLabelText("Clear selection"));

    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "", glAccount: "5300" });
    });
  });

  it("re-derives the GL when a selected phase carries a default cost type", async () => {
    const user = userEvent.setup();
    MOCKS.glAccounts = SEEDED_GL_ACCOUNTS;
    MOCKS.costTypes = SEEDED_COST_TYPES;
    MOCKS.phaseCodes = [
      { phase_code: "01000", description: "General Requirements", default_cost_type: "E" },
    ];
    const onOverrideChange = vi.fn();
    const invoice = subcontractInvoice();
    invoice.status = "pending";

    render(<SpectrumSubmitSection invoice={invoice} onOverrideChange={onOverrideChange} />);

    // Phase selection is the OTHER writer of cost type — it must derive the GL
    // on the same terms, or picking a phase leaves a pair Spectrum rejects.
    await user.click(screen.getByRole("combobox", { name: /Select phase code/i }));
    await user.click(screen.getByRole("option", { name: /01000 - General Requirements/ }));

    await waitFor(() => {
      expect(lastOverride(onOverrideChange)).toMatchObject({ costType: "E", glAccount: "5500" });
    });
    expect(MOCKS.updateMutate).toHaveBeenCalledTimes(1);
    expect(MOCKS.updateMutate).toHaveBeenCalledWith({
      id: "invoice-id",
      payload: { phaseCode: "01000", costType: "E", glAccount: "5500" },
    }, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });
});

describe("SpectrumSubmitSection classification boundary", () => {
  async function startDelayedSubmit(invoice: Invoice) {
    let resolveSave!: () => void;
    const onBeforeSubmit = vi.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    const onSubmitControlChange = vi.fn();
    const props = {
      invoice,
      onBeforeSubmit,
      onSubmitControlChange,
    };
    const view = render(<SpectrumSubmitSection {...props} />);

    await waitFor(() => expect(onSubmitControlChange).toHaveBeenCalled());
    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => control.onSubmit());
    expect(MOCKS.submitMutate).not.toHaveBeenCalled();

    return { ...view, onBeforeSubmit, onSubmitControlChange, props, resolveSave };
  }

  it("registers a footer submit control for canonical approved invoices", async () => {
    const onSubmitControlChange = vi.fn();
    render(
      <SpectrumSubmitSection
        invoice={makeInvoice("invoice")}
        onSubmitControlChange={onSubmitControlChange}
      />,
    );

    expect(screen.getByText("Other Parameters")).toBeInTheDocument();
    expect(screen.queryByLabelText("GL Date")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit to Spectrum" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(onSubmitControlChange).toHaveBeenLastCalledWith(expect.objectContaining({
        label: "Submit to Spectrum",
        disabled: false,
      }));
    });

    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => {
      control.onSubmit();
    });

    expect(MOCKS.submitMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: ["invoice-id"],
        overrides: {
          "invoice-id": expect.objectContaining({ gl_date: "2026-06-01" }),
        },
      }),
      expect.any(Object),
    );
  });

  it("does not render GL Date in the submit parameters panel", () => {
    render(<SpectrumSubmitSection invoice={makeInvoice("invoice")} />);

    expect(screen.queryByLabelText("GL Date")).not.toBeInTheDocument();
  });

  it("uses a persisted GL date before deriving it from the invoice date", async () => {
    const onSubmitControlChange = vi.fn();
    const invoice = Object.assign(makeInvoice("invoice"), { gl_date: "2026-05-20" });
    render(
      <SpectrumSubmitSection
        invoice={invoice}
        onSubmitControlChange={onSubmitControlChange}
      />,
    );

    await waitFor(() => expect(onSubmitControlChange).toHaveBeenCalled());
    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => control.onSubmit());

    expect(MOCKS.submitMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: {
          "invoice-id": expect.objectContaining({ gl_date: "2026-05-20" }),
        },
      }),
      expect.any(Object),
    );
  });

  it("registers a disabled submit control while the waiver gate is blocked", async () => {
    const onSubmitControlChange = vi.fn();
    render(
      <SpectrumSubmitSection
        invoice={makeInvoice("invoice")}
        waiverGateBlocked
        onSubmitControlChange={onSubmitControlChange}
      />,
    );

    await waitFor(() => {
      expect(onSubmitControlChange).toHaveBeenLastCalledWith(expect.objectContaining({
        label: "Submit to Spectrum",
        disabled: true,
      }));
    });

    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => control.onSubmit());
    expect(MOCKS.submitMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Submit Without Waiver" })).not.toBeInTheDocument();
  });

  it("saves a pending routing-code draft on blur, not on change", () => {
    MOCKS.routingError = true;
    render(<SpectrumSubmitSection invoice={{ ...makeInvoice("invoice"), status: "pending" }} />);

    fireEvent.change(screen.getByPlaceholderText("Routing code"), {
      target: { value: "JS" },
    });

    expect(MOCKS.updateMutate).not.toHaveBeenCalled();

    fireEvent.blur(screen.getByPlaceholderText("Routing code"));

    expect(MOCKS.updateMutate).toHaveBeenCalledWith({
      id: "invoice-id",
      payload: { routingCode: "JS" },
    });
  });

  it("waits for the detail form save hook before submitting to Spectrum", async () => {
    let resolveSave!: () => void;
    const onBeforeSubmit = vi.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    const onSubmitControlChange = vi.fn();
    render(
      <SpectrumSubmitSection
        invoice={makeInvoice("invoice")}
        approvalPreview={{
          invoiceNumber: "INV-001",
          amount: 100,
          invoiceDate: "2026-06-15",
          vendorCode: "V001",
          jobNumber: "25-401",
          subcontractNumber: "",
        }}
        onBeforeSubmit={onBeforeSubmit}
        onSubmitControlChange={onSubmitControlChange}
      />,
    );

    await waitFor(() => expect(onSubmitControlChange).toHaveBeenCalled());
    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;

    act(() => {
      control.onSubmit();
    });

    expect(onBeforeSubmit).toHaveBeenCalledWith({});
    expect(MOCKS.submitMutate).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(MOCKS.submitMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: ["invoice-id"],
        overrides: {
          "invoice-id": expect.objectContaining({ gl_date: "2026-06-15" }),
        },
      }),
      expect.any(Object),
    );
  });

  it("submits the latest derivation-owned GL after a map refetch during the awaited save", async () => {
    const user = userEvent.setup();
    let resolveSave!: () => void;
    const onBeforeSubmit = vi.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    const onSubmitControlChange = vi.fn();
    const props = {
      invoice: subcontractInvoice(),
      onBeforeSubmit,
      onSubmitControlChange,
    };
    MOCKS.glAccounts = [
      ...SEEDED_GL_ACCOUNTS,
      { code: "5600", description: "Other Job Cost" },
    ];
    MOCKS.costTypes = SEEDED_COST_TYPES;
    const { rerender } = render(<SpectrumSubmitSection {...props} />);

    await user.click(screen.getByRole("combobox", { name: /S - Subcontract/ }));
    await user.click(screen.getByRole("option", { name: /E - Equipment/ }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /5500 - Job Equipment/ })).toBeInTheDocument();
    });

    await waitFor(() => expect(onSubmitControlChange).toHaveBeenCalled());
    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => control.onSubmit());
    expect(MOCKS.submitMutate).not.toHaveBeenCalled();

    MOCKS.approvalSchema = {
      codingDefaults: {
        costTypeGlMap: {
          map: { ...costTypeGlContract.pairs, E: "5600" },
        },
      },
    };
    rerender(<SpectrumSubmitSection {...props} />);
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /5600 - Other Job Cost/ })).toBeInTheDocument();
    });

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(MOCKS.submitMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: {
          "invoice-id": expect.objectContaining({
            cost_type: "E",
            gl_account: "5600",
          }),
        },
      }),
      expect.any(Object),
    );
  });

  it("submits a manual GL chosen during the awaited save despite a later map refetch", async () => {
    const user = userEvent.setup();
    let resolveSave!: () => void;
    const onBeforeSubmit = vi.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    const onSubmitControlChange = vi.fn();
    const props = {
      invoice: subcontractInvoice(),
      onBeforeSubmit,
      onSubmitControlChange,
    };
    MOCKS.glAccounts = [
      ...SEEDED_GL_ACCOUNTS,
      { code: "5600", description: "Other Job Cost" },
    ];
    MOCKS.costTypes = SEEDED_COST_TYPES;
    const { rerender } = render(<SpectrumSubmitSection {...props} />);

    await user.click(screen.getByRole("combobox", { name: /S - Subcontract/ }));
    await user.click(screen.getByRole("option", { name: /E - Equipment/ }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /5500 - Job Equipment/ })).toBeInTheDocument();
    });

    await waitFor(() => expect(onSubmitControlChange).toHaveBeenCalled());
    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => control.onSubmit());
    expect(MOCKS.submitMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("combobox", { name: /5500 - Job Equipment/ }));
    await user.click(screen.getByRole("option", { name: /5300 - Materials Job Cost/ }));
    MOCKS.approvalSchema = {
      codingDefaults: {
        costTypeGlMap: {
          map: { ...costTypeGlContract.pairs, E: "5600" },
        },
      },
    };
    rerender(<SpectrumSubmitSection {...props} />);
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /5300 - Materials Job Cost/ })).toBeInTheDocument();
    });

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(MOCKS.submitMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        overrides: {
          "invoice-id": expect.objectContaining({
            cost_type: "E",
            gl_account: "5300",
          }),
        },
      }),
      expect.any(Object),
    );
  });

  it("abandons an awaited submit when the component renders a different invoice", async () => {
    const invoiceA = { ...makeInvoice("invoice"), id: "invoice-a" };
    const invoiceB = { ...makeInvoice("invoice"), id: "invoice-b" };
    const { rerender, props, resolveSave } = await startDelayedSubmit(invoiceA);

    rerender(<SpectrumSubmitSection {...props} invoice={invoiceB} />);

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(MOCKS.submitMutate).not.toHaveBeenCalled();
  });

  it("abandons an awaited submit after an A to B to A identity round trip", async () => {
    const invoiceA = { ...makeInvoice("invoice"), id: "invoice-a" };
    const invoiceB = { ...makeInvoice("invoice"), id: "invoice-b" };
    const { rerender, props, resolveSave } = await startDelayedSubmit(invoiceA);

    rerender(<SpectrumSubmitSection {...props} invoice={invoiceB} />);
    rerender(<SpectrumSubmitSection {...props} invoice={invoiceA} />);

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(MOCKS.submitMutate).not.toHaveBeenCalled();
  });

  it("abandons an awaited submit after the component unmounts", async () => {
    const invoiceA = { ...makeInvoice("invoice"), id: "invoice-a" };
    const { unmount, resolveSave } = await startDelayedSubmit(invoiceA);

    unmount();

    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(MOCKS.submitMutate).not.toHaveBeenCalled();
  });

  it.each(["purchase-order", "credit-memo"] as const)(
    "does not render Spectrum submit controls for %s",
    (classification) => {
      const { container } = render(<SpectrumSubmitSection invoice={makeInvoice(classification)} />);

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole("button", { name: "Submit to Spectrum" })).not.toBeInTheDocument();
    },
  );

  // Pay-applications ARE Spectrum-submittable per the backend gate
  // (submitWorkflow: "only invoices and pay-applications can be submitted to
  // Spectrum"), and bulk submit already includes them. The section previously
  // rendered nothing for them, so Other Parameters and the submit control were
  // unreachable from a pay-app's own detail page.
  it("renders Other Parameters and a submit control for an approved pay-application", async () => {
    const onSubmitControlChange = vi.fn();
    render(
      <SpectrumSubmitSection
        invoice={makeInvoice("pay-application")}
        onSubmitControlChange={onSubmitControlChange}
      />,
    );

    expect(screen.getByText("Other Parameters")).toBeInTheDocument();
    await waitFor(() => {
      expect(onSubmitControlChange).toHaveBeenLastCalledWith(expect.objectContaining({
        label: "Submit to Spectrum",
        disabled: false,
      }));
    });

    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => {
      control.onSubmit();
    });

    expect(MOCKS.submitMutate).toHaveBeenCalledWith(
      expect.objectContaining({ ids: ["pay-application-id"] }),
      expect.any(Object),
    );
  });

  it("marks a return-workflow invoice submitted and navigates back to results after success", async () => {
    MOCKS.searchParams = new URLSearchParams("spectrumSubmitReturn=1&from=/accounting/invoices");
    MOCKS.submitMutate.mockImplementation((_payload: unknown, options: SubmitMutationOptions) => {
      options.onSuccess({
        success: true,
        submitted: 1,
        message: "Invoice submitted to Spectrum.",
        results: [{ id: "invoice-id", success: true }],
      });
      options.onSettled();
    });
    writeWorkflowSnapshot();
    const onSubmitControlChange = vi.fn();
    render(
      <SpectrumSubmitSection
        invoice={makeInvoice("invoice")}
        onSubmitControlChange={onSubmitControlChange}
      />,
    );

    await waitFor(() => expect(onSubmitControlChange).toHaveBeenCalled());
    vi.useFakeTimers();
    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => {
      control.onSubmit();
    });

    expect(readWorkflowSnapshot().results.rows[0]).toEqual(expect.objectContaining({
      submitted: true,
      resolved: true,
      issue: null,
    }));

    act(() => {
      vi.advanceTimersByTime(1_200);
    });
    expect(MOCKS.routerPush).toHaveBeenCalledWith("/accounting/invoices");
  });

  it("keeps a failed return-workflow invoice on detail and updates the snapshot issue", async () => {
    MOCKS.searchParams = new URLSearchParams("spectrumSubmitReturn=1&from=/accounting/invoices");
    MOCKS.submitMutate.mockImplementation((_payload: unknown, options: SubmitMutationOptions) => {
      options.onSuccess({
        success: false,
        submitted: 0,
        message: "Spectrum rejected this submission.",
        results: [{ id: "invoice-id", success: false, error: "G/L date is outside of min/max range for A/P" }],
      });
      options.onSettled();
    });
    writeWorkflowSnapshot();
    const onSubmitControlChange = vi.fn();
    render(
      <SpectrumSubmitSection
        invoice={makeInvoice("invoice")}
        onSubmitControlChange={onSubmitControlChange}
      />,
    );

    await waitFor(() => expect(onSubmitControlChange).toHaveBeenCalled());
    const control = onSubmitControlChange.mock.calls.at(-1)?.[0] as SpectrumSubmitFooterControl;
    act(() => {
      control.onSubmit();
    });

    expect(readWorkflowSnapshot().results.rows[0]).toEqual(expect.objectContaining({
      submitted: false,
      resolved: false,
      issue: "G/L date is outside of min/max range for A/P",
    }));
    expect(MOCKS.routerPush).not.toHaveBeenCalled();
  });
});

describe("SpectrumSubmitSection job-sensitive fields", () => {
  it("hides phase and cost type for an SG&A invoice without a job while retaining GL and routing", () => {
    const invoice = makeInvoice("invoice");
    invoice.extracted = { ...invoice.extracted!, jobNumber: null };
    invoice.matching = { ...invoice.matching!, job: null };
    render(<SpectrumSubmitSection invoice={invoice} />);

    expect(screen.getByLabelText("Routing Code")).toBeInTheDocument();
    expect(screen.getByLabelText("GL Account")).toBeInTheDocument();
    expect(screen.queryByLabelText("Phase Code")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cost Type")).not.toBeInTheDocument();
  });

  it("renders a saved code absent from the current catalog as a disabled inactive option", () => {
    const invoice = makeInvoice("invoice") as Invoice & { routingCode?: string };
    invoice.routingCode = "CB";
    MOCKS.routingCodes = [{ code: "D", description: "AP Default Routing" }];
    render(<SpectrumSubmitSection invoice={invoice} />);

    const selector = screen.getByRole("combobox", { name: "CB (inactive)" });
    fireEvent.click(selector);
    expect(screen.getByRole("option", { name: "CB (inactive)" })).toHaveAttribute("data-disabled", "true");
  });
});
