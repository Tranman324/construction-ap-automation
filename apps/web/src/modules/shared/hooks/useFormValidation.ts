"use client"

import { useState, useCallback, useMemo } from "react"
import type { FieldErrors, Validator } from "@/modules/shared/lib/validation"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseFormValidationReturn {
  /** Errors only for touched fields (or all fields after validateAll). */
  errors: FieldErrors
  /** Mark a single field as touched (shows its error immediately). */
  touch: (field: string) => void
  /** Mark multiple fields touched at once. */
  touchAll: (fields: string[]) => void
  /** Validate all fields, mark all as touched, return whether form is valid. */
  validateAll: () => boolean
  /** Reset touched state (clears visible errors without clearing values). */
  reset: () => void
  /** Whether any field currently has a visible error. */
  hasErrors: boolean
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useFormValidation — lightweight uncontrolled-form validation hook.
 *
 * Errors are only shown for touched fields, or for all fields after a
 * submit attempt (validateAll). Keeps form values outside this hook
 * so it composes cleanly with any state management approach.
 *
 * @example
 * const [values, setValues] = useState({ name: "", email: "" })
 * const { errors, touch, validateAll } = useFormValidation(values, (v) => {
 *   const errors: FieldErrors = {}
 *   if (!v.name.trim()) errors.name = "Required"
 *   if (!v.email.includes("@")) errors.email = "Invalid email"
 *   return { valid: Object.keys(errors).length === 0, errors }
 * })
 */
export function useFormValidation<T>(
  values: T,
  validate: Validator<T>,
): UseFormValidationReturn {
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)

  // Full error map (all fields) — recomputed on every render when values change
  const allErrors = useMemo(() => validate(values).errors, [values, validate])

  // Visible errors: only fields that are touched or showAll is set
  const errors = useMemo<FieldErrors>(() => {
    if (showAll) return allErrors
    const filtered: FieldErrors = {}
    for (const field of touched) {
      if (allErrors[field]) filtered[field] = allErrors[field]
    }
    return filtered
  }, [allErrors, touched, showAll])

  const touch = useCallback((field: string) => {
    setTouched((prev) => {
      if (prev.has(field)) return prev
      const next = new Set(prev)
      next.add(field)
      return next
    })
  }, [])

  const touchAll = useCallback((fields: string[]) => {
    setTouched((prev) => {
      const next = new Set(prev)
      fields.forEach((f) => next.add(f))
      return next
    })
  }, [])

  const validateAll = useCallback((): boolean => {
    setShowAll(true)
    const result = validate(values)
    return result.valid
  }, [values, validate])

  const reset = useCallback(() => {
    setTouched(new Set())
    setShowAll(false)
  }, [])

  const hasErrors = Object.keys(errors).length > 0

  return { errors, touch, touchAll, validateAll, reset, hasErrors }
}
