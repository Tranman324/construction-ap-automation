import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

describe("shared Tabs structural controls", () => {
  it.each([
    { orientation: "horizontal", variant: "default", key: "{ArrowRight}" },
    { orientation: "vertical", variant: "line", key: "{ArrowDown}" },
  ] as const)("keeps $orientation $variant tabs stable through keyboard selection", async ({ orientation, variant, key }) => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="first" orientation={orientation}>
        <TabsList variant={variant}>
          <TabsTrigger value="first">First</TabsTrigger>
          <TabsTrigger value="second">Second</TabsTrigger>
        </TabsList>
        <TabsContent value="first">First panel</TabsContent>
        <TabsContent value="second">Second panel</TabsContent>
      </Tabs>,
    );
    const first = screen.getByRole("tab", { name: "First" });
    const second = screen.getByRole("tab", { name: "Second" });
    expect(first).toHaveAttribute("data-state", "active");
    expect(first).toHaveClass("focus-visible:duration-instant");
    expect(first.className).not.toMatch(/(?:active|hover):(scale|translate)/);
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-orientation", orientation);
    await user.click(first);
    await user.keyboard(key);
    expect(second).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Second panel")).toBeVisible();
  });
});
