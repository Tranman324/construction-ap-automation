import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/modules/shared/components/ui/tooltip";
import type { PhaseOptionsResponse } from "@/modules/accounting/modules/invoices/types/api";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

// ── Hoisted mocks ──────────────────────────────────────────────────────────

interface PhaseQueryMock {
  data: PhaseOptionsResponse | undefined;
  isError: boolean;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
}

const M = vi.hoisted((): {
  phaseQuery: PhaseQueryMock;
  phaseOptionsArgs: unknown[];
  saveMutate: ReturnType<typeof vi.fn>;
  saveMutateAsync: ReturnType<typeof vi.fn>;
  saveError: Error | null;
} => ({
  phaseQuery: {
    data: undefined,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  phaseOptionsArgs: [],
  saveMutate: vi.fn(),
  saveMutateAsync: vi.fn(),
  saveError: null,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  // Capture the args so we can assert the panel rekeys the fetch on subcontract/job.
  usePhaseOptions: (...args: unknown[]) => {
    M.phaseOptionsArgs = args;
    return M.phaseQuery;
  },
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useSetPhaseAllocations: () => ({
    mutate: M.saveMutate,
    mutateAsync: M.saveMutateAsync,
    isPending: false,
    isError: M.saveError !== null,
    error: M.saveError,
  }),
}));

import { MultiPhaseAllocationPanel } from "./MultiPhaseAllocationPanel";
import { PanelNoticeProvider, PanelNoticeOutlet, PanelNoticeObserver } from "../documents/PanelNotice";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    classification: "invoice",
    confidence: 0.95,
    overallConfidence: 0.95,
    file: "invoice.pdf",
    email: {
      from: "vendor@example.com",
      subject: "Invoice",
      receivedAt: "2026-06-01T12:00:00.000Z",
    },
    status: "pending",
    queuedAt: "2026-06-01T12:00:00.000Z",
    extracted: {
      vendorName: "Vendor",
      vendorAddress: null,
      invoiceNumber: "INV-001",
      invoiceDate: "2026-06-01",
      dueDate: null,
      amount: 1000,
      jobNumber: "26-401",
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
    multiPhaseCandidate: true,
    phaseAllocations: null,
    ...overrides,
  };
}

function makePhaseOpts(overrides?: Partial<PhaseOptionsResponse>): PhaseOptionsResponse {
  return {
    invoiceId: "inv-1",
    subcontractNumber: "26-416.03",
    jobNumber: "2024-100",
    invoiceAmount: 1000,
    // Internally reconciled (no change orders): sum of phase originals 40000,
    // sum of phase billed 26500 → unbilled 13500. Represents scenario 1.
    header: {
      vendorCode: "V001",
      vendorName: "Test Vendor",
      revContract: 40000,
      totalBilled: 26500,
      unbilled: 13500,
    },
    exceedsUnbilled: false,
    overageAmount: 0,
    suggestedRoutingCode: null,
    suggestedRoutingPm: null,
    currentRoutingCode: null,
    isMultiPhase: true,
    distinctPhaseCount: 2,
    phaseRowCount: 4,
    phaseRows: [
      { row_index: 0, phase_code: "09100", cost_type: "L", description: "Drywall", original_amount: 20000, amount_billed: 15000, remaining_amount: 5000, bid_item: "9.1" },
      { row_index: 1, phase_code: "09100", cost_type: "M", description: "Drywall SCO #1", original_amount: 3000, amount_billed: 3000, remaining_amount: 0, bid_item: "9.1a" },
      { row_index: 2, phase_code: "09100", cost_type: "L", description: "Drywall SCO #2", original_amount: 2000, amount_billed: 500, remaining_amount: 1500 },
      { row_index: 3, phase_code: "09500", cost_type: "L", description: "Painting", original_amount: 15000, amount_billed: 8000, remaining_amount: 7000, bid_item: "9.5" },
    ],
    phases: [
      { phase_code: "09100", cost_type: "L", description: "Drywall", original_amount: 25000, amount_billed: 18500, remaining_amount: 6500 },
      { phase_code: "09500", cost_type: "L", description: "Painting", original_amount: 15000, amount_billed: 8000, remaining_amount: 7000 },
    ],
    currentAllocations: null,
    ...overrides,
  };
}

