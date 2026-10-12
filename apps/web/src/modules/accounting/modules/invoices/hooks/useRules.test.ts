import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeMutationWrapper } from "@/modules/accounting/modules/invoices/hooks/mutations.testUtils";

const apiMocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("@/modules/shared/lib/api", () => ({
  api: apiMocks,
}));

import { useApplyRules, useCreateRule } from "@/modules/accounting/modules/invoices/hooks/useRules";

describe("rule mutations", () => {
  beforeEach(() => {
    apiMocks.post.mockReset();
  });

  it("refreshes invoice lists, navigation, and explicit document details after rules are applied", async () => {
    apiMocks.post.mockResolvedValueOnce({
      matchedInvoices: 2,
      actionsApplied: 2,
      errors: 0,
      durationMs: 25,
    });
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useApplyRules(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ scope: "pending", documentIds: ["invoice-1"] });
    });

    expect(apiMocks.post).toHaveBeenCalledWith("/api/rules/apply", {
      scope: "pending",
      documentIds: ["invoice-1"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice-neighbors"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "invoice-1"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["stats"] });
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["trash"] });
  });

  it("refreshes the active document detail after an atomic create-and-apply", async () => {
    apiMocks.post.mockResolvedValueOnce({
      rule: { id: "rule-1" },
      applied: { matchedInvoices: 1, actionsApplied: 1 },
      sourceOutcome: { id: "invoice-1", matched: true, status: "discarded" },
    });
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateRule(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        name: "Discard sender",
        isActive: true,
        criteria: [],
        actions: [{ type: "auto_discard" }],
        apply: true,
        documentIds: ["invoice-1"],
        sourceDocumentId: "invoice-1",
      });
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["invoice", "invoice-1"] });
  });
});
