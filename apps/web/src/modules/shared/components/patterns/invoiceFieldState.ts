export type InvoiceFieldMarker =
  | "none"
  | "optional"
  | "remove"
  | "required"
  | "edited"

export interface InvoiceFieldStateInput<T = unknown> {
  value: T
  baseline?: T
  /** Server-confirmed origin of the current value, separate from save dirty state. */
  manuallyEdited?: boolean
  ownedElsewhere?: boolean
  mustBeEmpty?: boolean
  required?: boolean
  optional?: boolean
  isEqual?: (value: T, baseline: T | undefined) => boolean
}

export interface InvoiceFieldState {
  marker: InvoiceFieldMarker
  label: "OPTIONAL" | "REMOVE" | "REQUIRED" | "EDITED" | null
  tone: "gray" | "orange" | "amber" | "violet" | null
  ariaInvalid: boolean
}

export function isInvoiceFieldEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim().length === 0
  if (typeof value === "number") return value === 0
  return false
}

export function getInvoiceFieldState<T>({
  value,
  baseline,
  manuallyEdited = false,
  ownedElsewhere = false,
  mustBeEmpty = false,
  required = false,
  isEqual = (current, initial) => Object.is(current, initial),
}: InvoiceFieldStateInput<T>): InvoiceFieldState {
  const empty = isInvoiceFieldEmpty(value)

  if (ownedElsewhere) {
    // Managed controls keep their disabled state and explanatory hint. They
    // are not empty user inputs and do not introduce a fifth marker state.
    return { marker: "none", label: null, tone: null, ariaInvalid: false }
  }

  if (mustBeEmpty && !empty) {
    return { marker: "remove", label: "REMOVE", tone: "orange", ariaInvalid: true }
  }

  if (required && empty) {
    return { marker: "required", label: "REQUIRED", tone: "amber", ariaInvalid: true }
  }

  if (empty) {
    return { marker: "optional", label: "OPTIONAL", tone: "gray", ariaInvalid: false }
  }

  if (manuallyEdited || !isEqual(value, baseline)) {
    return { marker: "edited", label: "EDITED", tone: "violet", ariaInvalid: false }
  }

  // Populated unchanged/extracted values have no marker.
  return { marker: "none", label: null, tone: null, ariaInvalid: false }
}
