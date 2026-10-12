"use client"

import { useState, useCallback, useRef, useEffect } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseDirtyStateReturn<T> {
  /** True when current values differ from the last snapshot. */
  isDirty: boolean
  /** Snapshot the current values as the new clean baseline. */
  markClean: (values?: T) => void
  /** The clean baseline values (latest snapshot). */
  snapshot: T
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false
  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)
  if (keysA.length !== keysB.length) return false
  return keysA.every(
    (k) => (b as Record<string, unknown>)[k] === (a as Record<string, unknown>)[k],
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useDirtyState — tracks whether form values have changed from a clean baseline.
 *
 * Uses shallow equality by default (one level deep). Pass a custom `isEqual`
 * for deep objects or arrays.
 *
 * @example
 * const [values, setValues] = useState({ name: "Alice", email: "a@b.example" })
 * const { isDirty, markClean, snapshot } = useDirtyState(values)
 *
 * // After save:
 * await save(values)
 * markClean()
 */
export function useDirtyState<T>(
  values: T,
  options?: {
    /** Custom equality function. Defaults to shallow equality. */
    isEqual?: (a: T, b: T) => boolean
  },
): UseDirtyStateReturn<T> {
  const isEqual = options?.isEqual ?? (shallowEqual as (a: T, b: T) => boolean)

  // Snapshot is the last known-clean state (the initial values on mount,
  // or whatever markClean was last called with).
  const [snapshot, setSnapshot] = useState<T>(values)

  // Keep a ref so markClean() without args always has access to current values
  const valuesRef = useRef(values)
  useEffect(() => {
    valuesRef.current = values
  })

  const isDirty = !isEqual(values, snapshot)

  const markClean = useCallback(
    (nextClean?: T) => {
      setSnapshot(nextClean !== undefined ? nextClean : valuesRef.current)
    },
    [],
  )

  return { isDirty, markClean, snapshot }
}
