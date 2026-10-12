import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { FormSection, FormPage } from "./FormSection"

describe("FormSection", () => {
  it("renders title and description", () => {
    render(
      <FormSection title="Profile" description="How you appear to others">
        <div>child</div>
      </FormSection>,
    )
    expect(screen.getByText("Profile")).toBeInTheDocument()
    expect(screen.getByText("How you appear to others")).toBeInTheDocument()
  })

  it("renders children in a 2-col grid by default", () => {
    render(
      <FormSection title="Section">
        <div data-testid="child-1">A</div>
        <div data-testid="child-2">B</div>
      </FormSection>,
    )
    const section = screen.getByTestId("form-section")
    // The grid container should have grid classes
    const grid = section.querySelector(".grid")
    expect(grid).toBeInTheDocument()
    expect(grid?.children.length).toBe(2)
  })

  it("renders children without grid when grid=false", () => {
    render(
      <FormSection title="Section" grid={false}>
        <div data-testid="child-1">A</div>
      </FormSection>,
    )
    const section = screen.getByTestId("form-section")
    // No grid wrapper
    expect(section.querySelector(".grid")).not.toBeInTheDocument()
    expect(screen.getByTestId("child-1")).toBeInTheDocument()
  })

  it("renders without title or description", () => {
    render(
      <FormSection>
        <div>content</div>
      </FormSection>,
    )
    expect(screen.getByTestId("form-section")).toBeInTheDocument()
    expect(screen.getByText("content")).toBeInTheDocument()
  })

  it("applies border-bottom styling via class", () => {
    render(
      <FormSection title="Test">
        <div>child</div>
      </FormSection>,
    )
    const section = screen.getByTestId("form-section")
    expect(section.className).toContain("border-b")
  })
})

describe("FormPage", () => {
  it("renders title, description, and children", () => {
    render(
      <FormPage title="Settings" description="Manage your stuff">
        <div>page content</div>
      </FormPage>,
    )
    expect(screen.getByText("Settings")).toBeInTheDocument()
    expect(screen.getByText("Manage your stuff")).toBeInTheDocument()
    expect(screen.getByText("page content")).toBeInTheDocument()
  })

  it("renders action slot", () => {
    render(
      <FormPage title="Settings" action={<button>Back</button>}>
        <div>content</div>
      </FormPage>,
    )
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument()
  })
})
