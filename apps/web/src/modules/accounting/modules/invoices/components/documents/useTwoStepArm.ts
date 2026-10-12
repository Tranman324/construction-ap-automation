import { useCallback, useEffect, useRef, useState } from "react";

/** Arm window for a two-step action: the second click must land inside it. Same 3 s the legacy duplicate card used. */
export const ARM_MS = 3000;

export interface TwoStepArm {
  /** The one armed action id, or null. */
  armedId: string | null;
  /** First press arms `id` (replacing any other); a second press on the armed id fires once and disarms. */
  press: (id: string) => void;
  disarm: () => void;
}

/**
 * One armed id at a time with a single timer. `onFire` runs only from `press` (a click), never from the
 * timer; expiry just disarms. The timer is cleared on re-arm, on fire and on unmount.
 */
export function useTwoStepArm(onFire: (id: string) => void, onArmedChange?: (id: string | null) => void): TwoStepArm {
  const [armedId, setArmedId] = useState<string | null>(null);
  const armedRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeRef = useRef(onArmedChange);
  useEffect(() => {
    changeRef.current = onArmedChange;
  });

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const set = useCallback((id: string | null) => {
    armedRef.current = id;
    setArmedId(id);
    changeRef.current?.(id);
  }, []);

  const disarm = useCallback(() => {
    clearTimer();
    if (armedRef.current !== null) set(null);
  }, [clearTimer, set]);

  const press = useCallback((id: string) => {
    clearTimer();
    if (armedRef.current === id) {
      set(null);
      onFire(id);
      return;
    }
    set(id);
    timer.current = setTimeout(() => {
      timer.current = null;
      set(null);
    }, ARM_MS);
  }, [clearTimer, set, onFire]);

  useEffect(() => clearTimer, [clearTimer]);

  return { armedId, press, disarm };
}
