// ─── Shared validation contract ───────────────────────────────────────────────
//
// Central home for the FieldErrors / ValidationResult / Validator types.
// Promoted from projects/lib/validation.ts (same Record<string,string> shape).
// Invoices' approvalValidation.ts can adopt this over time.

export type FieldErrors = Record<string, string>

export interface ValidationResult {
  valid: boolean
  errors: FieldErrors
}

export type Validator<T> = (values: T) => ValidationResult

// ─── Built-in validator helpers ───────────────────────────────────────────────

/** Mark a field required (trimmed non-empty). */
export function required(value: unknown, message = "This field is required"): string | undefined {
  if (value === null || value === undefined) return message
  if (typeof value === "string" && value.trim() === "") return message
  return undefined
}

/** Min string length. */
export function minLength(
  value: string,
  min: number,
  message = `Must be at least ${min} characters`,
): string | undefined {
  if (typeof value === "string" && value.length < min) return message
  return undefined
}

/** Max string length. */
export function maxLength(
  value: string,
  max: number,
  message = `Must be ${max} characters or fewer`,
): string | undefined {
  if (typeof value === "string" && value.length > max) return message
  return undefined
}

/** Basic email check. */
export function email(value: string, message = "Enter a valid email address"): string | undefined {
  if (typeof value === "string" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return message
  return undefined
}

/**
 * Compose multiple validator messages for a single field value.
 * Returns the first failing message (stop-on-first).
 */
export function composeField(
  value: unknown,
  ...validators: Array<(v: unknown) => string | undefined>
): string | undefined {
  for (const v of validators) {
    const msg = v(value)
    if (msg) return msg
  }
  return undefined
}
