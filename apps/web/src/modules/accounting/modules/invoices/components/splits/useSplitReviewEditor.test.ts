import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSplitReviewEditor } from "@/modules/accounting/modules/invoices/components/splits/useSplitReviewEditor";

describe("useSplitReviewEditor", () => {
  it("creates manual split state and applies cut points", () => {
    const { result } = renderHook(() => useSplitReviewEditor(3));

    act(() => result.current.startWithSingleDocument());
    expect(result.current.state?.groups.map((group) => group.pages)).toEqual([[1, 2, 3]]);
    expect(result.current.validation.valid).toBe(false);

    act(() => result.current.handleToggleCut(2));
    expect(result.current.state?.groups.map((group) => group.pages)).toEqual([[1], [2, 3]]);
    expect(result.current.validation.valid).toBe(true);
  });

  it("blocks split confirmation for single-page documents", () => {
    const { result } = renderHook(() => useSplitReviewEditor(1));

    act(() => result.current.startWithSingleDocument());

    expect(result.current.validation.valid).toBe(false);
    expect(result.current.validation.errors).toContain("Single-page documents cannot be split");
  });
});
