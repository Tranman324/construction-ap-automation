import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PANEL_PHASE_SLOW_LOAD_MS,
  canTransitionPanelPhase,
  derivePanelPhase,
  transitionPanelPhase,
  usePanelPhase,
} from "./usePanelPhase";

describe("usePanelPhase", () => {
  afterEach(() => vi.useRealTimers());

  it("exposes the legal ten-state transitions", () => {
    expect(canTransitionPanelPhase("loading", "ready")).toBe(true);
    expect(canTransitionPanelPhase("ready", "loading")).toBe(false);
    expect(transitionPanelPhase("ready", "loading")).toBe("ready");
    expect(canTransitionPanelPhase("error", "retrying")).toBe(true);
    expect(canTransitionPanelPhase("not-found", "ready")).toBe(false);
    expect(canTransitionPanelPhase("stale", "error")).toBe(true);
  });

  it("holds content for the minimum and keeps ready across refetch", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ loading, identity }) => usePanelPhase({ identity, loading, hasContent: !loading, minimumVisibleMs: 150 }),
      { initialProps: { loading: true, identity: "invoice:one" } },
    );
    rerender({ loading: false, identity: "invoice:one" });
    act(() => vi.advanceTimersByTime(149));
    expect(result.current.phase).toBe("loading");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.phase).toBe("ready");
    rerender({ loading: true, identity: "invoice:one" });
    expect(result.current.phase).toBe("ready");
  });

  it("resets identity, announces slow loads, recovers from hidden tabs, and cleans up", () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const onSlowLoad = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ loading, identity, hasContent }) => usePanelPhase({ identity, loading, hasContent, onSlowLoad }),
      { initialProps: { loading: true, identity: "invoice:one", hasContent: false } },
    );
    act(() => vi.advanceTimersByTime(PANEL_PHASE_SLOW_LOAD_MS));
    expect(result.current.slowLoading).toBe(true);
    expect(onSlowLoad).toHaveBeenCalledOnce();
    rerender({ loading: false, identity: "invoice:two", hasContent: true });
    expect(result.current.identity).toBe("invoice:two");
    expect(result.current.phase).toBe("loading");
    act(() => vi.advanceTimersByTime(150));
    expect(result.current.phase).toBe("loading");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(150));
    expect(result.current.phase).toBe("ready");
    unmount();
    act(() => vi.runOnlyPendingTimers());
    expect(onSlowLoad).toHaveBeenCalledOnce();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("derives an unhappy target immediately when identity changes", async () => {
    const { result, rerender } = renderHook(
      ({ identity, isError }) => usePanelPhase({
        identity,
        loading: false,
        hasContent: !isError,
        isError,
        errorStatus: isError ? 404 : null,
        minimumVisibleMs: 0,
      }),
      { initialProps: { identity: "invoice:one", isError: false } },
    );
    expect(result.current.phase).toBe("ready");
    await act(async () => {
      rerender({ identity: "invoice:two", isError: true });
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("not-found");
  });
});

describe("derivePanelPhase", () => {
  it("derives each state in priority order", () => {
    expect(derivePanelPhase({ loading: true, hasContent: false, isError: true })).toBe("loading");
    expect(derivePanelPhase({ loading: false, hasContent: true })).toBe("ready");
    expect(derivePanelPhase({ loading: false, hasContent: true, isError: true })).toBe("error");
    expect(derivePanelPhase({ loading: false, hasContent: false, isError: true, errorStatus: 404 })).toBe("not-found");
    expect(derivePanelPhase({ loading: false, hasContent: false, isError: true, errorStatus: 403 })).toBe("unauthorized");
    expect(derivePanelPhase({ loading: false, hasContent: false, isError: true, isTimeout: true })).toBe("timeout");
    expect(derivePanelPhase({ loading: false, hasContent: false, isOffline: true })).toBe("offline");
    expect(derivePanelPhase({ loading: false, hasContent: true, isRetrying: true })).toBe("retrying");
    expect(derivePanelPhase({ loading: false, hasContent: true, isStale: true })).toBe("stale");
    expect(derivePanelPhase({ loading: false, hasContent: true, isEmpty: true })).toBe("empty");
    expect(derivePanelPhase({ loading: false, hasContent: false })).toBe("not-found");
  });
});
