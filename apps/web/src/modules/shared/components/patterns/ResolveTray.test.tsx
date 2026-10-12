import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ResolveTray } from "./ResolveTray"

const rows = [
  { id: "required", label: "Vendor", description: "Required" },
  { id: "waiver", label: "Lien waiver", waiting: true },
]

describe("ResolveTray", () => {
  it("derives the header, chip count, and waiting label from one row set", () => {
    render(<ResolveTray rows={rows} onApprove={vi.fn()} />)

    expect(screen.getByTestId("resolve-tray-header")).toHaveTextContent("To resolve (2) · 1 waiting")
    expect(screen.getByTestId("resolve-tray-count")).toHaveTextContent("2")
    expect(screen.getByTestId("resolve-row-waiver")).toHaveTextContent("Waiting")
    expect(screen.getByTestId("resolve-row-required")).toHaveTextContent("Required")
  })

  it("blocks Approve for rows or field blockers while leaving File independent", async () => {
    const user = userEvent.setup()
    const onApprove = vi.fn()
    const onFile = vi.fn()
    render(<ResolveTray rows={[]} fieldBlockers={1} onApprove={onApprove} onFile={onFile} />)

    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "File" }))
    expect(onFile).toHaveBeenCalledTimes(1)
  })

  it("does not render an approve gate when the unresolved set is empty", () => {
    render(<ResolveTray rows={[]} onApprove={vi.fn()} />)

    expect(screen.getByRole("button", { name: "Approve" })).not.toBeDisabled()
    expect(screen.getByTestId("resolve-tray-header")).toHaveTextContent("To resolve (0)")
  })
})
