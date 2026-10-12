import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type CSSProperties, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { SplitResizer } from "@/modules/accounting/modules/invoices/components/documents/SplitResizer";

function Harness({ children, width = 50, onWidthChange = vi.fn() }: { children?: ReactNode; width?: number; onWidthChange?: (value: number) => void }) {
  const containerRef = createRef<HTMLDivElement>();
  return (
    <div ref={containerRef} style={{ "--split-doc-width": `${width}%` } as CSSProperties}>
      {children}
      <SplitResizer containerRef={containerRef} width={width} onWidthChange={onWidthChange} label="Resize panels" />
    </div>
  );
}

describe("SplitResizer", () => {
  it("exposes separator semantics and moves by two percent with the keyboard", () => {
    const onWidthChange = vi.fn();
    render(<Harness onWidthChange={onWidthChange} />);
    const handle = screen.getByRole("separator", { name: "Resize panels" });

    expect(handle).toHaveAttribute("aria-valuemin", "26");
    expect(handle).toHaveAttribute("aria-valuemax", "74");
    expect(handle).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onWidthChange).toHaveBeenLastCalledWith(52);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onWidthChange).toHaveBeenLastCalledWith(26);
  });

  it("captures pointer movement, snaps near center, and cleans up on cancel", () => {
    const onWidthChange = vi.fn();
    const { container } = render(<Harness onWidthChange={onWidthChange} />);
    const shell = container.firstElementChild as HTMLElement;
    vi.spyOn(shell, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    const handle = screen.getByRole("separator", { name: "Resize panels" });

    fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 500 });
    expect(document.body.dataset.resizing).toBe("true");
    expect(shell.dataset.splitResizing).toBe("true");
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 515 });
    expect(onWidthChange).toHaveBeenLastCalledWith(50);
    expect(screen.getByTestId("split-resizer-overlay")).toBeInTheDocument();
    act(() => fireEvent.pointerCancel(handle, { pointerId: 7 }));
    expect(document.body.dataset.resizing).toBeUndefined();
    expect(shell.dataset.splitResizing).toBeUndefined();
    expect(screen.queryByTestId("split-resizer-overlay")).not.toBeInTheDocument();
  });

  it("resets to the center on double click", () => {
    const onWidthChange = vi.fn();
    render(<Harness width={64} onWidthChange={onWidthChange} />);
    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize panels" }));
    expect(onWidthChange).toHaveBeenLastCalledWith(50);
  });
});
