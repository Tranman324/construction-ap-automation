"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type RouteLifecyclePhase = "loading" | "ready";

interface RouteLifecycleState {
  identity: string;
  phase: RouteLifecyclePhase;
  entering: boolean;
  closing: boolean;
}

export interface RouteLifecycleController {
  identity: string;
  phase: RouteLifecyclePhase;
  entering: boolean;
  closing: boolean;
  runControlledNavigation: (action: () => void) => Promise<boolean>;
}

function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function createInitialState(identity: string): RouteLifecycleState {
  const entering = isDocumentVisible() && !prefersReducedMotion();
  return { identity, phase: entering ? "loading" : "ready", entering, closing: false };
}

export function useRouteLifecycle(identity: string): RouteLifecycleController {
  const [state, setState] = useState(() => createInitialState(identity));
  const entryTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const exitResolveRef = useRef<((completed: boolean) => void) | null>(null);
  const mountedRef = useRef(true);
  const navigationTokenRef = useRef(0);

  const clearEntryTimer = useCallback(() => {
    if (entryTimerRef.current !== null) {
      window.clearTimeout(entryTimerRef.current);
      entryTimerRef.current = null;
    }
  }, []);

  const cancelExit = useCallback(() => {
    navigationTokenRef.current += 1;
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    exitResolveRef.current?.(false);
    exitResolveRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    clearEntryTimer();
    cancelExit();
    const initial = createInitialState(identity);

    const clearEntering = () => {
      clearEntryTimer();
      setState((current) => current.identity === identity && !current.closing
        ? { ...current, phase: "ready", entering: false }
        : current);
    };

    if (initial.entering) {
      entryTimerRef.current = window.setTimeout(clearEntering, 20);
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") clearEntering();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mountedRef.current = false;
      clearEntryTimer();
      cancelExit();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cancelExit, clearEntryTimer, identity]);

  const runControlledNavigation = useCallback((action: () => void): Promise<boolean> => {
    if (!mountedRef.current) return Promise.resolve(false);
    clearEntryTimer();
    cancelExit();

    if (prefersReducedMotion()) {
      action();
      return Promise.resolve(true);
    }

    setState((current) => current.identity === identity
      ? { ...current, phase: "ready", closing: true, entering: false }
      : current);
    const token = navigationTokenRef.current;
    return new Promise((resolve) => {
      exitResolveRef.current = resolve;
      exitTimerRef.current = window.setTimeout(() => {
        exitTimerRef.current = null;
        exitResolveRef.current = null;
        if (!mountedRef.current || token !== navigationTokenRef.current) {
          resolve(false);
          return;
        }
        action();
        resolve(true);
      }, 140);
    });
  }, [cancelExit, clearEntryTimer, identity]);

  const current = state.identity === identity ? state : createInitialState(identity);
  return {
    identity,
    phase: current.phase,
    entering: current.entering,
    closing: current.closing,
    runControlledNavigation,
  };
}

export interface RouteLifecycleFrameProps {
  lifecycle: RouteLifecycleController;
  children: ReactNode;
}

export function RouteLifecycleFrame({ lifecycle, children }: RouteLifecycleFrameProps) {
  return (
    <div
      className="tbx-route-detail h-full min-h-0"
      data-closing={lifecycle.closing ? "" : undefined}
      data-entering={lifecycle.entering ? "" : undefined}
      data-phase={lifecycle.phase}
      data-route-identity={lifecycle.identity}
    >
      {children}
    </div>
  );
}
