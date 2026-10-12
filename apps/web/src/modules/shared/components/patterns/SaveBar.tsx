"use client"

import * as React from "react"
import { cn } from "@/modules/shared/lib/utils"
import { Button } from "@/modules/shared/components/ui/button"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SaveBarProps {
  /** Number of dirty fields — shown next to the status text. */
  dirtyCount?: number
  /** Override the status text (default "Unsaved changes"). */
  message?: string
  /** Save button label (defaults to "Save changes"). */
  saveLabel?: string
  /** Disables actions and shows "Saving…". */
  saving?: boolean
  onSave: () => void
  onDiscard: () => void
  className?: string
}

// ─── SaveBar ──────────────────────────────────────────────────────────────────

/**
 * SaveBar — sticky dirty-tracking save bar. Render only when the form is dirty.
 *
 * Translates DS `.tbx-savebar` into repo Tailwind idiom:
 * - Sticky bottom (in-flow, not fixed/centered)
 * - Frosted glass background with border + shadow
 * - Amber dot + status text + dirty count
 * - Discard (ghost) + Save (primary) actions pushed right
 *
 * @example
 * {isDirty && (
 *   <SaveBar
 *     dirtyCount={3}
 *     saving={mutation.isPending}
 *     onSave={handleSave}
 *     onDiscard={handleDiscard}
 *   />
 * )}
 */
export function SaveBar({
  dirtyCount = 0,
  message = "Unsaved changes",
  saveLabel = "Save changes",
  saving = false,
  onSave,
  onDiscard,
  className,
}: SaveBarProps) {
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      data-testid="save-bar"
      className={cn(
        // Sticky positioning (in-flow, not fixed)
        "sticky bottom-4 z-30",
        // Layout
        "flex items-center gap-3.5",
        // Frosted glass card
        "rounded-[14px] border border-border bg-card/90 px-4 py-3 shadow-lg",
        "supports-[backdrop-filter]:backdrop-blur-[12px]",
        // Entry animation
        "motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in motion-safe:duration-200",
        className,
      )}
    >
      {/* Status: dot + text + count */}
      <span className="inline-flex items-center gap-2 text-[13.5px] font-medium text-foreground">
        <span
          className="size-2 shrink-0 rounded-full bg-tone-amber"
          aria-hidden="true"
          data-testid="save-bar-dot"
        />
        {message}
        {dirtyCount > 0 && (
          <span className="tabular-nums text-muted-foreground" data-testid="save-bar-count">
            · {dirtyCount} {dirtyCount === 1 ? "field" : "fields"}
          </span>
        )}
      </span>

      {/* Actions: pushed right */}
      <div className="ml-auto flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          disabled={saving}
          aria-label="Discard changes"
        >
          Discard
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving}
          aria-label={saving ? "Saving…" : saveLabel}
        >
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  )
}
