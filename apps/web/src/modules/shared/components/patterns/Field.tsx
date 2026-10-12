"use client"

import * as React from "react"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import { cn } from "@/modules/shared/lib/utils"
import type { InvoiceFieldState } from "./invoiceFieldState"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FieldProps {
  /** Field label text. */
  label?: string
  /** id of the control, wired to the label's htmlFor. */
  htmlFor?: string
  /** Show a required asterisk beside the label. */
  required?: boolean
  /** Show an "(optional)" hint next to the label. */
  optional?: boolean
  /** Helper text below the control (hidden when error/success is set). */
  hint?: string
  /** Inline error message — turns the control border red and shows an alert glyph. */
  error?: string
  /** Inline success message — green confirmation with check glyph. */
  success?: string
  /** Show the amber unsaved-change dot beside the label. */
  dirty?: boolean
  /** Opt into the invoice refresh marker grammar. */
  invoiceState?: InvoiceFieldState | null
  /** Span the full width inside a FormSection grid (grid-column: 1 / -1). */
  full?: boolean
  /** Extra classes on the outer wrapper. */
  className?: string
  /** The control (input, select, textarea, toggle, etc.). */
  children: React.ReactNode
}

// ─── Field ────────────────────────────────────────────────────────────────────

/**
 * Field — labeled form field with validation states (error/success),
 * dirty indicator, required/optional markers, and hint text.
 *
 * Translates DS FormField contract into repo Tailwind/TS idiom.
 * Injects aria-describedby and aria-invalid onto the first child control
 * via React.cloneElement when htmlFor is provided.
 *
 * @example
 * <Field label="Display name" htmlFor="name" required dirty error={errors.name} hint="Shown on your profile">
 *   <Input id="name" value={name} onChange={...} />
 * </Field>
 */
export function Field({
  label,
  htmlFor,
  required,
  optional,
  hint,
  error,
  success,
  dirty,
  invoiceState,
  full,
  className,
  children,
}: FieldProps) {
  const descId = htmlFor ? `${htmlFor}-desc` : undefined
  const hasMessage = !!(error || success || hint)

  // Determine validation state for control border styling
  const state = error ? "error" : success ? "success" : undefined

  // Inject aria props onto the first child element
  const child = React.Children.only(children) as React.ReactElement<
    React.HTMLAttributes<HTMLElement>
  >
  const childProps = child.props as {
    "aria-describedby"?: string
    "aria-invalid"?: string | boolean
    className?: string
  }
  const mergedDescribedBy = [
    childProps["aria-describedby"],
    hasMessage ? descId : undefined,
  ]
    .filter(Boolean)
    .join(" ") || undefined
  const mergedInvalid: "true" | undefined =
    childProps["aria-invalid"] != null
      ? (childProps["aria-invalid"] as "true" | undefined)
      : error
        ? "true"
        : undefined

  // Apply validation border styles to the child control
  const stateClasses = cn(
    childProps.className,
    state === "error" && "border-destructive shadow-[0_0_0_3px_oklch(from_var(--destructive)_l_c_h/0.18)]",
    state === "success" && "border-tone-emerald",
    invoiceState?.tone === "gray" && "border-l-[3px] border-l-muted-foreground dark:border-l-muted-foreground",
    invoiceState?.tone === "orange" && "border-l-[3px] border-l-tone-orange dark:border-l-tone-orange bg-tone-orange/10",
    invoiceState?.tone === "amber" && "border-l-[3px] border-l-tone-amber dark:border-l-tone-amber bg-tone-amber/10",
    invoiceState?.tone === "violet" && "border-l-[3px] border-l-tone-violet dark:border-l-tone-violet",
    !error && invoiceState?.tone === "amber" && "aria-invalid:border-tone-amber aria-invalid:ring-tone-amber/20 dark:aria-invalid:ring-tone-amber/40",
    !error && invoiceState?.tone === "orange" && "aria-invalid:border-tone-orange aria-invalid:ring-tone-orange/20 dark:aria-invalid:ring-tone-orange/40",
  )

  const enhancedChild =
    React.isValidElement(child)
      ? React.cloneElement(child, {
          ...(descId ? { "aria-describedby": mergedDescribedBy } : {}),
          ...(mergedInvalid !== undefined ? { "aria-invalid": mergedInvalid } : {}),
          ...(invoiceState?.ariaInvalid ? { "aria-invalid": "true" } : {}),
          ...((state || invoiceState?.tone) ? { className: stateClasses } : {}),
        } as React.HTMLAttributes<HTMLElement>)
      : child

  return (
    <div
      className={cn(
        "flex flex-col gap-[7px]",
        full && "col-span-full",
        className,
      )}
      data-testid="field"
    >
      {label && (
        <label
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold leading-none text-foreground"
          htmlFor={htmlFor}
        >
          {label}
          {required && (
            <span className="font-bold text-destructive" aria-hidden="true">
              *
            </span>
          )}
          {optional && (
            <span className="text-xs font-normal text-muted-foreground">
              (optional)
            </span>
          )}
          {invoiceState?.label && (
            <span
              className={cn(
                "text-[10px] font-bold uppercase tracking-[0.08em]",
                invoiceState.tone === "gray" && "text-muted-foreground",
                invoiceState.tone === "orange" && "text-tone-orange",
                invoiceState.tone === "amber" && "text-tone-amber",
                invoiceState.tone === "violet" && "text-tone-violet",
              )}
              data-testid="invoice-field-marker"
            >
              {invoiceState.label}
            </span>
          )}
          {dirty && !invoiceState && (
            <span
              className="size-[7px] shrink-0 rounded-full bg-tone-amber"
              title="Unsaved change"
              data-testid="dirty-dot"
            />
          )}
        </label>
      )}

      {enhancedChild}

      {error ? (
        <span
          id={descId}
          role="alert"
          className="inline-flex items-center gap-[5px] text-xs font-medium leading-snug text-destructive"
        >
          <AlertCircle className="size-[13px] shrink-0" aria-hidden="true" />
          {error}
        </span>
      ) : success ? (
        <span
          id={descId}
          className="inline-flex items-center gap-[5px] text-xs font-medium leading-snug text-tone-emerald"
        >
          <CheckCircle2 className="size-[13px] shrink-0" aria-hidden="true" />
          {success}
        </span>
      ) : hint ? (
        <span
          id={descId}
          className="text-xs font-normal leading-snug text-muted-foreground"
        >
          {hint}
        </span>
      ) : null}
    </div>
  )
}
