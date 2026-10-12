import { useCallback, useEffect, useRef, useState } from "react";

export const PANEL_PHASE_MIN_MS = 180;
export const PANEL_PHASE_SLOW_LOAD_MS = 10_000;

export type PanelPhase =
  | "loading"
  | "ready"
  | "error"
  | "not-found"
  | "empty"
  | "unauthorized"
  | "offline"
  | "timeout"
  | "retrying"
  | "stale";

export interface PanelPhaseTransition {
  from: PanelPhase;
  to: PanelPhase;
}

export interface PanelPhaseState {
  identity: string;
  phase: PanelPhase;
  slowLoading: boolean;
}

export interface PanelPhaseInputs {
  loading: boolean;
  hasContent: boolean;
  isError?: boolean;
  errorStatus?: number | null;
  isEmpty?: boolean;
  isOffline?: boolean;
  isTimeout?: boolean;
  isRetrying?: boolean;
  isStale?: boolean;
}

export interface UsePanelPhaseOptions extends PanelPhaseInputs {
  identity: string;
  minimumVisibleMs?: number;
  slowLoadMs?: number;
  onTransition?: (transition: PanelPhaseTransition) => void;
  onSlowLoad?: () => void;
}

export const PANEL_PHASE_TRANSITIONS: Record<PanelPhase, readonly PanelPhase[]> = {
  loading: ["loading", "ready", "error", "not-found", "empty", "unauthorized", "offline", "timeout"],
  ready: ["ready", "stale", "retrying"],
  error: ["error", "loading", "retrying"],
  "not-found": ["not-found"],
  empty: ["empty", "loading", "ready"],
  unauthorized: ["unauthorized"],
  offline: ["offline", "loading", "retrying"],
  timeout: ["timeout", "loading", "retrying"],
  retrying: ["retrying", "ready", "error", "timeout", "offline"],
  stale: ["stale", "ready", "retrying", "error"],
};

export function canTransitionPanelPhase(from: PanelPhase, to: PanelPhase): boolean {
  return PANEL_PHASE_TRANSITIONS[from].includes(to);
}

export function transitionPanelPhase(from: PanelPhase, to: PanelPhase): PanelPhase {
  return canTransitionPanelPhase(from, to) ? to : from;
}

export function derivePanelPhase({
  loading,
  hasContent,
  isError,
  errorStatus,
  isEmpty,
  isOffline,
  isTimeout,
  isRetrying,
  isStale,
}: PanelPhaseInputs): PanelPhase {
  if (isRetrying && !loading) return "retrying";
  if (loading) return "loading";
  if (isOffline && !hasContent) return "offline";
  if (isError) {
    if (errorStatus === 404) return "not-found";
    if (errorStatus === 403) return "unauthorized";
    if (isTimeout) return "timeout";
    return "error";
  }
  if (hasContent) {
    if (isStale) return "stale";
    if (isEmpty) return "empty";
    return "ready";
  }
  return "not-found";
}

