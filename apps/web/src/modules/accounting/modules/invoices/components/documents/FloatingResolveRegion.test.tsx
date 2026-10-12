import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatingResolveRegion } from "./FloatingResolveRegion";

describe("floating resolve region", () => {
  afterEach(() => vi.restoreAllMocks());
  it("tracks actual overlay height and releases clearance when removed", () => {
    let onResize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { onResize = callback; } observe() {} disconnect = disconnect; });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 180 } as DOMRect);
    const view = render(<FloatingResolveRegion tray={<div>Warning</div>}><input aria-label="Last field" /></FloatingResolveRegion>);
    const shell = screen.getByTestId("floating-resolve-region");
    expect(shell.style.getPropertyValue("--resolve-tray-height")).toBe("180px");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 50 } as DOMRect);
    act(() => onResize());
    expect(shell.style.getPropertyValue("--resolve-tray-height")).toBe("50px");
    view.rerender(<FloatingResolveRegion><input aria-label="Last field" /></FloatingResolveRegion>);
    expect(shell.style.getPropertyValue("--resolve-tray-height")).toBe("0px");
    expect(document.querySelector('[data-region="resolve-tray"]')).toBeNull();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("offsets the overlay's right edge by the scroll container's scrollbar width and re-measures on resize", () => {
    let onResize = () => {};
    const observed: Element[] = [];
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { onResize = callback; } observe(node: Element) { observed.push(node); } disconnect() {} });
    const scrollRef = createRef<HTMLDivElement>();
    render(<FloatingResolveRegion scrollRef={scrollRef} tray={<div>Warning</div>}><div ref={scrollRef} data-testid="scroller"><p>Body</p></div></FloatingResolveRegion>);
    const shell = screen.getByTestId("floating-resolve-region");
    const scroller = screen.getByTestId("scroller");
    const overlay = document.querySelector('[data-region="resolve-tray"]');
    expect(overlay).toHaveClass("left-0", "right-[var(--resolve-tray-scrollbar,0px)]");
    expect(overlay).not.toHaveClass("inset-x-0");
    expect(shell.style.getPropertyValue("--resolve-tray-scrollbar")).toBe("0px");
    expect(observed).toEqual(expect.arrayContaining([scroller, screen.getByText("Body")]));

    vi.spyOn(scroller, "offsetWidth", "get").mockReturnValue(420);
    vi.spyOn(scroller, "clientWidth", "get").mockReturnValue(405);
    act(() => onResize());
    expect(shell.style.getPropertyValue("--resolve-tray-scrollbar")).toBe("15px");

    vi.spyOn(scroller, "clientWidth", "get").mockReturnValue(420);
    act(() => onResize());
    expect(shell.style.getPropertyValue("--resolve-tray-scrollbar")).toBe("0px");
    vi.unstubAllGlobals();
  });
});