function renderPanel(invoice?: Partial<Invoice>, props?: { onPendingSaveChange?: (handler: (() => Promise<void>) | null) => void }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MultiPhaseAllocationPanel invoice={makeInvoice(invoice)} {...props} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("MultiPhaseAllocationPanel", () => {
  beforeEach(() => {
    M.phaseQuery.data = undefined;
    M.phaseQuery.isError = false;
    M.phaseQuery.isLoading = false;
    M.phaseQuery.refetch.mockReset();
    M.saveMutate.mockReset();
    M.saveMutateAsync.mockReset();
    M.saveMutateAsync.mockResolvedValue({});
    M.saveError = null;
  });

  // ── Gate is the LIVE verdict, not the persisted flag ───────────────────
  it("portals the query error with its real Retry and removes it on recovery", async () => {
    M.phaseQuery.isError = true;
    const onNotices = vi.fn();
    const view = () => (
      <TooltipProvider>
        <PanelNoticeProvider documentId="inv-1">
          <div data-testid="allocation-source"><MultiPhaseAllocationPanel invoice={makeInvoice()} /></div>
          <div data-testid="notice-target"><PanelNoticeOutlet /></div>
          <PanelNoticeObserver onChange={onNotices} />
        </PanelNoticeProvider>
      </TooltipProvider>
    );
    const { rerender } = render(view());
    const target = within(screen.getByTestId("notice-target"));
    expect(target.getByText("Couldn't load phase allocation data.")).toBeInTheDocument();
    expect(onNotices).toHaveBeenLastCalledWith([expect.objectContaining({ id: "allocation-load-error", tabId: "allocation", resolved: false })]);
    expect(within(screen.getByTestId("allocation-source")).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    await userEvent.click(target.getByRole("button", { name: "Retry" }));
    expect(M.phaseQuery.refetch).toHaveBeenCalledTimes(1);
    expect(M.saveMutateAsync).not.toHaveBeenCalled();
    M.phaseQuery.isError = false;
    M.phaseQuery.data = makePhaseOpts();
    rerender(view());
    expect(target.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("allocation-source")).getByLabelText("Allocate to 09100")).toBeInTheDocument();
  });

  it("portals served overage and reconciliation warnings without moving allocation controls", () => {
    M.phaseQuery.data = makePhaseOpts({ exceedsUnbilled: true, header: { vendorCode: "V001", vendorName: "Test Vendor", revContract: 40001, totalBilled: 26500, unbilled: 13501 } });
    render(
      <TooltipProvider>
        <PanelNoticeProvider documentId="inv-1">
          <div data-testid="allocation-source"><MultiPhaseAllocationPanel invoice={makeInvoice()} /></div>
          <div data-testid="notice-target"><PanelNoticeOutlet /></div>
        </PanelNoticeProvider>
      </TooltipProvider>,
    );
    const source = within(screen.getByTestId("allocation-source"));
    const target = within(screen.getByTestId("notice-target"));
    expect(target.getByTestId("subcontract-overage-warning")).toHaveTextContent("PM routing will be required");
    expect(target.getByTestId("co-unattributable-note")).toBeInTheDocument();
    expect(source.queryByTestId("subcontract-overage-warning")).not.toBeInTheDocument();
    expect(source.getByRole("button", { name: "Save Allocation" })).toBeInTheDocument();
    expect(source.getByTestId("allocation-totals")).toBeInTheDocument();
    expect(M.saveMutateAsync).not.toHaveBeenCalled();
  });

  it("portals allocation failure and success while saving through the existing controls", async () => {
    M.phaseQuery.data = makePhaseOpts();
    M.saveError = new Error("Synthetic allocation save failed");
    const view = () => (
      <TooltipProvider>
        <PanelNoticeProvider documentId="inv-1">
          <div data-testid="allocation-source"><MultiPhaseAllocationPanel invoice={makeInvoice()} /></div>
          <div data-testid="notice-target"><PanelNoticeOutlet /></div>
        </PanelNoticeProvider>
      </TooltipProvider>
    );
    const { rerender } = render(view());
    const source = within(screen.getByTestId("allocation-source"));
    const target = within(screen.getByTestId("notice-target"));
    expect(target.getByText("Synthetic allocation save failed")).toBeInTheDocument();
    expect(source.queryByText("Synthetic allocation save failed")).not.toBeInTheDocument();
    M.saveError = null;
    rerender(view());
    const user = userEvent.setup();
    await user.type(source.getByLabelText("Allocate to 09100"), "1000");
    await user.click(source.getByRole("button", { name: "Save Allocation" }));
    expect(M.saveMutateAsync).toHaveBeenCalledWith({ invoiceId: "inv-1", allocations: [{ phase_code: "09100", amount: 1000, description: "Drywall" }] });
    expect(target.getByText("Saved")).toBeInTheDocument();
    expect(source.queryByText("Saved")).not.toBeInTheDocument();
    expect(target.queryByText("Synthetic allocation save failed")).not.toBeInTheDocument();
  });

  // The stale-after-edit `multiPhaseCandidate` flag no longer gates rendering —
  // the live served `isMultiPhase` does. A stale-false flag with a multi-phase
  // verdict still renders (the SINGLE→MULTI-after-edit case).
  it("renders from the live verdict even when multiPhaseCandidate is stale-false", () => {
    M.phaseQuery.data = makePhaseOpts();
    renderPanel({ multiPhaseCandidate: false });
    expect(screen.getByTestId("phase-header-09100")).toBeInTheDocument();
  });

  // ── Success single-phase → null ────────────────────────────────────────

  it("renders nothing when query succeeds but is single-phase", () => {
    M.phaseQuery.data = makePhaseOpts({ isMultiPhase: false, phases: [] });
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  // ── Error state ────────────────────────────────────────────────────────

  describe("error state", () => {
    it("shows alert with Retry when query errors and multiPhaseCandidate is true", () => {
      M.phaseQuery.isError = true;
      renderPanel();

      expect(screen.getByText("Couldn't load phase allocation data.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });

    it("Retry button calls refetch", async () => {
      M.phaseQuery.isError = true;
      renderPanel();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Retry" }));
      expect(M.phaseQuery.refetch).toHaveBeenCalledTimes(1);
    });

    it("shows the error regardless of a stale-false multiPhaseCandidate flag (the flag no longer gates)", () => {
      M.phaseQuery.isError = true;
      renderPanel({ multiPhaseCandidate: false });
      // The page only mounts the panel when the live verdict says multi-phase, so
      // a mounted+errored panel surfaces the error — the persisted flag is irrelevant.
      expect(screen.getByText("Couldn't load phase allocation data.")).toBeInTheDocument();
    });
  });

  // ── Grouped rendering ─────────────────────────────────────────────────

  describe("grouped layout", () => {
    beforeEach(() => {
      M.phaseQuery.data = makePhaseOpts();
    });

    it("renders phase headers with rollup values", () => {
      renderPanel();

      const header09100 = screen.getByTestId("phase-header-09100");
      expect(header09100).toHaveTextContent("09100");
      expect(header09100).toHaveTextContent("$25,000.00");
      expect(header09100).toHaveTextContent("$18,500.00");
      expect(header09100).toHaveTextContent("$6,500.00");

      const header09500 = screen.getByTestId("phase-header-09500");
      expect(header09500).toHaveTextContent("09500");
      expect(header09500).toHaveTextContent("$15,000.00");
    });

    it("renders detail rows under multi-row phases", () => {
      renderPanel();

      const details09100 = screen.getByTestId("phase-details-09100");
      expect(details09100).toBeInTheDocument();
      expect(within(details09100).getByText("Drywall SCO #1")).toBeInTheDocument();
      expect(within(details09100).getByText("Drywall SCO #2")).toBeInTheDocument();
    });

    it("does NOT render detail rows for single-row phase", () => {
      renderPanel();
      expect(screen.queryByTestId("phase-details-09500")).not.toBeInTheDocument();
    });

    it("dims $0-remaining detail rows", () => {
      renderPanel();

      const dimmedRow = screen.getByTestId("detail-row-1");
      expect(dimmedRow).toHaveAttribute("data-dimmed", "true");

      const normalRow = screen.getByTestId("detail-row-0");
      expect(normalRow).not.toHaveAttribute("data-dimmed");
    });

    it("renders guidance line", () => {
      renderPanel();
      expect(screen.getByText(/Spectrum accepts one amount per phase/)).toBeInTheDocument();
    });
  });

  // ── Allocation inputs ─────────────────────────────────────────────────

  describe("allocation inputs", () => {
    beforeEach(() => {
      M.phaseQuery.data = makePhaseOpts();
    });

    it("renders one input per phase group", () => {
      renderPanel();

      expect(screen.getByLabelText("Allocate to 09100")).toBeInTheDocument();
      expect(screen.getByLabelText("Allocate to 09500")).toBeInTheDocument();
      const inputs = screen.getAllByRole("textbox");
      expect(inputs).toHaveLength(2);
    });

    it("right-aligns phase allocation inputs and totals", () => {
      renderPanel();

      expect(screen.getByTestId("phase-input-09100")).toHaveClass("justify-end");
      expect(screen.getByTestId("allocation-totals").firstElementChild).toHaveClass("justify-end");
    });

    it("typing updates input value", async () => {
      renderPanel();
      const user = userEvent.setup();

      const input = screen.getByLabelText("Allocate to 09100");
      await user.type(input, "500.00");
      expect(input).toHaveValue("500.00");
    });

    it("save payload structure is unchanged", async () => {
      renderPanel();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText("Allocate to 09100"), "600.00");
      await user.type(screen.getByLabelText("Allocate to 09500"), "400.00");

      await user.click(screen.getByRole("button", { name: "Save Allocation" }));

      expect(M.saveMutateAsync).toHaveBeenCalledWith(
        {
          invoiceId: "inv-1",
          allocations: [
            { phase_code: "09100", amount: 600.00, description: "Drywall" },
            { phase_code: "09500", amount: 400.00, description: "Painting" },
          ],
        }
      );
    });

    it("registers a pending save handler that persists dirty balanced allocations", async () => {
      const user = userEvent.setup();
      const pendingSaves: Array<(() => Promise<void>) | null> = [];
      const onPendingSaveChange = vi.fn((handler: (() => Promise<void>) | null) => {
        pendingSaves.push(handler);
      });

      renderPanel(undefined, { onPendingSaveChange });

      await user.type(screen.getByLabelText("Allocate to 09100"), "600.00");
      await user.type(screen.getByLabelText("Allocate to 09500"), "400.00");

      const pendingSave = pendingSaves.at(-1);
      expect(pendingSave).toEqual(expect.any(Function));
      if (!pendingSave) throw new Error("Expected a pending save handler");
      await pendingSave();

      expect(M.saveMutateAsync).toHaveBeenCalledWith({
        invoiceId: "inv-1",
        allocations: [
          { phase_code: "09100", amount: 600.00, description: "Drywall" },
          { phase_code: "09500", amount: 400.00, description: "Painting" },
        ],
      });
    });
  });

  // ── Overage badge ─────────────────────────────────────────────────────

  describe("overage badge", () => {
    beforeEach(() => {
      M.phaseQuery.data = makePhaseOpts();
    });

    it("shows soft overage note (no routing mention) when input exceeds phase remaining", async () => {
      renderPanel();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText("Allocate to 09100"), "7000.00");

      const badge = screen.getByTestId("overage-badge-09100");
      expect(badge).toHaveTextContent(/More than this phase's remaining/);
      expect(badge).toHaveTextContent("$6,500.00");
      // SOFT tier never mentions routing.
      expect(badge).not.toHaveTextContent(/routing/i);
    });

    it("does NOT show overage badge when input is within remaining", async () => {
      renderPanel();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText("Allocate to 09100"), "5000.00");

      expect(screen.queryByTestId("overage-badge-09100")).not.toBeInTheDocument();
    });
  });

  // ── bid_item absent → no crash ─────────────────────────────────────────

  it("renders without crashing when bid_item is absent", () => {
    M.phaseQuery.data = makePhaseOpts({
      phaseRows: [
        { row_index: 0, phase_code: "09100", cost_type: "L", description: "Drywall", original_amount: 20000, amount_billed: 15000, remaining_amount: 5000 },
        { row_index: 1, phase_code: "09100", cost_type: "M", description: "Drywall SCO", original_amount: 3000, amount_billed: 3000, remaining_amount: 0 },
      ],
      phases: [
        { phase_code: "09100", cost_type: "L", description: "Drywall", original_amount: 23000, amount_billed: 18000, remaining_amount: 5000 },
      ],
      distinctPhaseCount: 1,
    });

    renderPanel();
    const details = screen.getByTestId("phase-details-09100");
    expect(within(details).getAllByText("—")).toHaveLength(2);
  });

  // ── CO-corrected math + warning tiers (scenario matrix) ────────────────────

  describe("CO-corrected math + warning tiers", () => {
    function extractedWithAmount(amount: number): Partial<Invoice> {
      return {
        extracted: {
          vendorName: "Vendor",
          vendorAddress: null,
          invoiceNumber: "INV-001",
          invoiceDate: "2026-06-01",
          dueDate: null,
          amount,
          jobNumber: "26-430",
          projectName: null,
          description: null,
          lineItems: [],
        },
      };
    }

    // Exact 2vqi/26-430.01 fixture: a $3,250 CO on a 0-contract 09100 line, whose
    // contract value lives only in header.revContract. 09510 is fully billed.
    function makeTwoVqiOpts(overrides?: Partial<PhaseOptionsResponse>): PhaseOptionsResponse {
      return makePhaseOpts({
        subcontractNumber: "26-430.01",
        invoiceAmount: 3924,
        header: { vendorCode: "V2", vendorName: "Concrete Co", revContract: 18186, totalBilled: 14262, unbilled: 3924 },
        exceedsUnbilled: false,
        overageAmount: 0,
        distinctPhaseCount: 2,
        phaseRowCount: 3,
        phaseRows: [
          { row_index: 0, phase_code: "09100", cost_type: "L", description: "Concrete", original_amount: 9936, amount_billed: 6012, remaining_amount: 3924 },
          { row_index: 1, phase_code: "09100", cost_type: "L", description: "Concrete CO #1", original_amount: 0, amount_billed: 3250, remaining_amount: -3250 },
          { row_index: 2, phase_code: "09510", cost_type: "L", description: "Rebar", original_amount: 5000, amount_billed: 5000, remaining_amount: 0 },
        ],
        phases: [
          { phase_code: "09100", cost_type: "L", description: "Concrete", original_amount: 9936, amount_billed: 9262, remaining_amount: 674 },
          { phase_code: "09510", cost_type: "L", description: "Rebar", original_amount: 5000, amount_billed: 5000, remaining_amount: 0 },
        ],
        ...overrides,
      });
    }

    it("scenario 2 (2vqi): renders 09100 Remaining $3,924.00 (not the naive $674.00) with a CO footnote", () => {
      M.phaseQuery.data = makeTwoVqiOpts();
      renderPanel(extractedWithAmount(3924));

      const remaining = screen.getByTestId("phase-remaining-09100");
      expect(remaining).toHaveTextContent("$3,924.00");
      expect(remaining).not.toHaveTextContent("$674.00");
      expect(screen.getByTestId("co-footnote-09100")).toHaveTextContent(
        /Includes \$3,250\.00 in change orders/,
      );
    });

    it("scenario 2: a $3,924 allocation to 09100 shows NO warning (equals corrected remaining)", async () => {
      M.phaseQuery.data = makeTwoVqiOpts();
      renderPanel(extractedWithAmount(3924));
      const user = userEvent.setup();

      await user.type(screen.getByLabelText("Allocate to 09100"), "3924.00");

      expect(screen.queryByTestId("overage-badge-09100")).not.toBeInTheDocument();
      expect(screen.queryByTestId("subcontract-overage-warning")).not.toBeInTheDocument();
    });

    it("scenario 2: 09510 is fully billed → $0.00, de-emphasized, input disabled/overridable", () => {
      M.phaseQuery.data = makeTwoVqiOpts();
      renderPanel(extractedWithAmount(3924));

      expect(screen.getByTestId("phase-group-09510")).toHaveAttribute("data-fully-billed", "true");
      expect(screen.getByTestId("phase-remaining-09510")).toHaveTextContent("$0.00");
      expect(screen.getByLabelText("Allocate to 09510")).toBeDisabled();
      expect(screen.getByTestId("override-toggle-09510")).toBeInTheDocument();
    });

    it("scenario 5: Override unlocks a fully-billed phase input", async () => {
      M.phaseQuery.data = makeTwoVqiOpts();
      renderPanel(extractedWithAmount(3924));
      const user = userEvent.setup();

      expect(screen.getByLabelText("Allocate to 09510")).toBeDisabled();
      await user.click(screen.getByTestId("override-toggle-09510"));
      const input = screen.getByLabelText("Allocate to 09510");
      expect(input).toBeEnabled();
      await user.type(input, "100.00");
      expect(input).toHaveValue("100.00");
    });

    it("Fill from remaining seeds 09100 with the whole invoice and never auto-saves", async () => {
      M.phaseQuery.data = makeTwoVqiOpts();
      renderPanel(extractedWithAmount(3924));
      const user = userEvent.setup();

      await user.click(screen.getByTestId("fill-from-remaining"));

      expect(screen.getByLabelText("Allocate to 09100")).toHaveValue("3924.00");
      expect(M.saveMutateAsync).not.toHaveBeenCalled();
    });

    it("scenario 4: exceedsUnbilled → RED subcontract warning naming routing; per-phase soft note suppressed", async () => {
      M.phaseQuery.data = makePhaseOpts({
        exceedsUnbilled: true,
        overageAmount: 500,
        header: { vendorCode: "V001", vendorName: "Test Vendor", revContract: 40000, totalBilled: 39500, unbilled: 500 },
      });
      renderPanel(); // invoice 1000 > unbilled 500
      const user = userEvent.setup();

      const warning = screen.getByTestId("subcontract-overage-warning");
      expect(warning).toHaveTextContent(/Exceeds subcontract unbilled/);
      expect(warning).toHaveTextContent("$500.00");
      expect(warning).toHaveTextContent(/PM routing will be required/);

      await user.type(screen.getByLabelText("Allocate to 09100"), "7000.00");
      expect(screen.queryByTestId("overage-badge-09100")).not.toBeInTheDocument();
    });

    it("scenario 3: phase over remaining but NOT exceedsUnbilled → soft note only, no red warning", async () => {
      M.phaseQuery.data = makePhaseOpts(); // reconciled default, exceedsUnbilled false
      renderPanel();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText("Allocate to 09100"), "7000.00");

      expect(screen.getByTestId("overage-badge-09100")).toBeInTheDocument();
      expect(screen.queryByTestId("subcontract-overage-warning")).not.toBeInTheDocument();
    });

    it("scenario 6: Save stays disabled until allocations sum to the invoice total", async () => {
      M.phaseQuery.data = makePhaseOpts();
      renderPanel(); // invoice 1000
      const user = userEvent.setup();

      await user.type(screen.getByLabelText("Allocate to 09100"), "600.00");
      expect(screen.getByRole("button", { name: "Save Allocation" })).toBeDisabled();

      await user.type(screen.getByLabelText("Allocate to 09500"), "400.00");
      expect(screen.getByRole("button", { name: "Save Allocation" })).toBeEnabled();
    });

    it("scenario 8: unattributable CO discrepancy → reconcile footnote, naive remaining kept", () => {
      M.phaseQuery.data = makePhaseOpts({
        header: { vendorCode: "V001", vendorName: "Test Vendor", revContract: 50000, totalBilled: 26500, unbilled: 23500 },
      });
      renderPanel();

      expect(screen.getByTestId("co-unattributable-note")).toBeInTheDocument();
      expect(screen.getByTestId("phase-remaining-09100")).toHaveTextContent("$6,500.00");
    });
  });

  // ── Phase-options rekey on subcontract/job correction (QA 4.15) ─────────────

  describe("phase-options rekey on subcontract/job", () => {
    function subMatching(subcontractNumber: string, jobNumber: string): Invoice["matching"] {
      return {
        vendor: null,
        job: { jobNumber, confidence: 1, method: "test" },
        subcontract: { subcontractNumber, confidence: 1, method: "test" },
        sourceInvoiceTotal: 1000,
      };
    }

    it("passes the invoice's matched subcontract and job into usePhaseOptions (the query key)", () => {
      M.phaseQuery.data = makePhaseOpts();
      renderPanel({ matching: subMatching("26-434.05", "26-434") });
      // [invoiceId, enabled, subcontractNumber, jobMatchNumber]
      expect(M.phaseOptionsArgs).toEqual(["inv-1", true, "26-434.05", "26-434"]);
    });

    it("disables the fetch and passes null subcontract/job when the invoice has no match yet", () => {
      M.phaseQuery.data = makePhaseOpts();
      renderPanel({ matching: null });
      // enabled now derives from subcontract PRESENCE (not the multiPhaseCandidate
      // flag), so a no-subcontract invoice does not fetch.
      expect(M.phaseOptionsArgs).toEqual(["inv-1", false, null, null]);
    });

    it("renders the NEW subcontract's phases after a correction (no stale panel state)", () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const ui = (matching: Invoice["matching"]) => (
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <MultiPhaseAllocationPanel invoice={makeInvoice({ matching })} />
          </TooltipProvider>
        </QueryClientProvider>
      );

      // Old subcontract 26-416.07 serves phase 09100.
      M.phaseQuery.data = makePhaseOpts({
        subcontractNumber: "26-416.07",
        distinctPhaseCount: 1,
        phaseRows: [{ row_index: 0, phase_code: "09100", cost_type: "L", description: "Old drywall", original_amount: 1000, amount_billed: 0, remaining_amount: 1000 }],
        phases: [{ phase_code: "09100", cost_type: "L", description: "Old drywall", original_amount: 1000, amount_billed: 0, remaining_amount: 1000 }],
        header: { vendorCode: "V", vendorName: "V", revContract: 1000, totalBilled: 0, unbilled: 1000 },
      });
      const { rerender } = render(ui(subMatching("26-416.07", "31-130")));
      expect(screen.getByTestId("phase-header-09100")).toBeInTheDocument();

      // Corrected → 26-434.05 now serves phase 07200 (backend re-derived on refetch).
      M.phaseQuery.data = makePhaseOpts({
        subcontractNumber: "26-434.05",
        distinctPhaseCount: 1,
        phaseRows: [{ row_index: 0, phase_code: "07200", cost_type: "L", description: "New masonry", original_amount: 2000, amount_billed: 0, remaining_amount: 2000 }],
        phases: [{ phase_code: "07200", cost_type: "L", description: "New masonry", original_amount: 2000, amount_billed: 0, remaining_amount: 2000 }],
        header: { vendorCode: "V", vendorName: "V", revContract: 2000, totalBilled: 0, unbilled: 2000 },
      });
      rerender(ui(subMatching("26-434.05", "26-434")));

      expect(screen.getByTestId("phase-header-07200")).toBeInTheDocument();
      expect(screen.queryByTestId("phase-header-09100")).not.toBeInTheDocument();
    });
  });
});
