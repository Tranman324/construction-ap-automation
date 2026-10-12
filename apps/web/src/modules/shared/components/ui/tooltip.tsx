"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/modules/shared/lib/utils"

const WARM_NEIGHBOR_MS = 400
const openTooltipIds = new Set<symbol>()
let closeTimer: number | null = null

function cancelCloseTimer() {
  if (closeTimer !== null) window.clearTimeout(closeTimer)
  closeTimer = null
}

function setBodyOpen(id: symbol, open: boolean) {
  if (open) {
    cancelCloseTimer()
    openTooltipIds.add(id)
    document.body.setAttribute("data-tip-open", "true")
    return
  }
  if (!openTooltipIds.delete(id) || openTooltipIds.size > 0) return
  cancelCloseTimer()
  closeTimer = window.setTimeout(() => {
    closeTimer = null
    if (openTooltipIds.size === 0) document.body.removeAttribute("data-tip-open")
  }, WARM_NEIGHBOR_MS)
}

const TooltipLifecycleContext = React.createContext<((id: symbol, open: boolean) => void) | null>(null)
const TooltipWarmContext = React.createContext(false)

function TooltipProvider({
  delayDuration = 0,
  skipDelayDuration = WARM_NEIGHBOR_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  const ownedIds = React.useRef(new Set<symbol>())
  const onOpenChange = React.useCallback((id: symbol, open: boolean) => {
    if (open) ownedIds.current.add(id)
    else ownedIds.current.delete(id)
    setBodyOpen(id, open)
  }, [])

  React.useEffect(() => () => {
    for (const id of ownedIds.current) openTooltipIds.delete(id)
    ownedIds.current.clear()
    if (openTooltipIds.size === 0) {
      cancelCloseTimer()
      document.body.removeAttribute("data-tip-open")
    }
  }, [])

  return (
    <TooltipLifecycleContext.Provider value={onOpenChange}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
        {...props}
      />
    </TooltipLifecycleContext.Provider>
  )
}

function Tooltip({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const lifecycle = React.useContext(TooltipLifecycleContext)
  const id = React.useRef(Symbol("tooltip")).current
  const [warm, setWarm] = React.useState(() =>
    Boolean((open ?? defaultOpen) && typeof document !== "undefined" && document.body.hasAttribute("data-tip-open"))
  )
  const wasOpen = React.useRef(Boolean(open ?? defaultOpen))

  React.useEffect(() => {
    if (open !== undefined) {
      if (open && !wasOpen.current) setWarm(document.body.hasAttribute("data-tip-open"))
      wasOpen.current = open
      lifecycle?.(id, open)
    }
    else if (defaultOpen) lifecycle?.(id, true)
  }, [defaultOpen, id, lifecycle, open])
  React.useEffect(() => () => lifecycle?.(id, false), [id, lifecycle])

  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(nextOpen) => {
        if (nextOpen && !wasOpen.current) setWarm(document.body.hasAttribute("data-tip-open"))
        if (open === undefined) {
          wasOpen.current = nextOpen
          lifecycle?.(id, nextOpen)
        }
        onOpenChange?.(nextOpen)
      }}
      {...props}
    >
      <TooltipWarmContext.Provider value={warm}>{children}</TooltipWarmContext.Provider>
    </TooltipPrimitive.Root>
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const warm = React.useContext(TooltipWarmContext)
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        data-tip-warm={warm ? "true" : undefined}
        sideOffset={sideOffset}
        className={cn(
          "bg-foreground text-background z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
