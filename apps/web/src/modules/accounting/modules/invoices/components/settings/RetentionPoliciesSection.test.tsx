import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RetentionRule } from "@/modules/accounting/modules/invoices/types/api";

const HOOKS = vi.hoisted(() => ({
  rules: [] as RetentionRule[],
  isLoading: false,
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  ruleOptionsError: false,
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useRetentionRules: () => ({
    data: HOOKS.rules,
    isLoading: HOOKS.isLoading,
  }),
  useClassifications: () => ({
    classifications: [
      { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
      { name: "receipt", label: "Receipt", opensAs: "receipt", action: "extract-match", builtIn: true, status: "active" },
      { name: "coi", label: "Certificate of Insurance", opensAs: "coi", action: "view-only", builtIn: true, status: "active" },
    ],
    isLoading: false,
  }),
  useRuleOptions: () => ({
    data: { actions: [], fields: [], operators: [], statuses: [{ value: "submitted", label: "Submitted" }, { value: "discarded", label: "Discarded" }] },
    isError: HOOKS.ruleOptionsError,
    isLoading: false,
  }),
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/mutations", () => ({
  useCreateRetentionRule: () => ({
    mutate: HOOKS.createMutate,
    isPending: false,
  }),
  useUpdateRetentionRule: () => ({
    mutate: HOOKS.updateMutate,
    isPending: false,
  }),
  useDeleteRetentionRule: () => ({
    mutate: HOOKS.deleteMutate,
    isPending: false,
  }),
}));

import { RetentionPoliciesSection } from "@/modules/accounting/modules/invoices/components/settings/RetentionPoliciesSection";

const rules: RetentionRule[] = [
  {
    id: 1,
    classification: "*",
    status: "submitted",
    retentionDays: 30,
    deletePdf: true,
    deleteBox: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "System",
    appliesTo: "submitted",
  },
  {
    id: 2,
    classification: "coi",
    status: "discarded",
    retentionDays: 90,
    deletePdf: true,
    deleteBox: false,
    updatedAt: "2026-01-02T00:00:00.000Z",
    updatedBy: "Dana",
    appliesTo: "coi discarded",
  },
];

beforeEach(() => {
  HOOKS.rules = rules;
  HOOKS.isLoading = false;
  HOOKS.createMutate.mockReset();
  HOOKS.updateMutate.mockReset();
  HOOKS.deleteMutate.mockReset();
  HOOKS.ruleOptionsError = false;
});

describe("RetentionPoliciesSection", () => {
  it("blocks duplicate classification/status rules before create", async () => {
    const user = userEvent.setup();
    render(<RetentionPoliciesSection />);

    await user.click(screen.getAllByRole("button", { name: "Add Rule" })[0]);
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByText("A rule for this classification and status already exists.")).toBeInTheDocument();
    expect(HOOKS.createMutate).not.toHaveBeenCalled();
  });

  it("locks wildcard deletion while allowing wildcard edits with clamped days", async () => {
    const user = userEvent.setup();
    render(<RetentionPoliciesSection />);

    expect(screen.getByTitle("Default retention rule cannot be deleted")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Edit retention rule" })[0]);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: "Save retention rule" }));

    const updateCall = HOOKS.updateMutate.mock.calls[0];
    expect(updateCall[0]).toEqual({
      id: 1,
      payload: { retention_days: 1, delete_pdf: true, delete_box: true },
    });
    expect(typeof updateCall[1].onSuccess).toBe("function");
  });

  it("creates non-duplicate rules with snake-case payload fields", async () => {
    const user = userEvent.setup();
    render(<RetentionPoliciesSection />);

    await user.click(screen.getAllByRole("button", { name: "Add Rule" })[0]);
    await user.selectOptions(screen.getByLabelText("Classification"), "receipt");
    await user.selectOptions(screen.getByLabelText("Status"), "discarded");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const createCall = HOOKS.createMutate.mock.calls[0];
    expect(createCall[0]).toEqual({
      classification: "receipt",
      status: "discarded",
      retention_days: 30,
      delete_pdf: true,
      delete_box: true,
    });
    expect(typeof createCall[1].onSuccess).toBe("function");
  });

  it("shows an unavailable state instead of local retention statuses when rule options fail", () => {
    HOOKS.ruleOptionsError = true;
    render(<RetentionPoliciesSection />);

    expect(screen.getByText("Retention status options unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Submitted")).not.toBeInTheDocument();
  });
});
