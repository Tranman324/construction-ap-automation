"use client"

import { useState, useCallback } from "react"
import type { ProfileValues } from "@/modules/settings/types"
import { useFormValidation } from "@/modules/shared/hooks/useFormValidation"
import { useDirtyState } from "@/modules/shared/hooks/useDirtyState"
import { required, email, maxLength, composeField } from "@/modules/shared/lib/validation"
import type { FieldErrors, ValidationResult } from "@/modules/shared/lib/validation"

// ─── Validator ────────────────────────────────────────────────────────────────

function validateProfile(values: ProfileValues): ValidationResult {
  const errors: FieldErrors = {}

  const nameErr = composeField(
    values.displayName,
    (v) => required(v),
    (v) => maxLength(v as string, 80),
  )
  if (nameErr) errors.displayName = nameErr

  const emailErr = composeField(
    values.email,
    (v) => required(v),
    (v) => email(v as string),
  )
  if (emailErr) errors.email = emailErr

  const titleErr = maxLength(values.title, 120)
  if (titleErr) errors.title = titleErr

  return { valid: Object.keys(errors).length === 0, errors }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Count how many fields differ between current values and the clean snapshot. */
function countDirtyFields(current: ProfileValues, snapshot: ProfileValues): number {
  return (Object.keys(current) as Array<keyof ProfileValues>).filter(
    (k) => current[k] !== snapshot[k],
  ).length
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const DEFAULT_VALUES: ProfileValues = {
  displayName: "",
  email: "",
  title: "",
}

export function useProfileForm(initialValues: Partial<ProfileValues> = {}) {
  const [values, setValues] = useState<ProfileValues>({
    ...DEFAULT_VALUES,
    ...initialValues,
  })

  const { errors, touch, validateAll, reset: resetValidation } = useFormValidation(
    values,
    validateProfile,
  )

  const { isDirty, markClean, snapshot } = useDirtyState(values)

  const dirtyCount = countDirtyFields(values, snapshot)

  const setField = useCallback(<K extends keyof ProfileValues>(
    field: K,
    value: ProfileValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [field]: value }))
  }, [])

  const discard = useCallback(() => {
    setValues(snapshot)
    markClean(snapshot)
    resetValidation()
  }, [snapshot, markClean, resetValidation])

  return {
    values,
    setField,
    errors,
    touch,
    validateAll,
    isDirty,
    dirtyCount,
    markClean,
    discard,
  }
}
