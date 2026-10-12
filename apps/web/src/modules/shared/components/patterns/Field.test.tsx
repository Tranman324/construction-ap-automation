import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { Field } from "./Field"
import { getInvoiceFieldState } from "./invoiceFieldState"
import { Input } from "@/modules/shared/components/ui/input"

describe("Field", () => {
  it.each(["amber", "orange"] as const)("preserves explicit errors over the %s invoice state on Input", (tone) => {
    const invoiceState = getInvoiceFieldState(tone === "amber"
      ? { value: "", required: true }
      : { value: "unexpected", mustBeEmpty: true })
    const display = (error?: string) => <Field label="Value" htmlFor="value" invoiceState={invoiceState} error={error}><Input id="value" /></Field>
    const view = render(display())
    expect(screen.getByRole("textbox")).toHaveClass(`aria-invalid:border-tone-${tone}`)
    expect(screen.getByRole("textbox")).not.toHaveClass("aria-invalid:border-destructive")
    view.rerender(display("Save failed"))
    expect(screen.getByRole("textbox")).toHaveClass("aria-invalid:border-destructive")
    expect(screen.getByRole("textbox")).not.toHaveClass(`aria-invalid:border-tone-${tone}`)
    expect(screen.getByRole("alert")).toHaveTextContent("Save failed")
  })

  it("leaves extracted data unmarked and shows only the four requested states", () => {
    const display = (value: string, baseline: string, required = false, mustBeEmpty = false) => (
      <Field label="Amount" htmlFor="amount" invoiceState={getInvoiceFieldState({ value, baseline, required, mustBeEmpty })}>
        <input id="amount" />
      </Field>
    )
    const view = render(display("750", "750"))
    expect(screen.queryByTestId("invoice-field-marker")).not.toBeInTheDocument()
    expect(screen.getByRole("textbox")).not.toHaveClass("border-l-tone-cyan")
    expect(screen.getByRole("textbox")).not.toHaveClass("border-l-[3px]")
    for (const [value, baseline, required, mustBeEmpty, label, tone, invalid] of [
      ["800", "750", false, false, "EDITED", "violet", false],
      ["", "750", true, false, "REQUIRED", "amber", true],
      ["", "750", false, false, "OPTIONAL", "gray", false],
      ["800", "750", false, true, "REMOVE", "orange", true],
    ] as const) {
      view.rerender(display(value, baseline, required, mustBeEmpty))
      expect(screen.getByTestId("invoice-field-marker")).toHaveTextContent(label)
      expect(screen.getByRole("textbox")).toHaveClass(tone === "gray" ? "border-l-muted-foreground" : `border-l-tone-${tone}`)
      if (invalid) expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true")
      else expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid")
    }
    view.rerender(display("800", "750"))
    expect(screen.getByRole("textbox")).toHaveClass("border-l-tone-violet")
    view.rerender(display("750", "750"))
    expect(screen.queryByTestId("invoice-field-marker")).not.toBeInTheDocument()
    expect(screen.getByRole("textbox")).not.toHaveClass("border-l-tone-violet")
    expect(screen.getByRole("textbox")).not.toHaveClass("border-l-[3px]")
  })

  it("renders label and children", () => {
    render(
      <Field label="Name" htmlFor="name">
        <input id="name" />
      </Field>,
    )
    expect(screen.getByText("Name")).toBeInTheDocument()
    expect(screen.getByRole("textbox")).toBeInTheDocument()
  })

  it("shows required asterisk when required is true", () => {
    render(
      <Field label="Email" required>
        <input />
      </Field>,
    )
    expect(screen.getByText("*")).toBeInTheDocument()
  })

  it("shows optional marker when optional is true", () => {
    render(
      <Field label="Title" optional>
        <input />
      </Field>,
    )
    expect(screen.getByText("(optional)")).toBeInTheDocument()
  })

  it("shows dirty dot when dirty is true", () => {
    render(
      <Field label="Name" dirty>
        <input />
      </Field>,
    )
    expect(screen.getByTestId("dirty-dot")).toBeInTheDocument()
    expect(screen.getByTitle("Unsaved change")).toBeInTheDocument()
  })

  it("does not show dirty dot when dirty is false/undefined", () => {
    render(
      <Field label="Name">
        <input />
      </Field>,
    )
    expect(screen.queryByTestId("dirty-dot")).not.toBeInTheDocument()
  })

  it("shows hint text when no error or success", () => {
    render(
      <Field label="Name" hint="Some helpful text">
        <input />
      </Field>,
    )
    expect(screen.getByText("Some helpful text")).toBeInTheDocument()
  })

  it("shows error message and hides hint", () => {
    render(
      <Field label="Name" error="Required" hint="Should be hidden">
        <input />
      </Field>,
    )
    expect(screen.getByText("Required")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.queryByText("Should be hidden")).not.toBeInTheDocument()
  })

  it("shows success message and hides hint", () => {
    render(
      <Field label="Name" success="Looks good!" hint="Should be hidden">
        <input />
      </Field>,
    )
    expect(screen.getByText("Looks good!")).toBeInTheDocument()
    expect(screen.queryByText("Should be hidden")).not.toBeInTheDocument()
  })

  it("error takes precedence over success", () => {
    render(
      <Field label="Name" error="Bad value" success="Nope">
        <input />
      </Field>,
    )
    expect(screen.getByText("Bad value")).toBeInTheDocument()
    expect(screen.queryByText("Nope")).not.toBeInTheDocument()
  })

  it("applies col-span-full when full is true", () => {
    render(
      <Field label="Bio" full>
        <input />
      </Field>,
    )
    expect(screen.getByTestId("field").className).toContain("col-span-full")
  })

  it("sets aria-invalid on child when error is present", () => {
    render(
      <Field label="Email" htmlFor="email" error="Invalid email">
        <input id="email" />
      </Field>,
    )
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true")
  })

  it("sets aria-describedby on child linking to message", () => {
    render(
      <Field label="Email" htmlFor="email" hint="Enter your email">
        <input id="email" />
      </Field>,
    )
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "aria-describedby",
      "email-desc",
    )
  })

  it("keeps the default Field contract while opting into invoice markers", () => {
    const { rerender } = render(
      <Field label="Vendor" dirty>
        <input />
      </Field>,
    )

    expect(screen.getByTestId("dirty-dot")).toBeInTheDocument()

    rerender(
      <Field label="Vendor" invoiceState={{ marker: "required", label: "REQUIRED", tone: "amber", ariaInvalid: true }}>
        <input />
      </Field>,
    )

    expect(screen.getByTestId("invoice-field-marker")).toHaveTextContent("REQUIRED")
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true")
    expect(screen.queryByTestId("dirty-dot")).not.toBeInTheDocument()
  })
})
