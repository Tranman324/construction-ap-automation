import { renderHook, act } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { useFormValidation } from "./useFormValidation"
import type { ValidationResult } from "@/modules/shared/lib/validation"

// ─── Fixture validator ────────────────────────────────────────────────────────

interface TestValues {
  name: string
  email: string
}

function validate(values: TestValues): ValidationResult {
  const errors: Record<string, string> = {}
  if (!values.name.trim()) errors.name = "Name is required"
  if (!values.email.includes("@")) errors.email = "Invalid email"
  return { valid: Object.keys(errors).length === 0, errors }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useFormValidation", () => {
  it("shows no errors initially for untouched fields", () => {
    const values: TestValues = { name: "", email: "bad" }
    const { result } = renderHook(() => useFormValidation(values, validate))
    expect(result.current.errors).toEqual({})
    expect(result.current.hasErrors).toBe(false)
  })

  it("shows error only for touched field", () => {
    const values: TestValues = { name: "", email: "bad" }
    const { result } = renderHook(() => useFormValidation(values, validate))
    act(() => result.current.touch("name"))
    expect(result.current.errors.name).toBe("Name is required")
    expect(result.current.errors.email).toBeUndefined()
  })

  it("validateAll shows all errors and returns false for invalid form", () => {
    const values: TestValues = { name: "", email: "bad" }
    const { result } = renderHook(() => useFormValidation(values, validate))
    let valid: boolean
    act(() => {
      valid = result.current.validateAll()
    })
    expect(valid!).toBe(false)
    expect(result.current.errors.name).toBe("Name is required")
    expect(result.current.errors.email).toBe("Invalid email")
    expect(result.current.hasErrors).toBe(true)
  })

  it("validateAll returns true for valid form", () => {
    const values: TestValues = { name: "Alice", email: "alice@example.com" }
    const { result } = renderHook(() => useFormValidation(values, validate))
    let valid: boolean
    act(() => {
      valid = result.current.validateAll()
    })
    expect(valid!).toBe(true)
    expect(result.current.errors).toEqual({})
  })

  it("reset clears touched state and hides errors", () => {
    const values: TestValues = { name: "", email: "bad" }
    const { result } = renderHook(() => useFormValidation(values, validate))
    act(() => {
      result.current.touch("name")
      result.current.touch("email")
    })
    expect(Object.keys(result.current.errors).length).toBe(2)
    act(() => result.current.reset())
    expect(result.current.errors).toEqual({})
  })

  it("touchAll marks multiple fields at once", () => {
    const values: TestValues = { name: "", email: "bad" }
    const { result } = renderHook(() => useFormValidation(values, validate))
    act(() => result.current.touchAll(["name", "email"]))
    expect(result.current.errors.name).toBeDefined()
    expect(result.current.errors.email).toBeDefined()
  })

  it("clears error when value becomes valid after touch", () => {
    let values: TestValues = { name: "", email: "alice@example.com" }
    const validate_ = vi.fn((v: TestValues) => validate(v))
    const { result, rerender } = renderHook(
      (vals: TestValues) => useFormValidation(vals, validate_),
      { initialProps: values },
    )
    act(() => result.current.touch("name"))
    expect(result.current.errors.name).toBe("Name is required")
    // Fix the value
    values = { name: "Alice", email: "alice@example.com" }
    rerender(values)
    expect(result.current.errors.name).toBeUndefined()
  })
})
