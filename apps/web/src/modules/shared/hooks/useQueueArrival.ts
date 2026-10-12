"use client";

import { useEffect, useState } from "react";

interface ArrivalState {
  previousLoading: boolean;
  settled: boolean;
  arrivingRows: number;
  arrivalIds: string[];
}

// Every row in the page animates; the safety clear is derived from the actual
// row count so the timeout always fires after the last row finishes.
// delay = index × 30 ms; duration = --dur-press (150 ms); pad 50 ms.
const STAGGER_MS = 30;
const ANIMATION_DURATION_MS = 150;
const SAFETY_PAD_MS = 50;
function arrivalTimeout(rowCount: number): number {
  return Math.max(rowCount - 1, 0) * STAGGER_MS + ANIMATION_DURATION_MS + SAFETY_PAD_MS;
}

/** Arms only the first loading-to-ready edge of this table instance. */
export function useQueueArrival(isLoading: boolean, rowIds: readonly string[]): number {
  const [state, setState] = useState<ArrivalState>(() => ({
    previousLoading: isLoading,
    settled: !isLoading,
    arrivingRows: 0,
    arrivalIds: [],
  }));

  // React retries this render with the edge recorded before committing rows.
  if (state.previousLoading !== isLoading) {
    const firstReady = state.previousLoading && !isLoading && !state.settled;
    const arrivalIds = firstReady ? rowIds.slice() : [];
    setState({
      previousLoading: isLoading,
      settled: state.settled || firstReady,
      arrivingRows: arrivalIds.length,
      arrivalIds,
    });
  } else if (state.arrivingRows > 0 && state.arrivalIds.some((id, index) => rowIds[index] !== id)) {
    setState({ ...state, arrivingRows: 0, arrivalIds: [] });
  }

  useEffect(() => {
    if (state.arrivingRows === 0) return;

    const clearWhenHidden = () => {
      if (document.visibilityState === "hidden") setState((current) => ({ ...current, arrivingRows: 0, arrivalIds: [] }));
    };
    const timeout = window.setTimeout(() => setState((current) => ({ ...current, arrivingRows: 0, arrivalIds: [] })), arrivalTimeout(state.arrivingRows));
    document.addEventListener("visibilitychange", clearWhenHidden);
    clearWhenHidden();
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", clearWhenHidden);
    };
  }, [state.arrivingRows]);

  return state.arrivingRows;
}
