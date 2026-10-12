import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";

export const SPLIT_WIDTH_STORAGE_KEY = "tbx.invoices.splitDocWidth";
export const SPLIT_WIDTH_MIN = 26;
export const SPLIT_WIDTH_MAX = 74;
export const SPLIT_WIDTH_DEFAULT = 50;

export function clampSplitWidth(value: number): number {
  if (!Number.isFinite(value)) return SPLIT_WIDTH_DEFAULT;
  return Math.min(SPLIT_WIDTH_MAX, Math.max(SPLIT_WIDTH_MIN, Math.round(value)));
}

function readStoredWidth(): number {
  try {
    const stored = window.localStorage.getItem(SPLIT_WIDTH_STORAGE_KEY);
    if (!stored) return SPLIT_WIDTH_DEFAULT;
    const parsed = Number(stored);
    return clampSplitWidth(parsed);
  } catch {
    return SPLIT_WIDTH_DEFAULT;
  }
}

type SplitContainerStyle = CSSProperties & { "--split-doc-width": string };

interface SplitWidthState {
  containerRef: RefObject<HTMLDivElement | null>;
  containerStyle: SplitContainerStyle;
  width: number;
  setWidth: (value: number) => void;
}

export function useSplitWidth(): SplitWidthState {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidthState] = useState(() => (typeof window === "undefined" ? SPLIT_WIDTH_DEFAULT : readStoredWidth()));

  const setWidth = useCallback((value: number) => {
    const next = clampSplitWidth(value);
    setWidthState(next);
    try {
      window.localStorage.setItem(SPLIT_WIDTH_STORAGE_KEY, String(next));
    } catch {
      // Storage is optional; the in-memory value remains authoritative for this mount.
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reclamp = () => setWidthState((current) => clampSplitWidth(current));
    reclamp();
    window.addEventListener("resize", reclamp);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reclamp);
    observer?.observe(container);
    return () => {
      window.removeEventListener("resize", reclamp);
      observer?.disconnect();
    };
  }, []);

  const containerStyle = useMemo<SplitContainerStyle>(
    () => ({ "--split-doc-width": `${width}%` }),
    [width],
  );

  return { containerRef, containerStyle, width, setWidth };
}
