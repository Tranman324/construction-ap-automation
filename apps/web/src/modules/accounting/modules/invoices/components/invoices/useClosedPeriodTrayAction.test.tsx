import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useClosedPeriodTrayAction } from "./useClosedPeriodTrayAction";
import type { ClosedPeriodTrayAction } from "./invoiceResolveModel";

const recovery = { invoiceDateMonth: "2026-07", currentMonth: "2026-08", suggestedInvoiceDate: "2026-08-01" };
describe("useClosedPeriodTrayAction", () => {
  it("publishes stable presentation state, updates handlers, and clears on unmount", () => {
    let action: ClosedPeriodTrayAction | null = null;
    const onChange = vi.fn((value: ClosedPeriodTrayAction | null) => { action = value; });
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ run }) => useClosedPeriodTrayAction("a", recovery, false, run, onChange), { initialProps: { run: first } });
    const published = action as ClosedPeriodTrayAction | null;
    expect(published?.recovery).toEqual(recovery);
    rerender({ run: second });
    expect(onChange).toHaveBeenCalledTimes(1);
    published?.onUseSuggestedDate();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    unmount();
    expect(onChange).toHaveBeenLastCalledWith(null);
    published?.onUseSuggestedDate();
    expect(second).toHaveBeenCalledTimes(1);
  });
  it("rejects stale invoice callbacks and disabled actions, then clears absent recovery", () => {
    let action: ClosedPeriodTrayAction | null = null;
    const onChange = (value: ClosedPeriodTrayAction | null) => { action = value; };
    const run = vi.fn();
    const { rerender } = renderHook(({ id, disabled, present }) => useClosedPeriodTrayAction(id, present ? recovery : null, disabled, run, onChange),
      { initialProps: { id: "a", disabled: false, present: true } });
    const old = action as ClosedPeriodTrayAction | null;
    rerender({ id: "b", disabled: false, present: true });
    old?.onUseSuggestedDate();
    expect(run).not.toHaveBeenCalled();
    rerender({ id: "a", disabled: false, present: true });
    old?.onUseSuggestedDate();
    expect(run).not.toHaveBeenCalled();
    rerender({ id: "b", disabled: true, present: true });
    (action as ClosedPeriodTrayAction | null)?.onUseSuggestedDate();
    expect(run).not.toHaveBeenCalled();
    rerender({ id: "b", disabled: false, present: false });
    expect(action).toBeNull();
  });
});
