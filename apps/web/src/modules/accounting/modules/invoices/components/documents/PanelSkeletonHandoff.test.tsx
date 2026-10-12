import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PanelSkeletonHandoff } from "./PanelSkeletonHandoff";
import { usePanelPhase } from "./usePanelPhase";

function TestHandoff({ loading, identity = "invoice:one" }: { loading: boolean; identity?: string }) {
  const phase = usePanelPhase({ identity, loading, hasContent: true, minimumVisibleMs: 180 });
  return (
    <PanelSkeletonHandoff identity={identity} phase={phase} type="invoice">
      <button type="button">Approve</button>
    </PanelSkeletonHandoff>
  );
}

describe("PanelSkeletonHandoff", () => {
  it("holds the skeleton for at least 180ms before exposing the ready panel", () => {
    vi.useFakeTimers();
    const view = render(
      <TestHandoff loading />,
    );

    expect(screen.getByTestId("panel-handoff")).toHaveAttribute("data-phase", "loading");
    expect(screen.getByTestId("panel-handoff").firstElementChild).toHaveAttribute("inert");

    view.rerender(
      <TestHandoff loading={false} />,
    );
    act(() => vi.advanceTimersByTime(179));
    expect(screen.getByTestId("panel-handoff")).not.toHaveAttribute("data-phase", "ready");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("panel-handoff")).toHaveAttribute("data-phase", "ready");
    expect(screen.getByRole("button", { name: "Approve" })).not.toHaveAttribute("aria-hidden");
    vi.useRealTimers();
  });

  it("keeps ready content visible during a background refetch", () => {
    vi.useFakeTimers();
    const view = render(
      <TestHandoff loading={false} />,
    );
    view.rerender(
      <TestHandoff loading />,
    );

    expect(screen.getByTestId("panel-handoff")).toHaveAttribute("data-phase", "ready");
    expect(screen.getByRole("button", { name: "Approve" })).toBeVisible();
    vi.useRealTimers();
  });
});