export function usePanelPhase({
  identity,
  loading,
  hasContent,
  isError = false,
  errorStatus = null,
  isEmpty = false,
  isOffline = false,
  isTimeout = false,
  isRetrying = false,
  isStale = false,
  minimumVisibleMs = PANEL_PHASE_MIN_MS,
  slowLoadMs = PANEL_PHASE_SLOW_LOAD_MS,
  onTransition,
  onSlowLoad,
}: UsePanelPhaseOptions): PanelPhaseState {
  const inputs: PanelPhaseInputs = { loading, hasContent, isError, errorStatus, isEmpty, isOffline, isTimeout, isRetrying, isStale };
  const [state, setState] = useState<PanelPhaseState>(() => ({
    identity,
    phase: derivePanelPhase(inputs),
    slowLoading: false,
  }));
  const stateRef = useRef(state);
  const identityRef = useRef(identity);
  const inputsRef = useRef(inputs);
  const callbacksRef = useRef({ onSlowLoad, onTransition });
  const startedAtRef = useRef(0);
  const readyTimerRef = useRef<number | null>(null);
  const slowTimerRef = useRef<number | null>(null);

  useEffect(() => {
    inputsRef.current = { loading, hasContent, isError, errorStatus, isEmpty, isOffline, isTimeout, isRetrying, isStale };
    callbacksRef.current = { onSlowLoad, onTransition };
  }, [errorStatus, hasContent, isEmpty, isError, isOffline, isRetrying, isStale, isTimeout, loading, onSlowLoad, onTransition]);

  const clearTimers = useCallback(() => {
    if (readyTimerRef.current !== null) window.clearTimeout(readyTimerRef.current);
    if (slowTimerRef.current !== null) window.clearTimeout(slowTimerRef.current);
    readyTimerRef.current = null;
    slowTimerRef.current = null;
  }, []);

  const setPhase = useCallback((next: PanelPhase) => {
    setState((current) => {
      const phase = transitionPanelPhase(current.phase, next);
      if (phase === current.phase) return current;
      const nextState = { ...current, identity: identityRef.current, phase, slowLoading: false };
      stateRef.current = nextState;
      if (phase !== "loading" && slowTimerRef.current !== null) {
        window.clearTimeout(slowTimerRef.current);
        slowTimerRef.current = null;
      }
      callbacksRef.current.onTransition?.({ from: current.phase, to: phase });
      return nextState;
    });
  }, []);

  const scheduleReady = useCallback(() => {
    if (readyTimerRef.current !== null || stateRef.current.phase !== "loading") return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const elapsed = startedAtRef.current === 0 ? 0 : Date.now() - startedAtRef.current;
    const remaining = Math.max(0, minimumVisibleMs - elapsed);
    readyTimerRef.current = window.setTimeout(() => {
      readyTimerRef.current = null;
      if (stateRef.current.phase !== "loading") return;
      if (!inputsRef.current.loading && inputsRef.current.hasContent) setPhase("ready");
    }, remaining);
  }, [minimumVisibleMs, setPhase]);

  useEffect(() => {
    const target = derivePanelPhase(inputsRef.current);
    const identityChanged = identityRef.current !== identity;
    if (startedAtRef.current === 0 && loading) startedAtRef.current = Date.now();
    if (identityChanged) {
      identityRef.current = identity;
      clearTimers();
      startedAtRef.current = Date.now();
      const nextState: PanelPhaseState = {
        identity,
        phase: target === "ready" ? "loading" : target,
        slowLoading: false,
      };
      stateRef.current = nextState;
      queueMicrotask(() => {
        if (stateRef.current.identity === identity) setState(nextState);
      });
      if (target === "ready") scheduleReady();
      return;
    }

    if (target === "ready" && stateRef.current.phase === "loading") {
      scheduleReady();
    } else if (target !== "loading" || stateRef.current.phase !== "ready") {
      setPhase(target);
    }

    if (target === "loading" && slowTimerRef.current === null && stateRef.current.phase === "loading") {
      if (startedAtRef.current === 0) startedAtRef.current = Date.now();
      slowTimerRef.current = window.setTimeout(() => {
        slowTimerRef.current = null;
        if (stateRef.current.phase !== "loading" || !inputsRef.current.loading) return;
        const nextState = { ...stateRef.current, slowLoading: true };
        stateRef.current = nextState;
        setState(nextState);
        callbacksRef.current.onSlowLoad?.();
      }, Math.max(0, slowLoadMs - (Date.now() - startedAtRef.current)));
    }
  }, [clearTimers, errorStatus, hasContent, identity, isEmpty, isError, isOffline, isRetrying, isStale, isTimeout, loading, scheduleReady, setPhase, slowLoadMs]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !inputsRef.current.loading && inputsRef.current.hasContent) scheduleReady();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimers();
    };
  }, [clearTimers, scheduleReady]);

  return state.identity === identity ? state : { identity, phase: "loading", slowLoading: false };
}
