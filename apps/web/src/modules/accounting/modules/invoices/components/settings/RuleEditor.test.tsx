import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import type { Rule } from "@/modules/accounting/modules/invoices/types/rules";

const HTTP = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
}));

const TEST_STATE = vi.hoisted(() => ({
  ruleOptionsError: false,
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

vi.mock("@/modules/shared/lib/api", () => ({
  api: {
    post: HTTP.post,
    patch: HTTP.patch,
  },
}));

vi.mock("@/modules/accounting/modules/invoices/hooks/queries", async () => {
  const { SEEDED_RULE_OPTIONS } = await import("@/modules/accounting/modules/invoices/components/settings/ruleOptionsFixture");
  return {
    useRuleOptions: () =>
      TEST_STATE.ruleOptionsError
        ? { data: undefined, isError: true, isLoading: false }
        : { data: SEEDED_RULE_OPTIONS, isError: false, isLoading: false },
    useClassifications: () => ({
      classifications: [
        { name: "invoice", label: "Invoice", opensAs: "invoice", action: "extract-match", builtIn: true, status: "active" },
      ],
      isLoading: false,
    }),
  };
});

import { RuleEditor } from "@/modules/accounting/modules/invoices/components/settings/RuleEditor";

const savedRule: Rule = {
  id: "rule-1",
  name: "ACME rule",
  isActive: true,
  order: 0,
  stopOnMatch: false,
  criteria: [{ field: "vendor_name", operator: "contains", values: ["ACME"] }],
  actions: [{ type: "hide_from_queue" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "Dana",
};

async function completeNewRule(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("Give this rule a descriptive name…"), "ACME rule");
  await user.type(screen.getByPlaceholderText("Enter value…"), "ACME");
}

function renderEditor(props: ComponentProps<typeof RuleEditor>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RuleEditor {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  TEST_STATE.ruleOptionsError = false;
  HTTP.post.mockReset();
  HTTP.patch.mockReset();
  HTTP.post.mockImplementation((path: string) => Promise.resolve(
    path === "/api/rules/apply"
      ? { matchedInvoices: 1, actionsApplied: 1 }
      : savedRule,
  ));
  HTTP.patch.mockResolvedValue(savedRule);
});

describe("RuleEditor", () => {
  it("blocks the builder with an explicit message when rule options fail to load", () => {
    TEST_STATE.ruleOptionsError = true;
    renderEditor({ open: true, onOpenChange: vi.fn() });

    expect(screen.getByText("Rule options unavailable — try again")).toBeInTheDocument();
    expect(screen.queryByText("When invoice matches all of…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save rule" })).not.toBeInTheDocument();
  });

  it("renders the builder body when rule options are available", () => {
    renderEditor({ open: true, onOpenChange: vi.fn() });

    expect(screen.getByText("When invoice matches all of…")).toBeInTheDocument();
    expect(screen.queryByText("Rule options unavailable — try again")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save rule" })).toBeInTheDocument();
  });

  it("creates and applies a new rule with one atomic request and no follow-up apply", async () => {
    const user = userEvent.setup();
    HTTP.post.mockResolvedValueOnce({
      rule: savedRule,
      applied: { matchedInvoices: 2, actionsApplied: 3 },
    });
    renderEditor({ open: true, onOpenChange: vi.fn() });

    await completeNewRule(user);
    await user.click(screen.getByRole("checkbox", { name: "Apply to existing invoices" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(HTTP.post).toHaveBeenCalledTimes(1));
    expect(HTTP.post).toHaveBeenCalledWith("/api/rules", expect.objectContaining({
      name: "ACME rule",
      apply: true,
      scope: "pending",
    }));
    expect(HTTP.post).not.toHaveBeenCalledWith("/api/rules/apply", expect.anything());
    expect(screen.getByText("Rule applied — 2 invoices matched, 3 actions applied.")).toBeInTheDocument();
  });

  it("surfaces an atomic create-and-apply failure without retrying application", async () => {
    const user = userEvent.setup();
    HTTP.post.mockRejectedValueOnce(new Error("Apply unavailable"));
    renderEditor({ open: true, onOpenChange: vi.fn() });

    await completeNewRule(user);
    await user.click(screen.getByRole("checkbox", { name: "Apply to existing invoices" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(screen.getByText("Apply unavailable")).toBeInTheDocument());
    expect(HTTP.post).toHaveBeenCalledTimes(1);
    expect(HTTP.post).toHaveBeenCalledWith("/api/rules", expect.objectContaining({
      apply: true,
      scope: "pending",
    }));
    expect(HTTP.post).not.toHaveBeenCalledWith("/api/rules/apply", expect.anything());
    expect(screen.queryByRole("button", { name: "Retry application" })).not.toBeInTheDocument();
  });

  it("makes one new atomic request when the user retries after an atomic failure", async () => {
    const user = userEvent.setup();
    HTTP.post
      .mockRejectedValueOnce(new Error("Apply unavailable"))
      .mockResolvedValueOnce({ rule: savedRule, applied: { matchedInvoices: 1, actionsApplied: 1 } });
    renderEditor({ open: true, onOpenChange: vi.fn() });

    await completeNewRule(user);
    await user.click(screen.getByRole("checkbox", { name: "Apply to existing invoices" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(screen.getByText("Apply unavailable")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(HTTP.post).toHaveBeenCalledTimes(2));
    expect(HTTP.post).toHaveBeenNthCalledWith(1, "/api/rules", expect.objectContaining({ apply: true, scope: "pending" }));
    expect(HTTP.post).toHaveBeenNthCalledWith(2, "/api/rules", expect.objectContaining({ apply: true, scope: "pending" }));
    expect(HTTP.post).not.toHaveBeenCalledWith("/api/rules/apply", expect.anything());
    expect(screen.getByText("Rule applied — 1 invoice matched, 1 action applied.")).toBeInTheDocument();
  });

  it("does not fall back to a separate apply request for an incomplete atomic response", async () => {
    const user = userEvent.setup();
    HTTP.post.mockResolvedValueOnce({ rule: savedRule, applied: {} });
    renderEditor({ open: true, onOpenChange: vi.fn() });

    await completeNewRule(user);
    await user.click(screen.getByRole("checkbox", { name: "Apply to existing invoices" }));
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(screen.getByText("Rule creation did not return an application result.")).toBeInTheDocument());
    expect(HTTP.post).toHaveBeenCalledTimes(1);
    expect(HTTP.post).not.toHaveBeenCalledWith("/api/rules/apply", expect.anything());
  });

  it("issues one atomic request when create-and-apply is double-clicked in flight", async () => {
    const user = userEvent.setup();
    let resolveCreate: (value: { rule: Rule; applied: { matchedInvoices: number; actionsApplied: number } }) => void = () => undefined;
    HTTP.post.mockReturnValueOnce(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    renderEditor({ open: true, onOpenChange: vi.fn() });

    await completeNewRule(user);
    await user.click(screen.getByRole("checkbox", { name: "Apply to existing invoices" }));
    await user.dblClick(screen.getByRole("button", { name: "Save rule" }));

    expect(HTTP.post).toHaveBeenCalledTimes(1);
    expect(HTTP.post).toHaveBeenCalledWith("/api/rules", expect.objectContaining({ apply: true, scope: "pending" }));
    expect(HTTP.post).not.toHaveBeenCalledWith("/api/rules/apply", expect.anything());

    resolveCreate({ rule: savedRule, applied: { matchedInvoices: 1, actionsApplied: 1 } });
    await waitFor(() => expect(screen.getByText("Rule applied — 1 invoice matched, 1 action applied.")).toBeInTheDocument());
  });

  it("creates without apply when retroactive apply is not selected", async () => {
    const user = userEvent.setup();
    renderEditor({ open: true, onOpenChange: vi.fn() });

    await completeNewRule(user);
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(HTTP.post).toHaveBeenCalledTimes(1));
    expect(HTTP.post).toHaveBeenCalledWith("/api/rules", expect.not.objectContaining({ apply: true }));
    expect(HTTP.post).not.toHaveBeenCalledWith("/api/rules/apply", expect.anything());
  });

  it("keeps edit and save on the update request", async () => {
    const user = userEvent.setup();
    renderEditor({ open: true, onOpenChange: vi.fn(), rule: savedRule });

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(HTTP.patch).toHaveBeenCalledWith(
      "/api/rules/rule-1",
      expect.objectContaining({ name: "ACME rule" }),
    ));
    expect(HTTP.post).not.toHaveBeenCalled();
  });

  it("keeps retroactive edit application on the existing apply request", async () => {
    const user = userEvent.setup();
    renderEditor({ open: true, onOpenChange: vi.fn(), rule: savedRule });

    await user.click(screen.getByRole("checkbox", { name: "Apply to existing invoices" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(HTTP.post).toHaveBeenCalledWith("/api/rules/apply", {
      ruleIds: ["rule-1"],
      scope: "pending",
    }));
    expect(HTTP.post).not.toHaveBeenCalledWith("/api/rules", expect.anything());
  });
});
