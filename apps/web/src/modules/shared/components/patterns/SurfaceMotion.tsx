import type { CSSProperties } from "react"

import styles from "./SurfaceMotion.module.css"

/** Approved motion contracts shared by the invoice and document-panel surfaces. */
export type SurfaceMotionPreset =
  | "card-resolve"
  | "card-promote"

export type SurfaceMotionState = "rest" | "enter" | "exit"

interface MotionContract {
  duration: string
  easing: string
  property: string
  enter?: CSSProperties
  exit?: CSSProperties
}

export const SURFACE_MOTION_CONTRACTS: Record<SurfaceMotionPreset, MotionContract> = {
  "card-resolve": {
    duration: "var(--dur-sheet)",
    easing: "var(--ease-out)",
    property: "opacity, transform",
    exit: { opacity: 0, transform: "translateX(110%)" },
  },
  "card-promote": {
    duration: "var(--dur-reveal)",
    easing: "var(--ease-out)",
    property: "opacity, transform",
    enter: { opacity: 0, transform: "translateY(8px) scale(0.96)" },
  },
}

const PRESET_CLASSES: Record<SurfaceMotionPreset, string> = {
  "card-resolve": styles.cardResolve,
  "card-promote": styles.cardPromote,
}

/** Class-based form for consumers that need the shared reduced-motion media path. */
export function getSurfaceMotionClassName(
  preset: SurfaceMotionPreset,
  state: SurfaceMotionState = "rest",
): string {
  const stateClass = state === "enter" ? styles.enter : state === "exit" ? styles.exit : styles.rest
  return `${PRESET_CLASSES[preset]} ${stateClass}`
}

/**
 * Returns an inline transition contract and state transform for a surface.
 * Inline consumers should provide an opacity-only reduced-motion variant;
 * the class-based CardStack path receives that variant from the CSS module.
 */
export function getSurfaceMotionStyles(
  preset: SurfaceMotionPreset,
  state: SurfaceMotionState = "rest",
): CSSProperties {
  const contract = SURFACE_MOTION_CONTRACTS[preset]
  const stateStyles = state === "enter" ? contract.enter : state === "exit" ? contract.exit : undefined

  return {
    transitionProperty: contract.property,
    transitionDuration: contract.duration,
    transitionTimingFunction: contract.easing,
    ...stateStyles,
  }
}

/** Resolve the same duration token used by the CSS class for timer fallbacks. */
export function getSurfaceMotionDurationMs(preset: SurfaceMotionPreset, reducedMotion = false): number {
  const token = reducedMotion ? "--dur-exit" : SURFACE_MOTION_CONTRACTS[preset].duration.slice(4, -1)
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const duration = Number.parseFloat(value)
  return Number.isFinite(duration) ? duration * (value.endsWith("ms") ? 1 : 1000) : 0
}
