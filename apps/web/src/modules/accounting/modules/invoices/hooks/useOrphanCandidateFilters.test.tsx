import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOrphanCandidateFilters } from "@/modules/accounting/modules/invoices/hooks/useOrphanCandidateFilters";

describe("useOrphanCandidateFilters", () => {
  afterEach(() => vi.useRealTimers());

  it("debounces the server query and resets paging when search text changes", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useOrphanCandidateFilters());

    act(() => result.current.setPage(2));
    act(() => result.current.setQuery("Apex"));

    expect(result.current.params).toEqual({ page: 1 });
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.params).toEqual({ page: 1, q: "Apex" });
  });
});
