import { act, render, renderHook } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clampSplitWidth,
  SPLIT_WIDTH_DEFAULT,
  SPLIT_WIDTH_MAX,
  SPLIT_WIDTH_MIN,
  SPLIT_WIDTH_STORAGE_KEY,
  useSplitWidth,
} from "@/modules/accounting/modules/invoices/components/documents/useSplitWidth";

describe("useSplitWidth", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clamps the full boundary and adjacent values", () => {
    expect(clampSplitWidth(Number.NaN)).toBe(SPLIT_WIDTH_DEFAULT);
    expect(clampSplitWidth(SPLIT_WIDTH_MIN - 1)).toBe(SPLIT_WIDTH_MIN);
    expect(clampSplitWidth(SPLIT_WIDTH_MIN)).toBe(SPLIT_WIDTH_MIN);
    expect(clampSplitWidth(SPLIT_WIDTH_MIN + 1)).toBe(SPLIT_WIDTH_MIN + 1);
    expect(clampSplitWidth(SPLIT_WIDTH_MAX - 1)).toBe(SPLIT_WIDTH_MAX - 1);
    expect(clampSplitWidth(SPLIT_WIDTH_MAX)).toBe(SPLIT_WIDTH_MAX);
    expect(clampSplitWidth(SPLIT_WIDTH_MAX + 1)).toBe(SPLIT_WIDTH_MAX);
  });

  it.each([
    [null, SPLIT_WIDTH_DEFAULT],
    ["not-a-number", SPLIT_WIDTH_DEFAULT],
    ["10", SPLIT_WIDTH_MIN],
    ["80", SPLIT_WIDTH_MAX],
    ["62", 62],
  ])("reads and clamps stored value %s", (stored, expected) => {
    if (stored !== null) window.localStorage.setItem(SPLIT_WIDTH_STORAGE_KEY, stored);
    const { result } = renderHook(() => useSplitWidth());
    expect(result.current.width).toBe(expected);
    expect(result.current.containerStyle["--split-doc-width"]).toBe(`${expected}%`);
  });

  it("persists one shared value and re-clamps on container resize", () => {
    let resizeCallback: (() => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resizeCallback = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    let api: ReturnType<typeof useSplitWidth> | undefined;
    const onReady = vi.fn((value: ReturnType<typeof useSplitWidth>) => { api = value; });
    function Harness({ ready }: { ready: (value: ReturnType<typeof useSplitWidth>) => void }) {
      const current = useSplitWidth();
      useEffect(() => ready(current), [current, ready]);
      return createElement("div", { ref: current.containerRef });
    }
    const { unmount } = render(createElement(Harness, { ready: onReady }));
    act(() => api?.setWidth(63));
    expect(window.localStorage.getItem(SPLIT_WIDTH_STORAGE_KEY)).toBe("63");
    expect(api?.width).toBe(63);
    expect(observe).toHaveBeenCalledTimes(1);
    act(() => resizeCallback?.());
    expect(api?.width).toBe(63);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
