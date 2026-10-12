import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";
import type { Rule } from "@/modules/accounting/modules/invoices/types/rules";

const HOOKS = vi.hoisted(() => ({
  createMutateAsync: vi.fn(),
  applyMutateAsync: vi.fn(),
}));

const TOASTS = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: TOASTS,
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/useRules", () => ({
  // Atomic path: create returns { rule, applied } when apply: true.
  useCreateRule: () => ({
    mutateAsync: HOOKS.createMutateAsync,
    isPending: false,
  }),
  useApplyRules: () => ({
    mutateAsync: HOOKS.applyMutateAsync,
    isPending: false,
  }),
  isRuleCreateAndApplyResponse: (v: unknown) =>
    typeof v === "object" && v !== null && "applied" in v && "rule" in v,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", async () => {
  const { SEEDED_RULE_OPTIONS } = await import("@/modules/accounting/modules/invoices/components/settings/ruleOptionsFixture");
  return {
    useRuleOptions: () => ({ data: SEEDED_RULE_OPTIONS, isError: false, isLoading: false }),
    useVendorSearch: () => ({ data: [{ code: "ACME01", name: "ACME Concrete" }], isLoading: false }),
    useJobSearch: () => ({ data: [{ number: "24-101", description: "Test Job", address: "" }], isLoading: false }),
    useJobByNumber: () => ({ data: null }),
    useClassifications: () => ({
      classifications: [{ name: "invoice", label: "Invoice", status: "active" }],
      isLoading: false,
    }),
    usePhaseCodes: () => ({ data: { phase_codes: [], cost_types: [] }, isLoading: false }),
    useGlAccounts: () => ({ data: [], isLoading: false, isError: false }),
    useGlAccountByCode: () => ({ data: null }),
    useRoutingCodes: () => ({ data: { routing_codes: [], pm_to_routing: {} }, isLoading: false }),
  };
});

import { RuleBuilderModal } from "@/modules/accounting/modules/invoices/components/settings/RuleBuilderModal";

const invoice: Invoice = {
  id: "inv-1",
  classification: "invoice",
  confidence: 0.96,
  file: "invoice.pdf",
  email: { from: "ap@acme.test", subject: "ACME invoice 1048", receivedAt: "2026-01-01T00:00:00.000Z" },
  status: "pending",
  queuedAt: "2026-01-01T00:00:00.000Z",
  extracted: {
    vendorName: "ACME Concrete",
    vendorAddress: null,
    invoiceNumber: "1048",
    invoiceDate: null,
    dueDate: null,
    amount: 2840.12,
    jobNumber: "24-101",
    projectName: null,
    description: null,
    lineItems: [],
  },
  matching: {
    vendor: { vendorCode: "ACME01", vendorName: "ACME Concrete", confidence: 0.98, method: "exact" },
    job: { jobNumber: "24-101", confidence: 0.95, method: "exact" },
    subcontract: null,
    sourceInvoiceTotal: null,
  },
  overallConfidence: 0.95,
  splitFrom: null,
  duplicateOf: null,
  reason: null,
  error: null,
  reclassifiedFrom: null,
  reclassifiedAt: null,
};

