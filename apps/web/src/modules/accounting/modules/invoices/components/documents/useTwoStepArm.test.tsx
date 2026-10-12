import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARM_MS, useTwoStepArm } from "./useTwoStepArm";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("useTwoStepArm", () => {
  it("ARM-01 the window is 3000 ms: armed at 2999, null at 3000", () => {
    expect(ARM_MS).toBe(3000);
    const { result } = renderHook(() => useTwoStepArm(vi.fn()));
    act(() => result.current.press("bypass"));
    tick(2999);
    expect(result.current.armedId).toBe("bypass");
    tick(1);
    expect(result.current.armedId).toBeNull();
  });

  it("ARM-02 a second press fires once, disarms and leaves no timer", () => {
    const onFire = vi.fn();
    const { result } = renderHook(() => useTwoStepArm(onFire));
    act(() => result.current.press("bypass"));
    tick(1000);
    act(() => result.current.press("bypass"));
    expect(onFire).toHaveBeenCalledExactlyOnceWith("bypass");
    expect(result.current.armedId).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    tick(10_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("ARM-03 after firing, the next press re-arms instead of firing again", () => {
    const onFire = vi.fn();
    const { result } = renderHook(() => useTwoStepArm(onFire));
    act(() => result.current.press("bypass"));
    act(() => result.current.press("bypass"));
    act(() => result.current.press("bypass"));
    expect(result.current.armedId).toBe("bypass");
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("ARM-04 arming B replaces A and B keeps its own full window", () => {
    const onFire = vi.fn();
    const { result } = renderHook(() => useTwoStepArm(onFire));
    act(() => result.current.press("discard"));
    tick(2000);
    act(() => result.current.press("bypass"));
    expect(result.current.armedId).toBe("bypass");
    tick(1000);
    expect(result.current.armedId).toBe("bypass");
    tick(2000);
    expect(result.current.armedId).toBeNull();
    expect(onFire).not.toHaveBeenCalled();
  });

  it("ARM-05 unmount clears the timer and nothing updates afterwards", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useTwoStepArm(vi.fn()));
    act(() => result.current.press("bypass"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    tick(3000);
    expect(error).not.toHaveBeenCalled();
  });

  it("disarm clears the timer and reports null once", () => {
    const onArmedChange = vi.fn();
    const { result } = renderHook(() => useTwoStepArm(vi.fn(), onArmedChange));
    act(() => result.current.press("bypass"));
    act(() => result.current.disarm());
    expect(result.current.armedId).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(onArmedChange.mock.calls).toEqual([["bypass"], [null]]);
  });
});
