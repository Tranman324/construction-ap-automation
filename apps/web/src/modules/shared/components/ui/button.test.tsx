import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("shared Button press boundary", () => {
  it("marks intentional text actions without changing the accepted transition list", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("data-press", "true");
    expect(button).toHaveClass("transition-[background-color,color,border-color,box-shadow]");
    expect(button).toHaveClass("focus-visible:duration-instant");
  });

  it("keeps structural and opted-out controls stable", () => {
    render(
      <>
        <Button variant="link">Link action</Button>
        <Button variant="ghost">Ghost control</Button>
        <Button size="icon" aria-label="Icon control">X</Button>
        <Button aria-label="Labeled control">X</Button>
        <Button role="radio" aria-checked="false">Radio control</Button>
        <Button role="combobox" aria-expanded="false">Combo control</Button>
        <Button asChild><a href="#target">Anchor</a></Button>
        <Button pressable={false}>Stable action</Button>
        <Button variant="ghost" pressable>Explicit ghost action</Button>
      </>,
    );
    for (const [name, role] of [["Link action", "button"], ["Ghost control", "button"], ["Icon control", "button"], ["Labeled control", "button"], ["Radio control", "radio"], ["Anchor", "link"], ["Stable action", "button"]] as const) {
      expect(screen.getByRole(role, { name })).not.toHaveAttribute("data-press");
    }
    expect(screen.getByText("Combo control")).toHaveAttribute("role", "combobox");
    expect(screen.getByText("Combo control")).not.toHaveAttribute("data-press");
    expect(screen.getByRole("button", { name: "Explicit ghost action" })).toHaveAttribute("data-press", "true");
  });

  it("preserves disabled and ARIA state on a press-eligible action", () => {
    render(<Button disabled aria-expanded="false">Disabled save</Button>);
    const button = screen.getByRole("button", { name: "Disabled save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("data-press", "true");
  });
});