const savedRule: Rule = {
  id: "rule-1",
  name: "ACME Concrete rule",
  isActive: true,
  order: 0,
  stopOnMatch: true,
  criteria: [{ field: "vendor_name", operator: "equals", values: ["ACME Concrete"] }],
  actions: [{ type: "set_vendor", value: "ACME01" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "Dana",
};

beforeEach(() => {
  HOOKS.createMutateAsync.mockReset();
  HOOKS.applyMutateAsync.mockReset();
  TOASTS.success.mockReset();
  TOASTS.error.mockReset();
  TOASTS.warning.mockReset();
  // Atomic create-and-apply returns { rule, applied } in ONE request.
  HOOKS.createMutateAsync.mockResolvedValue({ rule: savedRule, applied: { matchedInvoices: 1, actionsApplied: 3 } });
});

describe("RuleBuilderModal", () => {
  it("creates and applies an invoice-seeded rule", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <RuleBuilderModal
        open
        onOpenChange={onOpenChange}
        existingRules={[]}
        previewInvoices={[invoice]}
        sourceInvoice={invoice}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(HOOKS.createMutateAsync).toHaveBeenCalled());
    // ONE atomic request carries the rule fields AND the apply selectors.
    expect(HOOKS.createMutateAsync).toHaveBeenCalledTimes(1);
    expect(HOOKS.createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      name: "ACME Concrete rule",
      criteria: [
        { field: "vendor_name", operator: "equals", values: ["ACME Concrete"] },
        { field: "classification", operator: "equals", values: ["invoice"] },
      ],
      apply: true,
      scope: "pending",
      documentIds: ["inv-1"],
      includeScope: true,
      sourceDocumentId: "inv-1",
    }));
    // No separate apply request — the atomic path fires exactly one.
    expect(HOOKS.applyMutateAsync).not.toHaveBeenCalled();
    expect(TOASTS.success).toHaveBeenCalledWith("Rule created & applied", {
      description: "1 matched, 3 actions applied.",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("reports the canonical create-and-apply response to the caller", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const result = {
      rule: savedRule,
      applied: { matchedInvoices: 1, actionsApplied: 3 },
      sourceOutcome: { id: "inv-1", matched: true, status: "pending" },
    };
    HOOKS.createMutateAsync.mockResolvedValueOnce(result);

    render(
      <RuleBuilderModal
        open
        onOpenChange={vi.fn()}
        existingRules={[]}
        previewInvoices={[invoice]}
        sourceInvoice={invoice}
        onSaved={onSaved}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(result));
  });

  it("shows advisory overlap details without blocking creation", async () => {
    const user = userEvent.setup();
    const existingRule: Rule = {
      ...savedRule,
      id: "existing-rule",
      name: "Existing ACME coding",
      criteria: [{ field: "vendor_code", operator: "equals", values: ["ACME01"] }],
      actions: [{ type: "set_phase_code", clear: true }],
    };

    render(
      <RuleBuilderModal
        open
        onOpenChange={vi.fn()}
        existingRules={[existingRule]}
        previewInvoices={[invoice]}
        sourceInvoice={invoice}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Existing ACME coding");
    expect(screen.getByRole("status")).toHaveTextContent("Clear phase code");
    await user.click(screen.getByRole("button", { name: "Create rule" }));
    await waitFor(() => expect(HOOKS.createMutateAsync).toHaveBeenCalled());
  });

  it("still applies an invoice-seeded rule to the source document when broad apply is off", async () => {
    const user = userEvent.setup();

    render(
      <RuleBuilderModal
        open
        onOpenChange={vi.fn()}
        existingRules={[]}
        previewInvoices={[invoice]}
        sourceInvoice={invoice}
      />,
    );

    await user.click(screen.getByRole("switch", { name: "Apply to existing invoices" }));
    expect(screen.getByText("Applies to this document and future documents")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create rule" }));

    // Still ONE atomic request; the source document is targeted with includeScope: false.
    await waitFor(() => expect(HOOKS.createMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      apply: true,
      scope: "pending",
      documentIds: ["inv-1"],
      includeScope: false,
      sourceDocumentId: "inv-1",
    })));
    expect(HOOKS.applyMutateAsync).not.toHaveBeenCalled();
  });

  it("surfaces an atomic create-and-apply failure without creating an orphan rule", async () => {
    const user = userEvent.setup();
    // The atomic transaction rolls back on failure — there is no separate apply
    // request and no 'retry application' state (the old two-step orphan path is gone).
    HOOKS.createMutateAsync.mockRejectedValueOnce(new Error("Apply unavailable"));

    render(
      <RuleBuilderModal
        open
        onOpenChange={vi.fn()}
        existingRules={[]}
        previewInvoices={[invoice]}
        sourceInvoice={invoice}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(TOASTS.error).toHaveBeenCalledWith("Failed to create and apply rule", {
      description: "Apply unavailable",
    }));
    expect(HOOKS.createMutateAsync).toHaveBeenCalledTimes(1);
    expect(HOOKS.applyMutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry application" })).not.toBeInTheDocument();
    // The button stays "Create rule" — no orphan, no retry state.
    expect(screen.getByRole("button", { name: "Create rule" })).toBeInTheDocument();
  });

  it("ignores a second submission while the atomic create-and-apply is in flight", async () => {
    const user = userEvent.setup();
    let resolveCreate: (value: { rule: Rule; applied: { matchedInvoices: number; actionsApplied: number } }) => void = () => undefined;
    HOOKS.createMutateAsync.mockReturnValueOnce(new Promise((resolve) => {
      resolveCreate = resolve;
    }));

    render(
      <RuleBuilderModal
        open
        onOpenChange={vi.fn()}
        existingRules={[]}
        previewInvoices={[invoice]}
        sourceInvoice={invoice}
      />,
    );

    await user.dblClick(screen.getByRole("button", { name: "Create rule" }));
    // The in-flight guard fires exactly one request despite the double click.
    expect(HOOKS.createMutateAsync).toHaveBeenCalledTimes(1);
    expect(HOOKS.applyMutateAsync).not.toHaveBeenCalled();

    resolveCreate({ rule: savedRule, applied: { matchedInvoices: 1, actionsApplied: 3 } });
    await waitFor(() => expect(TOASTS.success).toHaveBeenCalled());
  });

  it("does not apply a settings-created rule when broad apply is off", async () => {
    const user = userEvent.setup();

    render(
      <RuleBuilderModal
        open
        onOpenChange={vi.fn()}
        existingRules={[]}
        previewInvoices={[invoice]}
      />,
    );

    await user.type(screen.getByPlaceholderText("Enter value…"), "ACME");
    await user.click(screen.getByRole("switch", { name: "Apply to existing invoices" }));
    await user.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(HOOKS.createMutateAsync).toHaveBeenCalled());
    expect(HOOKS.applyMutateAsync).not.toHaveBeenCalled();
  });
});
