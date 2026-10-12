import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { getSurfaceMotionClassName, getSurfaceMotionDurationMs, getSurfaceMotionStyles, SURFACE_MOTION_CONTRACTS } from "./SurfaceMotion"

afterEach(() => {
  for (const token of ["--dur-sheet", "--dur-reveal", "--dur-exit"]) document.documentElement.style.removeProperty(token)
})

describe("invoice motion contracts", () => {
  it("exposes only the live card presets with named timing and curve tokens", () => {
    expect(Object.keys(SURFACE_MOTION_CONTRACTS).sort()).toEqual(["card-promote", "card-resolve"])
    expect(SURFACE_MOTION_CONTRACTS["card-resolve"]).toMatchObject({ duration: "var(--dur-sheet)", easing: "var(--ease-out)" })
    expect(SURFACE_MOTION_CONTRACTS["card-promote"]).toMatchObject({ duration: "var(--dur-reveal)", easing: "var(--ease-out)" })
  })

  it("exposes semantic enter and exit states without owning resolution", () => {
    expect(getSurfaceMotionStyles("card-resolve", "exit")).toMatchObject({
      transitionDuration: "var(--dur-sheet)",
      transitionTimingFunction: "var(--ease-out)",
      transform: "translateX(110%)",
      opacity: 0,
    })
    expect(getSurfaceMotionStyles("card-promote", "enter")).toMatchObject({
      transitionDuration: "var(--dur-reveal)",
      transitionTimingFunction: "var(--ease-out)",
      transform: "translateY(8px) scale(0.96)",
      opacity: 0,
    })
    expect(getSurfaceMotionStyles("card-resolve", "rest")).toMatchObject({
      transitionProperty: "opacity, transform",
      transitionDuration: "var(--dur-sheet)",
    })
  })

  it("leaves reduced-motion handling to the consumer without changing state output", () => {
    const reducedMotionStyles = getSurfaceMotionStyles("card-promote", "enter")
    expect(reducedMotionStyles.transform).toBe("translateY(8px) scale(0.96)")
    expect(reducedMotionStyles.transitionDuration).toBe("var(--dur-reveal)")
    expect(getSurfaceMotionClassName("card-promote", "enter")).toContain("enter")
  })

  it("resolves timer fallbacks from the same named duration tokens", () => {
    document.documentElement.style.setProperty("--dur-sheet", "280ms")
    document.documentElement.style.setProperty("--dur-reveal", "180ms")
    document.documentElement.style.setProperty("--dur-exit", "140ms")
    expect(getSurfaceMotionDurationMs("card-resolve")).toBe(280)
    expect(getSurfaceMotionDurationMs("card-promote")).toBe(180)
    expect(getSurfaceMotionDurationMs("card-resolve", true)).toBe(140)
    expect(getSurfaceMotionDurationMs("card-promote", true)).toBe(140)
  })

  it("keeps card movement on named CSS tokens and reduced motion opacity-only", () => {
    const css = readFileSync(resolve(import.meta.dirname, "SurfaceMotion.module.css"), "utf8")
    expect(css).toContain(".cardResolve { transition: opacity var(--dur-sheet) var(--ease-out), transform var(--dur-sheet) var(--ease-out); }")
    expect(css).toContain(".cardPromote { transition: opacity var(--dur-reveal) var(--ease-out), transform var(--dur-reveal) var(--ease-out); }")
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"))
    expect(reduced).toContain("transition-property: opacity;")
    expect(reduced).toContain("transition-duration: var(--dur-exit);")
    expect(reduced).toContain(".cardPromote.enter { transform: none; }")
  })
})
