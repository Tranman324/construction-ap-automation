import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
    useInvoices: () => ({
      data: { invoices: [] },
    }),
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

import { RulesWorkspaceModal } from "@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceModal";

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
});

describe("RulesWorkspaceModal", () => {
  it("selects rules and wires toggle, reorder, and inline save mutations", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(<RulesWorkspaceModal open onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Select File waivers" }));
    expect(screen.getByRole("textbox", { name: "Rule name" })).toHaveValue("File waivers");

    await user.click(screen.getByRole("switch", { name: "File waivers active" }));
    expect(HOOKS.updateMutate).toHaveBeenCalledWith({
      id: "rule-b",
      payload: { isActive: true },
    });

    await user.click(screen.getByRole("button", { name: "Move ACME invoices down" }));
    expect(HOOKS.reorderMutate).toHaveBeenCalledWith({ ids: ["rule-b", "rule-a"] });

    const nameInput = screen.getByRole("textbox", { name: "Rule name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Waiver filing");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const saveCall = HOOKS.updateMutate.mock.calls.at(-1);
    expect(saveCall?.[0]).toEqual({
      id: "rule-b",
      payload: expect.objectContaining({ name: "Waiver filing" }),
    });
    expect(typeof saveCall?.[1]?.onSuccess).toBe("function");

    await user.click(screen.getByRole("button", { name: "New rule" }));
    expect(screen.getByTestId("rule-builder-modal")).toBeInTheDocument();
  });
});
