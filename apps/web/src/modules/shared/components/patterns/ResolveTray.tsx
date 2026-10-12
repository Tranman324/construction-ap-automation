"use client"

import * as React from "react"

import { cn } from "@/modules/shared/lib/utils"

export interface ResolveTrayRow {
  id: string
  label: string
  description?: string
  waiting?: boolean
}

export interface ResolveTrayProps {
  rows: readonly ResolveTrayRow[]
  fieldBlockers?: number
  onApprove?: () => void
  onFile?: () => void
  fileDisabled?: boolean
  className?: string
}

/** A single-count resolve tray for invoice and document-panel consumers. */
export function ResolveTray({ rows, fieldBlockers = 0, onApprove, onFile, fileDisabled = false, className }: ResolveTrayProps) {
  const unresolvedCount = rows.length
  const waitingCount = rows.reduce((count, row) => count + (row.waiting ? 1 : 0), 0)
  const approveBlocked = unresolvedCount > 0 || fieldBlockers > 0
  const header = waitingCount > 0
    ? `To resolve (${unresolvedCount}) · ${waitingCount} waiting`
    : `To resolve (${unresolvedCount})`

  return (
    <aside className={cn("sticky bottom-0 z-10 border-t bg-card px-4 py-3", className)} data-testid="invoice-resolve-tray">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground" data-testid="resolve-tray-header">{header}</p>
          <span className="sr-only" data-testid="resolve-tray-count">{unresolvedCount}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onFile && <button type="button" className="h-7 rounded-md border px-[11px] text-xs font-semibold" onClick={onFile} disabled={fileDisabled}>File</button>}
          {onApprove && <button type="button" className="h-7 rounded-md bg-primary px-[11px] text-xs font-semibold text-primary-foreground" onClick={onApprove} disabled={approveBlocked}>Approve</button>}
        </div>
      </div>
      {rows.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-label="Items to resolve">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs" data-testid={`resolve-row-${row.id}`}>
              <span className="min-w-0 truncate text-foreground">{row.label}</span>
              <span className="shrink-0 text-muted-foreground">
                {row.waiting ? "Waiting" : row.description}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
