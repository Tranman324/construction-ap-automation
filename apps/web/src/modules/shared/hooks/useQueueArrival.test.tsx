import { readFileSync } from "node:fs";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useQueueArrival } from "@/modules/shared/hooks/useQueueArrival";

const ids = (count: number) => Array.from({ length: count }, (_, index) => `row-${index}`);

// Mirror the hook's timeout formula so tests stay in sync.
const timeout = (rows: number) => Math.max(rows - 1, 0) * 30 + 150 + 50;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useQueueArrival", () => {
  it("arms only the first populated loading-to-ready edge, then clears after the dynamic timeout", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ loading, rows }) => useQueueArrival(loading, rows),
      { initialProps: { loading: true, rows: [] as string[] } },
    );
    expect(result.current).toBe(0);

    rerender({ loading: false, rows: ids(1) });
    expect(result.current).toBe(1);
    act(() => vi.advanceTimersByTime(timeout(1) - 1));
    expect(result.current).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(0);

    rerender({ loading: false, rows: ids(1) });
    rerender({ loading: true, rows: [] });
    rerender({ loading: false, rows: ids(1) });
    expect(result.current).toBe(0);
  });

  it.each([25, 50, 100])("animates all %i rows with a dynamic timeout", (rows) => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ loading }) => useQueueArrival(loading, ids(rows)),
      { initialProps: { loading: true } },
    );
    rerender({ loading: false });
    expect(result.current).toBe(rows);
    act(() => vi.advanceTimersByTime(timeout(rows) - 1));
    expect(result.current).toBe(rows);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(0);
  });

  it("clears the arm when the first loaded rows are replaced or reordered within the timeout", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ loading, rows }) => useQueueArrival(loading, rows),
      { initialProps: { loading: true, rows: [] as string[] } },
    );
    rerender({ loading: false, rows: ["a", "b"] });
    expect(result.current).toBe(2);
    rerender({ loading: false, rows: ["b", "a"] });
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    rerender({ loading: false, rows: ["new"] });
    expect(result.current).toBe(0);
  });

  it("does not arm a later refetch after an initially ready or empty result", () => {
    const ready = renderHook(({ loading }) => useQueueArrival(loading, ids(1)), {
      initialProps: { loading: false },
    });
    ready.rerender({ loading: true });
    ready.rerender({ loading: false });
    expect(ready.result.current).toBe(0);

    const empty = renderHook(({ loading, rows }) => useQueueArrival(loading, rows), {
      initialProps: { loading: true, rows: [] as string[] },
    });
    empty.rerender({ loading: false, rows: [] });
    empty.rerender({ loading: true, rows: [] });
    empty.rerender({ loading: false, rows: ids(1) });
    expect(empty.result.current).toBe(0);
  });

  it("clears immediately when hidden and cleans the timer and listener on unmount", () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { result, rerender, unmount } = renderHook(
      ({ loading }) => useQueueArrival(loading, ids(1)),
      { initialProps: { loading: true } },
    );
    rerender({ loading: false });
    expect(result.current).toBe(1);
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    visibility.mockReturnValue("visible");
    const second = renderHook(({ loading }) => useQueueArrival(loading, ids(1)), {
      initialProps: { loading: true },
    });
    second.rerender({ loading: false });
    expect(vi.getTimerCount()).toBe(1);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it("keeps queue motion opacity-only, timed, and reduced-motion safe", () => {
    const css = readFileSync("src/modules/shared/components/motion/ActionMotion.module.css", "utf8");
    const arrival = css.match(/@keyframes queue-arrival\s*\{([^}]*\}[^}]*)\}/)?.[1] ?? "";
    expect(arrival).toContain("opacity: 0");
    expect(arrival).toContain("opacity: 1");
    expect(arrival).not.toContain("transform");
    expect(css).toMatch(/animation: queue-arrival var\(--dur-press\) var\(--ease-out\) both/);
    expect(css).toMatch(/animation-delay: calc\(var\(--queue-row-order\) \* 30ms\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.queueArrivalRow\[data-arriving="true"\][\s\S]*animation: none;[\s\S]*opacity: 1/);
    const tokens = readFileSync("src/app/globals.css", "utf8");
    expect(tokens).toMatch(/--dur-press: 150ms/);
  });
});
