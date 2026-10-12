import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeMutationWrapper } from "@/modules/accounting/modules/invoices/hooks/mutations.testUtils";

const DM = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("@/modules/shared/lib/api", () => ({
  api: { post: DM.post, get: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn(), postForm: vi.fn() },
  isApiError: (e: unknown): boolean => typeof e === "object" && e !== null && "status" in e && "message" in e,
}));
vi.mock("@/modules/shared/components/ui/toaster", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/modules/shared/lib/auditEmitter", () => ({ emitAuditEvent: vi.fn() }));
vi.mock("@/modules/shared/lib/auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useDuplicateBypass, useRevertDuplicateBypass } from "./mutations";

// Spec B3 §8: bypass AND revert both refresh the duplicate status, invoice
// collections + detail, the approval verdict, and audit. Sabotage check: drop
// any key from invalidateDuplicateResolution and both cases go red.
const EXPECTED_KEYS = [
  ["duplicate-status", "inv-dup"],
  ["invoice", "inv-dup"],
  ["invoices"],
  ["invoice-neighbors"],
  ["stats"],
  ["trash"],
  ["validate-approval", "inv-dup"],
  ["audit", "inv-dup"],
];

beforeEach(() => DM.post.mockReset());

describe("duplicate bypass mutations", () => {
  it.each([
    ["useDuplicateBypass", useDuplicateBypass, "/api/invoices/inv-dup/duplicate-bypass"],
    ["useRevertDuplicateBypass", useRevertDuplicateBypass, "/api/invoices/inv-dup/duplicate-bypass/revert"],
  ] as const)("%s posts and invalidates every dependent query", async (_name, useHook, url) => {
    DM.post.mockResolvedValueOnce({ duplicateBypassed: true });
    const { queryClient, Wrapper } = makeMutationWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useHook(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: "inv-dup" });
    });

    expect(DM.post).toHaveBeenCalledWith(url);
    for (const queryKey of EXPECTED_KEYS) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey });
    }
  });
});
