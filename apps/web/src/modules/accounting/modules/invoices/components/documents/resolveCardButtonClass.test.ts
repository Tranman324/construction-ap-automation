import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";
import { resolveCardButtonClass } from "./resolveCardButtonClass";
import type { Tone } from "./resolveCardModel";

/** Class tokens of the real shared Button after cva + twMerge, as the card passes them. */
function merged(tone: Tone, emphasis: "primary" | "secondary", armed = false): string[] {
  return cn(buttonVariants({ variant: "ghost", size: "sm", className: resolveCardButtonClass(tone, emphasis, armed) })).split(" ");
}

const SIZE = "h-[28px] gap-[5px] rounded-[8px] px-[11px] py-0 text-[12px] font-semibold has-[>svg]:px-[11px] [&_svg:not([class*='size-'])]:size-[13px] border border-transparent".split(" ");
const DROPPED = ["gap-2", "text-sm", "rounded-md", "h-8", "px-3", "has-[>svg]:px-2.5", "hover:bg-accent", "hover:text-accent-foreground", "dark:hover:bg-accent/50"];

describe("resolveCardButtonClass", () => {
  it("BTN-01 blocking primary is the amber solid with the ghost and sm classes dropped", () => {
    const tokens = merged("blocking", "primary");
    expect(tokens).toEqual(expect.arrayContaining([
      ...SIZE,
      ..."bg-rc-blocking-solid text-rc-blocking-solid-fg hover:bg-rc-blocking-solid-hover hover:text-rc-blocking-solid-fg dark:hover:bg-rc-blocking-solid-hover".split(" "),
    ]));
    for (const dropped of DROPPED) expect(tokens, dropped).not.toContain(dropped);
  });

  it("BTN-02 blocking secondary is the transparent outline on the line-strong role", () => {
    const tokens = merged("blocking", "secondary");
    expect(tokens).toEqual(expect.arrayContaining([
      ...SIZE.filter((t) => t !== "border-transparent"),
      ..."bg-transparent border-rc-line-strong text-rc-ink hover:bg-rc-tint hover:text-rc-ink dark:hover:bg-rc-tint".split(" "),
    ]));
    expect(tokens).not.toContain("hover:bg-accent");
    expect(tokens).not.toContain("dark:hover:bg-accent/50");
  });

  it.each(["blocking", "failed", "waiting", "info"] as const)("BTN-03 armed (%s) uses the icon border and tint", (tone) => {
    for (const emphasis of ["primary", "secondary"] as const) {
      expect(merged(tone, emphasis, true)).toEqual(expect.arrayContaining(
        "border-rc-icon bg-rc-tint text-rc-ink hover:bg-rc-tint-strong hover:text-rc-ink dark:hover:bg-rc-tint-strong".split(" "),
      ));
    }
  });

  it("BTN-04 failed primary is the app primary; failed secondary follows the tone roles", () => {
    expect(merged("failed", "primary")).toEqual(expect.arrayContaining(["bg-primary", "text-primary-foreground", "hover:bg-primary-hover"]));
    expect(merged("failed", "primary")).not.toContain("bg-rc-blocking-solid");
    expect(merged("failed", "secondary")).toEqual(expect.arrayContaining(["border-rc-line-strong", "text-rc-ink", "hover:bg-rc-tint"]));
  });

  it.each([["waiting", "primary"], ["waiting", "secondary"], ["info", "primary"], ["info", "secondary"]] as const)(
    "BTN-04 %s %s is the neutral outline",
    (tone, emphasis) => {
      const tokens = merged(tone, emphasis);
      expect(tokens).toEqual(expect.arrayContaining(["border-border", "bg-background", "text-foreground", "hover:bg-accent"]));
      expect(tokens).not.toContain("hover:text-accent-foreground");
      expect(tokens).not.toContain("dark:hover:bg-accent/50");
    },
  );
});
