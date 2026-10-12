import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RouteLifecycleFrame, useRouteLifecycle } from "./routeLifecycle";

function Harness({ identity = "invoice:one" }: { identity?: string }) {
  const lifecycle = useRouteLifecycle(identity);
  return (
    <RouteLifecycleFrame lifecycle={lifecycle}>
      <button type="button" onClick={() => void lifecycle.runControlledNavigation(() => undefined)}>
        Navigate
      </button>
    </RouteLifecycleFrame>
  );
}

describe("route lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("arms same-batch entry, clears it after 20ms, and reaches visible ready rest", () => {
    render(<Harness />);
    const route = document.querySelector(".tbx-route-detail");
    expect(route).toHaveAttribute("data-entering", "");
    expect(route).toHaveAttribute("data-phase", "loading");

    act(() => vi.advanceTimersByTime(20));

    expect(route).not.toHaveAttribute("data-entering");
    expect(route).toHaveAttribute("data-phase", "ready");
  });

  it("drops entry immediately when the document becomes hidden", () => {
    render(<Harness />);
    const route = document.querySelector(".tbx-route-detail");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });

    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(route).not.toHaveAttribute("data-entering");
    expect(route).toHaveAttribute("data-phase", "ready");
  });

  it("holds controlled navigation for 140ms and does not run a cancelled action", async () => {
    const action = vi.fn();
    function ActionHarness() {
      const lifecycle = useRouteLifecycle("invoice:one");
      return <button type="button" onClick={() => void lifecycle.runControlledNavigation(action)}>Navigate</button>;
    }

    render(<ActionHarness />);
    await act(async () => { screen.getByRole("button", { name: "Navigate" }).click(); });
    expect(action).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(139));
    expect(action).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(action).toHaveBeenCalledOnce();
  });

  it("cancels entry and exit timers on unmount", async () => {
    const action = vi.fn();
    function ActionHarness() {
      const lifecycle = useRouteLifecycle("invoice:one");
      return <button type="button" onClick={() => void lifecycle.runControlledNavigation(action)}>Navigate</button>;
    }

    const view = render(<ActionHarness />);
    await act(async () => { screen.getByRole("button", { name: "Navigate" }).click(); });
    view.unmount();
    act(() => vi.runAllTimers());
    expect(action).not.toHaveBeenCalled();
  });
});
