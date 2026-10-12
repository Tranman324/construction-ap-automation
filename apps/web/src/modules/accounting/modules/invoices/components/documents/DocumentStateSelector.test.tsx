import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentStateSelector, DEV_PANEL_PHASE_OPTIONS, panelPhaseInputsForOverride, useDevPanelStateSelector } from "./DocumentStateSelector";
import { usePanelPhase } from "./usePanelPhase";

const actual = { loading: false, hasContent: true };
const selectorProps = { retryingLoaderSize: 72, onRetryingLoaderSizeChange: vi.fn() };

describe("DocumentStateSelector", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("offers the complete ordered ten-state selector and clears to live inputs", () => {
    const onChange = vi.fn();
    render(<DocumentStateSelector value={null} onChange={onChange} {...selectorProps} />);
    expect(screen.getByTestId("document-state-selector")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ready" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(11);
    expect(DEV_PANEL_PHASE_OPTIONS.map((option) => option.value)).toEqual([
      "ready", "loading", "error", "not-found", "empty", "unauthorized", "offline", "timeout", "retrying", "stale",
    ]);
  });

  it("maps a selected phase into canonical hook inputs without persistence", () => {
    expect(panelPhaseInputsForOverride("not-found", actual)).toMatchObject({ loading: false, hasContent: false, isError: true, errorStatus: 404 });
    expect(panelPhaseInputsForOverride("retrying", actual)).toMatchObject({ loading: false, hasContent: true, isRetrying: true });
    expect(panelPhaseInputsForOverride(null, actual)).toEqual(actual);
  });

  it("resets the ephemeral override when route identity changes", () => {
    const { result, rerender } = renderHook(({ identity }) => useDevPanelStateSelector(identity, actual), { initialProps: { identity: "invoice:one" } });
    act(() => result.current.setSelectedPhase("offline"));
    expect(result.current.selectedPhase).toBe("offline");
    expect(result.current.phaseIdentity).toBe("invoice:one:dev:offline");
    rerender({ identity: "invoice:two" });
    expect(result.current.selectedPhase).toBeNull();
    expect(result.current.phaseIdentity).toBe("invoice:two");
    expect(result.current.panelInputs).toEqual(actual);
  });

  it("is omitted from production output", () => {
    vi.stubEnv("NODE_ENV", "production");
    render(<DocumentStateSelector value="ready" onChange={vi.fn()} {...selectorProps} />);
    expect(screen.queryByTestId("document-state-selector")).not.toBeInTheDocument();
  });

  it("can drive every selector state through the canonical phase hook", async () => {
    const { result } = renderHook(() => {
      const selector = useDevPanelStateSelector("invoice:one", actual);
      const panel = usePanelPhase({
        identity: selector.phaseIdentity,
        ...selector.panelInputs,
        minimumVisibleMs: 0,
      });
      return { selector, panel };
    });

    for (const { value } of DEV_PANEL_PHASE_OPTIONS) {
      act(() => result.current.selector.setSelectedPhase(value));
      await waitFor(() => expect(result.current.panel.phase).toBe(value));
    }
  });

  it("shows an ephemeral retrying-loader size slider only for retrying", () => {
    const onRetryingLoaderSizeChange = vi.fn();
    const { rerender } = render(<DocumentStateSelector value="ready" onChange={vi.fn()} retryingLoaderSize={72} onRetryingLoaderSizeChange={onRetryingLoaderSizeChange} />);
    expect(screen.queryByLabelText("Retrying loader size")).not.toBeInTheDocument();
    rerender(<DocumentStateSelector value="retrying" onChange={vi.fn()} retryingLoaderSize={72} onRetryingLoaderSizeChange={onRetryingLoaderSizeChange} />);
    fireEvent.change(screen.getByLabelText("Retrying loader size"), { target: { value: "128" } });
    expect(onRetryingLoaderSizeChange).toHaveBeenCalledWith(128);
    expect(screen.getByLabelText("Retrying loader size value")).toHaveTextContent("72px");
  });
});
