import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CardStack } from "./CardStack"
import { getSurfaceMotionClassName } from "./SurfaceMotion"

const items = [{ id: "one", label: "First" }, { id: "two", label: "Second" }, { id: "three", label: "Third" }]

beforeEach(() => {
  document.documentElement.style.setProperty("--dur-sheet", "280ms")
  document.documentElement.style.setProperty("--dur-reveal", "180ms")
  document.documentElement.style.setProperty("--dur-exit", "140ms")
})

afterEach(() => {
  vi.useRealTimers()
  for (const token of ["--dur-sheet", "--dur-reveal", "--dur-exit"]) document.documentElement.style.removeProperty(token)
})

function renderStack(
  onResolve: (item: (typeof items)[number]) => boolean | Promise<boolean>,
  onExited?: (item: (typeof items)[number]) => void,
) {
  return render(
    <CardStack
      items={items}
      getItemId={(item) => item.id}
      onResolve={onResolve}
      onExited={onExited}
      renderItem={(item, context) => (
        <div>
          <span>{item.label}</span>
          {context.isFront && <button type="button" onClick={context.onResolve} disabled={context.isPending}>Resolve</button>}
        </div>
      )}
    />,
  )
}

describe("CardStack", () => {
  it("makes only the front card interactive", () => {
    renderStack(() => false)

    expect(screen.getByTestId("invoice-card-stack")).toBeInTheDocument()
    expect(screen.getByTestId("invoice-card-stack").querySelectorAll('[data-front="true"]')).toHaveLength(1)
    expect(screen.getByTestId("invoice-card-stack").querySelector('[data-card-id="two"]')).toHaveAttribute("data-front", "false")
  })

  it("keeps the card rendered when the domain callback does not confirm resolution", async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn(() => false)
    renderStack(onResolve)

    await user.click(screen.getByRole("button", { name: "Resolve" }))

    expect(onResolve).toHaveBeenCalledWith(items[0])
    expect(screen.getByTestId("invoice-card-stack").querySelector('[data-card-id="one"]')).toHaveAttribute("data-state", "ready")
  })

  it("marks the front card as resolving only after confirmed resolution", async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn(() => true)
    renderStack(onResolve)

    await user.click(screen.getByRole("button", { name: "Resolve" }))

    await waitFor(() => expect(screen.getByTestId("invoice-card-stack").querySelector('[data-card-id="one"]')).toHaveAttribute("data-state", "resolving"))
  })

  it("completes exit exactly once and promotes the next card after transition end", async () => {
    const user = userEvent.setup()
    const onExited = vi.fn()
    renderStack(() => true, onExited)

    await user.click(screen.getByRole("button", { name: "Resolve" }))
    const exitingCard = screen.getByTestId("invoice-card-stack").querySelector('[data-card-id="one"]')!
    expect(exitingCard).toHaveClass(...getSurfaceMotionClassName("card-resolve", "exit").split(" "))
    fireEvent.transitionEnd(exitingCard, { propertyName: "transform" })
    fireEvent.transitionEnd(exitingCard, { propertyName: "opacity" })

    await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1))
    const promotedCard = screen.getByTestId("invoice-card-stack").querySelector('[data-card-id="two"]')!
    expect(promotedCard).toHaveAttribute("data-state", "promoting")
    const promoteRestClasses = getSurfaceMotionClassName("card-promote", "rest").split(" ")
    const promoteEnterClasses = getSurfaceMotionClassName("card-promote", "enter").split(" ")
    await waitFor(() => {
      expect(promotedCard).toHaveClass(...promoteRestClasses)
      expect(promotedCard).not.toHaveClass(promoteEnterClasses[1])
    })
    fireEvent.transitionEnd(promotedCard, { propertyName: "transform" })
    expect(promotedCard).toHaveAttribute("data-state", "ready")
  })

  it("uses the reduced-motion timer fallback when transitionend does not fire", async () => {
    const onExited = vi.fn()
    const originalMatchMedia = window.matchMedia
    const matchMedia = vi.fn().mockReturnValue({ matches: true } as MediaQueryList)
    Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia })
    vi.useFakeTimers()

    renderStack(() => true, onExited)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resolve" }))
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => vi.advanceTimersByTime(189))
    expect(onExited).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onExited).toHaveBeenCalledTimes(1)
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia })
  })

  it("uses the resolve and promote tokens for the fallback timers", async () => {
    vi.useFakeTimers()
    const onExited = vi.fn()
    renderStack(() => true, onExited)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resolve" }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByTestId("invoice-card-stack").querySelector('[data-card-id="one"]')).toHaveAttribute("data-state", "resolving")
    act(() => vi.advanceTimersByTime(329))
    expect(onExited).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onExited).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("invoice-card-stack").querySelector('[data-card-id="two"]')).toHaveAttribute("data-state", "promoting")
    act(() => vi.advanceTimersByTime(229))
    expect(screen.getByTestId("invoice-card-stack").querySelector('[data-card-id="two"]')).toHaveAttribute("data-state", "promoting")
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId("invoice-card-stack").querySelector('[data-card-id="two"]')).toHaveAttribute("data-state", "ready")
  })

  it("does not submit duplicate actions while an async resolution is pending", async () => {
    const user = userEvent.setup()
    let finish!: (value: boolean) => void
    const onResolve = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    renderStack(onResolve)

    await user.click(screen.getByRole("button", { name: "Resolve" }))
    await user.click(screen.getByRole("button", { name: "Resolve" }))
    expect(onResolve).toHaveBeenCalledTimes(1)

    finish(false)
    await waitFor(() => expect(screen.getByRole("button", { name: "Resolve" })).not.toBeDisabled())
  })
})
