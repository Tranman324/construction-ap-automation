"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { clampSplitWidth, SPLIT_WIDTH_DEFAULT, SPLIT_WIDTH_MAX, SPLIT_WIDTH_MIN } from "@/modules/accounting/modules/invoices/components/documents/useSplitWidth";
import styles from "@/modules/accounting/modules/invoices/components/documents/SplitResizer.module.css";

const SPLIT_SNAP_WIDTH = 50;
const SPLIT_SNAP_DISTANCE = 2;
const SPLIT_RESET_DURATION_MS = 180;

interface SplitResizerProps {
  containerRef: RefObject<HTMLElement | null>;
  width: number;
  onWidthChange: (value: number) => void;
  label: string;
}

function isDesktopViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(min-width: 1100px)").matches;
}

export function SplitResizer({ containerRef, width, onWidthChange, label }: SplitResizerProps) {
  const [dragging, setDragging] = useState(false);
  const [desktopViewport, setDesktopViewport] = useState(true);
  const pointerIdRef = useRef<number | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const finishDrag = useCallback((event?: ReactPointerEvent<HTMLButtonElement>) => {
    if (event && pointerIdRef.current === event.pointerId) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // The browser may release capture before the terminal event arrives.
      }
    }
    pointerIdRef.current = null;
    setDragging(false);
    const container = containerRef.current;
    if (container) {
      delete container.dataset.splitResizing;
    }
    delete document.body.dataset.resizing;
    document.body.style.userSelect = "";
  }, [containerRef]);

  useEffect(() => {
    const syncViewport = () => setDesktopViewport(isDesktopViewport());
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => {
      window.removeEventListener("resize", syncViewport);
      clearResetTimer();
      finishDrag();
    };
  }, [clearResetTimer, finishDrag]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!desktopViewport || event.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    event.preventDefault();
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    container.dataset.splitResizing = "true";
    document.body.dataset.resizing = "true";
    document.body.style.userSelect = "none";
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;
    const rawWidth = ((event.clientX - rect.left) / rect.width) * 100;
    const snappedWidth = Math.abs(rawWidth - SPLIT_SNAP_WIDTH) <= SPLIT_SNAP_DISTANCE ? SPLIT_SNAP_WIDTH : rawWidth;
    onWidthChange(clampSplitWidth(snappedWidth));
  };

  const handleDoubleClick = () => {
    if (!desktopViewport) return;
    clearResetTimer();
    const container = containerRef.current;
    if (!container) return;
    container.dataset.splitReset = "true";
    onWidthChange(SPLIT_WIDTH_DEFAULT);
    resetTimerRef.current = window.setTimeout(() => {
      delete container.dataset.splitReset;
      resetTimerRef.current = null;
    }, SPLIT_RESET_DURATION_MS);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!desktopViewport) return;
    const step = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -2 : event.key === "ArrowRight" || event.key === "ArrowUp" ? 2 : 0;
    if (step === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (event.key === "Home") onWidthChange(SPLIT_WIDTH_MIN);
    else if (event.key === "End") onWidthChange(SPLIT_WIDTH_MAX);
    else onWidthChange(clampSplitWidth(width + step));
  };

  if (!desktopViewport) return null;

  return (
    <>
      {dragging && <div className={styles.overlay} data-testid="split-resizer-overlay" aria-hidden="true" />}
      <button
        type="button"
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={SPLIT_WIDTH_MIN}
        aria-valuemax={SPLIT_WIDTH_MAX}
        aria-valuenow={width}
        className={styles.handle}
        style={{ left: `${width}%` }}
        data-testid="split-resizer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={() => finishDrag()}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      />
    </>
  );
}
