import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { SaveBar } from "./SaveBar"

describe("SaveBar", () => {
  const defaultProps = {
    onSave: vi.fn(),
    onDiscard: vi.fn(),
  }

  it("renders with default message", () => {
    render(<SaveBar {...defaultProps} />)
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument()
  })

  it("renders custom message", () => {
    render(<SaveBar {...defaultProps} message="Profile has changes" />)
    expect(screen.getByText("Profile has changes")).toBeInTheDocument()
  })

  it("shows dirty count when dirtyCount > 0", () => {
    render(<SaveBar {...defaultProps} dirtyCount={3} />)
    expect(screen.getByTestId("save-bar-count")).toHaveTextContent("· 3 fields")
  })

  it("shows singular field text when dirtyCount is 1", () => {
    render(<SaveBar {...defaultProps} dirtyCount={1} />)
    expect(screen.getByTestId("save-bar-count")).toHaveTextContent("· 1 field")
    // Ensure no trailing "s"
    expect(screen.getByTestId("save-bar-count").textContent).not.toContain("fields")
  })

  it("does not show count when dirtyCount is 0", () => {
    render(<SaveBar {...defaultProps} dirtyCount={0} />)
    expect(screen.queryByTestId("save-bar-count")).not.toBeInTheDocument()
  })

  it("renders amber status dot", () => {
    render(<SaveBar {...defaultProps} />)
    expect(screen.getByTestId("save-bar-dot")).toBeInTheDocument()
  })

  it("uses sticky positioning (not fixed)", () => {
    render(<SaveBar {...defaultProps} />)
    const bar = screen.getByTestId("save-bar")
    expect(bar.className).toContain("sticky")
    expect(bar.className).not.toContain("fixed")
  })

  it("calls onSave when Save button is clicked", () => {
    const onSave = vi.fn()
    render(<SaveBar {...defaultProps} onSave={onSave} />)
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it("calls onDiscard when Discard button is clicked", () => {
    const onDiscard = vi.fn()
    render(<SaveBar {...defaultProps} onDiscard={onDiscard} />)
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }))
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it("shows Saving… and disables buttons when saving", () => {
    render(<SaveBar {...defaultProps} saving />)
    const saveBtn = screen.getByRole("button", { name: "Saving…" })
    expect(saveBtn).toBeDisabled()
    expect(saveBtn).toHaveTextContent("Saving…")
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled()
  })

  it("uses custom saveLabel", () => {
    render(<SaveBar {...defaultProps} saveLabel="Update profile" />)
    expect(screen.getByRole("button", { name: "Update profile" })).toBeInTheDocument()
  })

  it("has region role and accessible label", () => {
    render(<SaveBar {...defaultProps} />)
    const bar = screen.getByRole("region")
    expect(bar).toHaveAttribute("aria-label", "Unsaved changes")
  })
})
