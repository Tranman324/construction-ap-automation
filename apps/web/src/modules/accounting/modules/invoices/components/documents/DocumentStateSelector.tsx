"use client";

import { useCallback, useState } from "react";
import type { PanelPhase, PanelPhaseInputs } from "./usePanelPhase";
import { DEFAULT_RETRYING_LOADER_SIZE, MAX_RETRYING_LOADER_SIZE, MIN_RETRYING_LOADER_SIZE } from "./RetryingLoader";

export const DEV_PANEL_PHASE_OPTIONS: readonly { value: PanelPhase; label: string }[] = [
  { value: "ready", label: "Ready" },
  { value: "loading", label: "Loading (skeleton)" },
  { value: "error", label: "Error" },
  { value: "not-found", label: "Not found / deleted" },
  { value: "empty", label: "Empty" },
  { value: "unauthorized", label: "Permission denied" },
  { value: "offline", label: "Offline" },
  { value: "timeout", label: "Request timed out" },
  { value: "retrying", label: "Retrying" },
  { value: "stale", label: "Showing stale data" },
];

export interface DocumentStateSelectorProps {
  value: PanelPhase | null;
  onChange: (phase: PanelPhase | null) => void;
  retryingLoaderSize: number;
  onRetryingLoaderSizeChange: (size: number) => void;
}

export function panelPhaseInputsForOverride(phase: PanelPhase | null, actual: PanelPhaseInputs): PanelPhaseInputs {
  if (phase === null) return actual;
  return {
    ...actual,
    loading: phase === "loading",
    hasContent: phase === "ready" || phase === "stale" || phase === "retrying" || phase === "empty",
    isError: phase === "error" || phase === "not-found" || phase === "unauthorized" || phase === "timeout",
    errorStatus: phase === "not-found" ? 404 : phase === "unauthorized" ? 403 : null,
    isEmpty: phase === "empty",
    isOffline: phase === "offline",
    isTimeout: phase === "timeout",
    isRetrying: phase === "retrying",
    isStale: phase === "stale",
  };
}

export function useDevPanelStateSelector(identity: string, actual: PanelPhaseInputs) {
  const [selection, setSelection] = useState<{ identity: string; phase: PanelPhase | null }>({ identity, phase: null });
  const [retryingLoaderSize, setRetryingLoaderSize] = useState(DEFAULT_RETRYING_LOADER_SIZE);
  const setSelectedPhase = useCallback((phase: PanelPhase | null) => {
    setSelection({ identity, phase });
  }, [identity]);
  const selectedPhase = selection.identity === identity ? selection.phase : null;
  return {
    selectedPhase,
    setSelectedPhase,
    retryingLoaderSize,
    setRetryingLoaderSize,
    phaseIdentity: selectedPhase === null ? identity : `${identity}:dev:${selectedPhase}`,
    panelInputs: panelPhaseInputsForOverride(selectedPhase, actual),
  };
}

export function DocumentStateSelector({ value, onChange, retryingLoaderSize, onRetryingLoaderSizeChange }: DocumentStateSelectorProps) {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <aside className="fixed right-4 top-4 z-50 rounded-md border bg-background/95 px-2 py-1.5 text-xs shadow-md backdrop-blur" data-testid="document-state-selector">
      <label className="flex items-center gap-2">
        <span className="font-medium">Panel state</span>
        <select
          aria-label="Panel state"
          className="rounded border bg-background px-1.5 py-1 text-xs"
          value={value ?? ""}
          onChange={(event) => onChange((event.target.value || null) as PanelPhase | null)}
        >
          <option value="">Live</option>
          {DEV_PANEL_PHASE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {value === "retrying" ? (
        <label className="mt-2 flex items-center gap-2 border-t pt-2">
          <span className="font-medium">Loader size</span>
          <input
            aria-label="Retrying loader size"
            type="range"
            min={MIN_RETRYING_LOADER_SIZE}
            max={MAX_RETRYING_LOADER_SIZE}
            step="4"
            value={retryingLoaderSize}
            onChange={(event) => onRetryingLoaderSizeChange(Number(event.target.value))}
          />
          <output aria-label="Retrying loader size value">{retryingLoaderSize}px</output>
        </label>
      ) : null}
    </aside>
  );
}
