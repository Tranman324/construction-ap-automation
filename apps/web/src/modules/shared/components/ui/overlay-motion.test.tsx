import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "./sheet";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";

describe("shared Radix overlay lifecycles", () => {
  it("keeps dialog portal, focus return, and state-bearing scrim", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent>
          <DialogTitle>Motion dialog</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    await user.click(trigger);
    const content = screen.getByRole("dialog", { name: "Motion dialog" });
    expect(content).toHaveAttribute("data-state", "open");
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveAttribute("data-state", "open");
    expect(content).toHaveClass("translate-x-[-50%]", "translate-y-[-50%]");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Motion dialog" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it.each(["right", "left", "top", "bottom"] as const)("keeps %s sheet direction on the real content", async (side) => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Open sheet</SheetTrigger>
        <SheetContent side={side}>
          <SheetTitle>Motion sheet</SheetTitle>
          <SheetDescription>Sheet description</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const trigger = screen.getByRole("button", { name: "Open sheet" });
    await user.click(trigger);
    const content = screen.getByRole("dialog", { name: "Motion sheet" });
    expect(content).toHaveAttribute("data-state", "open");
    expect(content).toHaveAttribute("data-side", side);
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toHaveAttribute("data-state", "open");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Motion sheet" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps popover trigger origin and escape close", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open popover</PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Open popover" });
    await user.click(trigger);
    const content = screen.getByText("Popover body");
    expect(content).toHaveAttribute("data-state", "open");
    expect(content).toHaveClass("origin-(--radix-popover-content-transform-origin)");
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Popover body")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps menu keyboard behavior and trigger origin", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Choice</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);
    const content = screen.getByRole("menu");
    expect(content).toHaveAttribute("data-state", "open");
    expect(content).toHaveClass("origin-(--radix-dropdown-menu-content-transform-origin)");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
