import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light" }) }));

import { toast, Toaster } from "./toaster";

function toastNode(text: string): HTMLElement {
  const node = screen.getByText(text).closest<HTMLElement>("[data-sonner-toast]");
  if (!node) throw new Error(`Missing Sonner toast for ${text}`);
  return node;
}

describe("real Sonner lifecycle", () => {
  afterEach(() => {
    act(() => toast.dismiss());
    act(() => vi.runOnlyPendingTimers());
    vi.useRealTimers();
  });

  it("keeps action and stacking behavior while manual close removes the front toast", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    render(<Toaster />);
    act(() => {
      toast("Older", { duration: Infinity });
      toast.success("Front", { duration: Infinity, action: { label: "Undo", onClick: action } });
    });
    act(() => vi.advanceTimersByTime(0));
    const front = toastNode("Front");
    expect(front).toHaveAttribute("data-mounted", "true");
    expect(front).toHaveAttribute("data-front", "true");
    expect(toastNode("Older")).toHaveAttribute("data-front", "false");
    expect(within(front).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    fireEvent.click(within(front).getByRole("button", { name: "Close toast" }));
    expect(front).toHaveAttribute("data-removed", "true");
    expect(action).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("Front")).not.toBeInTheDocument();
    expect(screen.getByText("Older")).toBeInTheDocument();
  });

  it("pauses TTL on hover, then auto-closes through removed state before unmount", () => {
    vi.useFakeTimers();
    const onAutoClose = vi.fn();
    render(<Toaster />);
    act(() => toast("Timed", { duration: 100, onAutoClose }));
    act(() => vi.advanceTimersByTime(0));
    const timed = toastNode("Timed");
    expect(timed).toHaveAttribute("data-mounted", "true");
    const toaster = timed.closest<HTMLElement>("[data-sonner-toaster]");
    if (!toaster) throw new Error("Missing Sonner toaster");
    fireEvent.mouseEnter(toaster);
    act(() => vi.advanceTimersByTime(100));
    expect(onAutoClose).not.toHaveBeenCalled();
    expect(timed).toHaveAttribute("data-removed", "false");
    fireEvent.mouseLeave(toaster);
    act(() => vi.advanceTimersByTime(100));
    expect(onAutoClose).toHaveBeenCalledTimes(1);
    expect(timed).toHaveAttribute("data-removed", "true");
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("Timed")).not.toBeInTheDocument();
  });
});
