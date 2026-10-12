import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Rule } from "@/modules/accounting/modules/invoices/types/rules";

const HOOKS = vi.hoisted(() => ({
  rulesData: { rules: [] as Rule[], total: 0 },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  reorderMutate: vi.fn(),
  applyMutate: vi.fn(),
  invoiceQueryEnabled: [] as boolean[],
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown", () => ({
  JobDropdown: ({ value }: { value: string | null }) => <div>{value}</div>,
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", async () => {
  const { SEEDED_RULE_OPTIONS } = await import("@/modules/accounting/modules/invoices/components/settings/ruleOptionsFixture");
  return {
    useInvoices: (_filters: unknown, options?: { enabled?: boolean }) => {
      HOOKS.invoiceQueryEnabled.push(options?.enabled ?? true);
      return { data: { invoices: [] } };
    },
    useRuleOptions: () => ({ data: SEEDED_RULE_OPTIONS, isError: false, isLoading: false }),
    useClassifications: () => ({
      classifications: [
        { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
      ],
      isLoading: false,
    }),
  };
});

vi.mock("@/modules/accounting/modules/invoices/components/settings/RuleBuilderModal", () => ({
  RuleBuilderModal: ({ open }: { open: boolean }) => (
    open ? <div data-testid="rule-builder-modal">Rule builder modal</div> : null
  ),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/useRules", () => ({
  useRules: () => ({
    data: HOOKS.rulesData,
    isLoading: HOOKS.isLoading,
    isError: HOOKS.isError,
    refetch: HOOKS.refetch,
  }),
  useUpdateRule: () => ({
    mutate: HOOKS.updateMutate,
    isPending: false,
  }),
  useDeleteRule: () => ({
    mutate: HOOKS.deleteMutate,
    isPending: false,
  }),
  useReorderRules: () => ({
    mutate: HOOKS.reorderMutate,
    isPending: false,
  }),
  useApplyRules: () => ({
    mutate: HOOKS.applyMutate,
    isPending: false,
  }),
}));

import { RulesWorkspaceSurface } from "@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceSurface";

const rules: Rule[] = [
  {
    id: "rule-a",
    name: "ACME invoices",
    isActive: true,
    order: 0,
    stopOnMatch: false,
    criteria: [{ field: "vendor_name", operator: "contains", values: ["ACME"] }],
    actions: [{ type: "set_job", value: "24-001" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    createdBy: "Dana",
  },
  {
    id: "rule-b",
    name: "File waivers",
    isActive: false,
    order: 1,
    stopOnMatch: true,
    criteria: [{ field: "classification", operator: "equals", values: ["lien-waiver"] }],
    actions: [{ type: "auto_file" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    createdBy: "Dana",
  },
];

beforeEach(() => {
  HOOKS.rulesData = { rules, total: rules.length };
  HOOKS.isLoading = false;
  HOOKS.isError = false;
  HOOKS.refetch.mockReset();
  HOOKS.updateMutate.mockReset();
  HOOKS.deleteMutate.mockReset();
  HOOKS.reorderMutate.mockReset();
  HOOKS.applyMutate.mockReset();
  HOOKS.invoiceQueryEnabled = [];
});

describe("RulesWorkspaceSurface", () => {
  it("embeds the rules workspace and wires the primary rule actions", async () => {
    const user = userEvent.setup();

    render(<RulesWorkspaceSurface active />);

    expect(screen.getByText("2 rules - 1 active")).toBeInTheDocument();
    expect(HOOKS.invoiceQueryEnabled).toContain(true);

    await user.click(screen.getByRole("button", { name: "Select File waivers" }));
    expect(screen.getByRole("textbox", { name: "Rule name" })).toHaveValue("File waivers");

    await user.click(screen.getByRole("button", { name: "Apply to pending" }));
    expect(HOOKS.applyMutate).toHaveBeenCalledWith(
      { scope: "pending" },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );

    await user.click(screen.getByRole("button", { name: "New rule" }));
    expect(screen.getByTestId("rule-builder-modal")).toBeInTheDocument();
  });

  it("disables preview invoice loading when the pane is hidden", () => {
    render(<RulesWorkspaceSurface active={false} />);

    expect(HOOKS.invoiceQueryEnabled).toContain(false);
  });
});
