import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResolveCardActions } from "./ResolveCardActions";
import type { Actions } from "./resolveCardModel";

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasAnyPermission: () => true }),
}));

const twoStep: Actions = [
  { id: "discard", label: "Discard", icon: "trash", emphasis: "secondary", confirm: "two-step" },
  { id: "bypass", label: "Bypass", icon: "circle-off", emphasis: "secondary", confirm: "two-step" },
];
const bypassOnly: Actions = [{ id: "bypass", label: "Bypass", icon: "circle-off", emphasis: "secondary", confirm: "two-step" }];

function setup(actions: Actions = bypassOnly) {
  const onAction = vi.fn();
  const view = render(<ResolveCardActions tone="blocking" actions={actions} onAction={onAction} />);
  return { onAction, ...view };
}
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("ResolveCardActions two-step arming", () => {
  it("ACT-07 the first click arms: default armed label, blocking tone icon, nothing fired", () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
    const armed = screen.getByRole("button", { name: "Confirm bypass" });
    expect(armed.querySelector("svg")).toHaveClass("lucide-triangle-alert");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("ACT-08 a second click inside the window fires once and disarms", () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm bypass" }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith("bypass");
    expect(screen.getByRole("button", { name: "Bypass" })).toBeInTheDocument();
  });

  it("ACT-09 the window is 3000 ms: armed at 2999, idle at 3000 and 3500, never fired by the timer", () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
    tick(2999);
    expect(screen.getByRole("button", { name: "Confirm bypass" })).toBeInTheDocument();
    tick(1);
    expect(screen.getByRole("button", { name: "Bypass" })).toBeInTheDocument();
    tick(500);
    expect(screen.getByRole("button", { name: "Bypass" })).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("ACT-10 arming another action replaces the first (one armed action per card)", () => {
    const { onAction } = setup(twoStep);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
    expect(screen.getByRole("button", { name: "Confirm bypass" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm discard" })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("ACT-11 a dialog action fires immediately and never arms", () => {
    const { onAction } = setup([{ id: "discard", label: "Discard", emphasis: "primary", confirm: "dialog" }]);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith("discard");
    expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
  });

  it("ACT-12 an explicit armedLabel wins over the default", () => {
    setup([
      { id: "discard", label: "Discard", emphasis: "secondary", confirm: "two-step", armedLabel: "Confirm discard" },
      { id: "bypass", label: "Bypass", emphasis: "secondary", confirm: "two-step" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("button", { name: "Confirm discard" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
    expect(screen.getByRole("button", { name: "Confirm bypass" })).toBeInTheDocument();
  });

  it("ACT-12b a custom armed label replaces the default text", () => {
    setup([{ id: "x", label: "Remove", emphasis: "secondary", confirm: "two-step", armedLabel: "Really remove" }]);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("button", { name: "Really remove" })).toBeInTheDocument();
  });

  it("ACT-13 a disabled two-step action never arms or fires and shows its reason as the title", () => {
    const { onAction } = setup([{ id: "bypass", label: "Bypass", emphasis: "secondary", confirm: "two-step", disabled: true, disabledReason: "No card match" }]);
    const button = screen.getByRole("button", { name: "Bypass" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "No card match");
    expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("ACT-14 a pending action shows a labelled spinner and cannot arm or fire", () => {
    const { onAction } = setup([{ id: "discard", label: "Discard", emphasis: "secondary", confirm: "two-step", pending: true, pendingLabel: "Discarding…" }]);
    const button = screen.getByRole("button", { name: /Discarding/ });
    expect(button).toBeDisabled();
    expect(screen.getByLabelText("Discarding")).toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("ACT-15 an armed id that turns pending or disappears is treated as not armed", () => {
    const { onAction, rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
    rerender(<ResolveCardActions tone="blocking" actions={[{ id: "bypass", label: "Bypass", icon: "circle-off", emphasis: "secondary", confirm: "two-step", pending: true, pendingLabel: "Bypassing…" }]} onAction={onAction} />);
    expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Bypassing/ }));
    expect(onAction).not.toHaveBeenCalled();
    rerender(<ResolveCardActions tone="blocking" actions={bypassOnly} onAction={onAction} />);
    expect(screen.getByRole("button", { name: "Bypass" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
    expect(onAction).not.toHaveBeenCalled();
    rerender(<ResolveCardActions tone="blocking" actions={[]} onAction={onAction} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  describe("armed text changing under the user", () => {
    const withWarning = (armedWarning: Record<string, string>, onAction = vi.fn()) => (
      <ResolveCardActions tone="blocking" actions={twoStep} armedWarning={armedWarning} onAction={onAction} />
    );

    it("ACT-16 an armed action disarms when its own warning text changes, and the next click arms again instead of firing", () => {
      const onAction = vi.fn();
      const view = render(withWarning({ bypass: "Clears the duplicate flag.", discard: "Discards this invoice." }, onAction));
      fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
      expect(screen.getByRole("button", { name: "Confirm bypass" })).toBeInTheDocument();
      view.rerender(withWarning({ bypass: "Clears the flag even though it is already posted in Spectrum.", discard: "Discards this invoice." }, onAction));
      expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Bypass" })).toBeInTheDocument();
      expect(onAction).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
      expect(screen.getByRole("button", { name: "Confirm bypass" })).toBeInTheDocument();
      expect(onAction).not.toHaveBeenCalled();
    });

    it("ACT-16 the card is told the armed id cleared", () => {
      const onArmedChange = vi.fn();
      const view = render(<ResolveCardActions tone="blocking" actions={twoStep} armedWarning={{ bypass: "one" }} onArmedChange={onArmedChange} />);
      fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
      expect(onArmedChange).toHaveBeenLastCalledWith("bypass");
      view.rerender(<ResolveCardActions tone="blocking" actions={twoStep} armedWarning={{ bypass: "two" }} onArmedChange={onArmedChange} />);
      expect(onArmedChange).toHaveBeenLastCalledWith(null);
    });

    it("ACT-16 an identical warning in a new object, or a change to another action's warning, keeps it armed", () => {
      const onAction = vi.fn();
      const view = render(withWarning({ bypass: "Clears the duplicate flag.", discard: "Discards this invoice." }, onAction));
      fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
      view.rerender(withWarning({ bypass: "Clears the duplicate flag.", discard: "Discards this invoice." }, onAction));
      expect(screen.getByRole("button", { name: "Confirm bypass" })).toBeInTheDocument();
      view.rerender(withWarning({ bypass: "Clears the duplicate flag.", discard: "Discards this invoice permanently." }, onAction));
      expect(screen.getByRole("button", { name: "Confirm bypass" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Confirm bypass" }));
      expect(onAction).toHaveBeenCalledExactlyOnceWith("bypass");
    });
  });

  it("reports the armed id to the card and clears it on expiry", () => {
    const onArmedChange = vi.fn();
    render(<ResolveCardActions tone="blocking" actions={bypassOnly} onArmedChange={onArmedChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Bypass" }));
    expect(onArmedChange).toHaveBeenLastCalledWith("bypass");
    tick(3000);
    expect(onArmedChange).toHaveBeenLastCalledWith(null);
  });
});
