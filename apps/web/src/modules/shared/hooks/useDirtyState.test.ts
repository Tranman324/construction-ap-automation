import { renderHook, act } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { useDirtyState } from "./useDirtyState"

describe("useDirtyState", () => {
  it("is not dirty on initial render", () => {
    const { result } = renderHook(() => useDirtyState({ name: "Alice" }))
    expect(result.current.isDirty).toBe(false)
  })

  it("is dirty when values change from snapshot", () => {
    let values = { name: "Alice" }
    const { result, rerender } = renderHook((v) => useDirtyState(v), {
      initialProps: values,
    })
    values = { name: "Bob" }
    rerender(values)
    expect(result.current.isDirty).toBe(true)
  })

  it("markClean with current values resets dirty", () => {
    let values = { name: "Alice" }
    const { result, rerender } = renderHook((v) => useDirtyState(v), {
      initialProps: values,
    })
    values = { name: "Bob" }
    rerender(values)
    expect(result.current.isDirty).toBe(true)
    act(() => result.current.markClean({ name: "Bob" }))
    expect(result.current.isDirty).toBe(false)
  })

  it("markClean() without args uses current values ref", () => {
    let values = { name: "Alice" }
    const { result, rerender } = renderHook((v) => useDirtyState(v), {
      initialProps: values,
    })
    values = { name: "Bob" }
    rerender(values)
    act(() => result.current.markClean())
    expect(result.current.isDirty).toBe(false)
    expect(result.current.snapshot).toEqual({ name: "Bob" })
  })

  it("snapshot holds the last clean baseline", () => {
    const { result } = renderHook(() => useDirtyState({ count: 1 }))
    expect(result.current.snapshot).toEqual({ count: 1 })
  })

  it("respects custom isEqual function", () => {
    // Custom deep equality
    const isEqual = (a: number[], b: number[]) =>
      a.length === b.length && a.every((v, i) => v === b[i])
    let values = [1, 2, 3]
    const { result, rerender } = renderHook((v) => useDirtyState(v, { isEqual }), {
      initialProps: values,
    })
    // Same contents, different reference
    values = [1, 2, 3]
    rerender(values)
    expect(result.current.isDirty).toBe(false)
    // Different contents
    values = [1, 2, 4]
    rerender(values)
    expect(result.current.isDirty).toBe(true)
  })
})
