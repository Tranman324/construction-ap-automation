import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

function controlledTooltips(firstOpen: boolean, secondOpen = false) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip open={firstOpen}>
        <TooltipTrigger>First tip</TooltipTrigger>
        <TooltipContent>First body</TooltipContent>
      </Tooltip>
      <Tooltip open={secondOpen}>
        <TooltipTrigger>Second tip</TooltipTrigger>
        <TooltipContent>Second body</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

describe("TooltipProvider warm-neighbor lifecycle", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.removeAttribute("data-tip-open");
  });

  it("holds the body flag for 400ms after the last tooltip closes", () => {
    vi.useFakeTimers();
    const view = render(controlledTooltips(false));
    expect(document.body).not.toHaveAttribute("data-tip-open");
    view.rerender(controlledTooltips(true));
    expect(document.body).toHaveAttribute("data-tip-open", "true");
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveAttribute("data-slot", "tooltip-content");
    expect(document.querySelector('[data-slot="tooltip-content"]')).not.toHaveAttribute("data-tip-warm");
    view.rerender(controlledTooltips(false));
    act(() => vi.advanceTimersByTime(399));
    expect(document.body).toHaveAttribute("data-tip-open", "true");
    act(() => vi.advanceTimersByTime(1));
    expect(document.body).not.toHaveAttribute("data-tip-open");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending clear for a warm neighbor and clears on provider unmount", () => {
    vi.useFakeTimers();
    const view = render(controlledTooltips(true));
    view.rerender(controlledTooltips(false));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.rerender(controlledTooltips(false, true));
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveAttribute("data-tip-warm", "true");
    act(() => vi.advanceTimersByTime(400));
    expect(document.body).toHaveAttribute("data-tip-open", "true");
    view.unmount();
    expect(document.body).not.toHaveAttribute("data-tip-open");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending clear when its provider unmounts", () => {
    vi.useFakeTimers();
    const view = render(controlledTooltips(true));
    view.rerender(controlledTooltips(false));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(document.body).not.toHaveAttribute("data-tip-open");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps another provider's active tooltip open when one provider unmounts", () => {
    vi.useFakeTimers();
    const first = render(controlledTooltips(true));
    const second = render(controlledTooltips(false, true));
    first.unmount();
    expect(document.body).toHaveAttribute("data-tip-open", "true");
    second.unmount();
    expect(document.body).not.toHaveAttribute("data-tip-open");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the first pointer delay and skips it for the next tooltip", () => {
    vi.useFakeTimers();
    render(
      <TooltipProvider delayDuration={200} disableHoverableContent>
        <Tooltip>
          <TooltipTrigger>First pointer tip</TooltipTrigger>
          <TooltipContent>First pointer body</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>Second pointer tip</TooltipTrigger>
          <TooltipContent>Second pointer body</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    fireEvent.pointerMove(screen.getByRole("button", { name: "First pointer tip" }), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(199));
    expect(document.body).not.toHaveAttribute("data-tip-open");
    act(() => vi.advanceTimersByTime(1));
    expect(document.body).toHaveAttribute("data-tip-open", "true");
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveAttribute("data-state", "delayed-open");
    expect(document.querySelector('[data-slot="tooltip-content"]')).not.toHaveAttribute("data-tip-warm");
    fireEvent.pointerLeave(screen.getByRole("button", { name: "First pointer tip" }));
    fireEvent.pointerMove(screen.getByRole("button", { name: "Second pointer tip" }), { pointerType: "mouse" });
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveAttribute("data-state", "instant-open");
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveAttribute("data-tip-warm", "true");
  });

  it("forwards the real Radix open callback from keyboard focus", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip onOpenChange={onOpenChange}>
          <TooltipTrigger>Keyboard tip</TooltipTrigger>
          <TooltipContent>Keyboard body</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Keyboard tip" })).toHaveFocus();
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(document.body).toHaveAttribute("data-tip-open", "true");
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveClass("origin-(--radix-tooltip-content-transform-origin)");
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.body).toHaveAttribute("data-tip-open", "true");
  });
});
