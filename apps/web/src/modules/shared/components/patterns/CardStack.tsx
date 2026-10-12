"use client"

import * as React from "react"

import { getSurfaceMotionClassName, getSurfaceMotionDurationMs } from "./SurfaceMotion"
import styles from "./CardStack.module.css"
import { cn } from "@/modules/shared/lib/utils"

export interface CardStackRenderContext {
  isFront: boolean
  isPending: boolean
  onResolve: () => void
}

export interface CardStackProps<T> {
  items: readonly T[]
  getItemId: (item: T) => string
  renderItem: (item: T, context: CardStackRenderContext) => React.ReactNode
  /** Return true only after the domain/server confirms the item is resolved. */
  onResolve: (item: T) => boolean | Promise<boolean>
  /** Fires once after the confirmed exit transition (or its fallback) completes. */
  onExited?: (item: T) => void
  className?: string
  /** Lets card content establish the stack height instead of using the compact fixed slot. */
  fitContent?: boolean
}

/**
 * Controlled invoice card stack. The caller owns the unresolved item set;
 * this component only exposes the front action and a confirmed exit state.
 */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false
}

export function CardStack<T>({ items, getItemId, renderItem, onResolve, onExited, className, fitContent = false }: CardStackProps<T>) {
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [exiting, setExiting] = React.useState<{ id: string; item: T } | null>(null)
  const [resolvedIds, setResolvedIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const [promotingId, setPromotingId] = React.useState<string | null>(null)
  const [promotionPhase, setPromotionPhase] = React.useState<"preparing" | "running" | null>(null)
  const exitTimerRef = React.useRef<number | null>(null)
  const completedExitIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    setResolvedIds((current) => {
      const next = new Set(current)
      let changed = false
      for (const id of current) {
        if (!items.some((item) => getItemId(item) === id)) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [getItemId, items])

  const finishExit = React.useCallback((id: string) => {
    if (!exiting || exiting.id !== id || completedExitIdRef.current === id) return

    completedExitIdRef.current = id
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current)
    exitTimerRef.current = null

    const nextFront = items.find((item) => getItemId(item) !== id && !resolvedIds.has(getItemId(item)))
    setResolvedIds((current) => new Set(current).add(id))
    setExiting(null)
    setPromotingId(nextFront ? getItemId(nextFront) : null)
    setPromotionPhase(nextFront ? "preparing" : null)
    onExited?.(exiting.item)
  }, [exiting, getItemId, items, onExited, resolvedIds])

  React.useEffect(() => {
    if (!exiting) return

    completedExitIdRef.current = null
    const duration = getSurfaceMotionDurationMs("card-resolve", prefersReducedMotion())
    exitTimerRef.current = window.setTimeout(() => finishExit(exiting.id), duration + (duration ? 50 : 0))

    return () => {
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current)
      exitTimerRef.current = null
    }
  }, [exiting, finishExit])

  React.useEffect(() => {
    if (!promotingId) return

    const duration = getSurfaceMotionDurationMs("card-promote", prefersReducedMotion())
    const timer = window.setTimeout(() => {
      setPromotingId(null)
      setPromotionPhase(null)
    }, duration + (duration ? 50 : 0))
    return () => window.clearTimeout(timer)
  }, [promotingId])

  React.useLayoutEffect(() => {
    if (!promotingId || promotionPhase !== "preparing") return
    if (typeof window.requestAnimationFrame !== "function") {
      setPromotionPhase("running")
      return
    }

    const frame = window.requestAnimationFrame(() => setPromotionPhase("running"))
    return () => window.cancelAnimationFrame(frame)
  }, [promotingId, promotionPhase])

  const requestResolve = React.useCallback(async (item: T) => {
    const id = getItemId(item)
    if (pendingId || exiting || !items.length || id !== getItemId(items[0])) return

    setPendingId(id)
    try {
      const confirmed = await onResolve(item)
      if (confirmed) {
        completedExitIdRef.current = null
        setExiting({ id, item })
      }
    } finally {
      setPendingId(null)
    }
  }, [exiting, getItemId, items, onResolve, pendingId])

  const visibleItems = items.filter((item) => !resolvedIds.has(getItemId(item)))
  const renderedItems = exiting
    ? [exiting.item, ...visibleItems.filter((item) => getItemId(item) !== exiting.id)]
    : visibleItems

  return (
    <div
      className={cn(styles.stack, fitContent && styles.fitContent, className)}
      data-fit-content={fitContent ? "true" : "false"}
      data-testid="invoice-card-stack"
    >
      {renderedItems.map((item, index) => {
        const id = getItemId(item)
        const isFront = index === 0
        const isPending = pendingId === id
        const isExiting = exiting?.id === id
        const isPromoting = promotingId === id && !isExiting
        const isPromotionPreparing = isPromoting && promotionPhase === "preparing"
        const isPromotionRunning = isPromoting && promotionPhase === "running"
        const motionState = isExiting ? "exit" : isPromotionPreparing ? "enter" : "rest"

        return (
          <div
            key={id}
            className={cn(
              styles.card,
              isFront ? styles.front : index === 1 ? styles.peekOne : index === 2 ? styles.peekTwo : styles.hidden,
              isExiting
                ? getSurfaceMotionClassName("card-resolve", motionState)
                : isPromoting
                  ? cn(getSurfaceMotionClassName("card-promote", motionState), isPromotionPreparing && styles.promotionStart)
                  : undefined,
            )}
            data-card-id={id}
            data-front={isFront ? "true" : "false"}
            data-state={isExiting ? "resolving" : isPromoting ? "promoting" : "ready"}
            onTransitionEnd={(event) => {
              if (event.target !== event.currentTarget) return
              if (isExiting && (event.propertyName === "transform" || event.propertyName === "opacity")) {
                finishExit(id)
              }
              if (isPromotionRunning && (event.propertyName === "transform" || event.propertyName === "opacity")) {
                setPromotionPhase(null)
                setPromotingId(null)
              }
            }}
          >
            {renderItem(item, {
              isFront,
              isPending,
              onResolve: () => void requestResolve(item),
            })}
          </div>
        )
      })}
    </div>
  )
}
