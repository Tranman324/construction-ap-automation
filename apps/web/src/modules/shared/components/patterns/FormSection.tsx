"use client"

import * as React from "react"
import { cn } from "@/modules/shared/lib/utils"

// ─── FormPage ─────────────────────────────────────────────────────────────────

export interface FormPageProps {
  title?: string
  description?: string
  /** Action slot — rendered top-right (e.g. back button, breadcrumbs). */
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/**
 * FormPage — outer page shell for settings-style form pages.
 * Provides consistent title/description header and vertical section spacing.
 */
export function FormPage({ title, description, action, className, children }: FormPageProps) {
  return (
    <div className={cn("mx-auto w-full max-w-2xl py-8 px-4", className)}>
      {(title || action) && (
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            {title && (
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            )}
            {description && (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

// ─── FormSection ──────────────────────────────────────────────────────────────

export interface FormSectionProps {
  title?: string
  description?: string
  /**
   * Lay children out in the responsive 2-col field grid (default true).
   * Set false for full-width custom content.
   * Fields can use `full` prop to span both columns.
   */
  grid?: boolean
  className?: string
  children: React.ReactNode
}

/**
 * FormSection — titled group of form fields with a responsive 2-column grid.
 *
 * Translates DS `.tbx-form-section` into repo Tailwind idiom:
 * - Separated by bottom border (last child has no border)
 * - Head with title (font-bold 16px) + description (13px muted, max 64ch)
 * - Responsive 2-col grid with 18px gap; collapses to 1-col below 720px
 */
export function FormSection({
  title,
  description,
  grid = true,
  className,
  children,
}: FormSectionProps) {
  return (
    <section
      className={cn(
        "border-b border-border/70 py-[22px] first:pt-1 last:border-b-0",
        className,
      )}
      data-testid="form-section"
    >
      {(title || description) && (
        <div className="mb-4">
          {title && (
            <h3 className="text-base font-bold tracking-tight text-foreground">
              {title}
            </h3>
          )}
          {description && (
            <p className="mt-1 max-w-[64ch] text-[13px] leading-normal text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      )}

      {grid ? (
        <div className="grid grid-cols-1 gap-[18px] min-[720px]:grid-cols-2">
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  )
}
