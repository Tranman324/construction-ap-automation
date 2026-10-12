import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { describe, expect, it } from "vitest";

const cssPath = resolve(import.meta.dirname, "../../../../app/globals.css");

describe("control motion CSS", () => {
  it("compiles token-based pointer press and origin-aware tooltip states", async () => {
    const source = readFileSync(cssPath, "utf8");
    const output = await postcss([tailwind()]).process(source, { from: cssPath });
    const css = output.css;
    expect(css).toContain('[data-slot="button"][data-press="true"]:active:not(:focus-visible):not(:disabled):not([aria-disabled="true"])');
    expect(css).toContain("scale: var(--press-scale)");
    expect(css).toContain("transition-property: background-color, color, border-color, box-shadow, scale");
    expect(css).toContain("transition-duration: var(--dur-hover), var(--dur-hover), var(--dur-hover), var(--dur-hover), var(--dur-press)");
    expect(css).toContain("transition-duration: var(--dur-instant)");
    expect(css).toContain('[data-slot="tabs-trigger"]:focus-visible');
    expect(css).toContain("transition-property: none");
    expect(css).toContain("transition-property: color, background-color, opacity, border-color");
    expect(css).toContain('.tbx-screen [role="tab"]:focus-visible');
    expect(css).toContain("shared-tip-in var(--dur-tip) var(--ease-out) var(--dur-quick)");
    expect(css).toContain("shared-tip-out var(--dur-exit) var(--ease-out)");
    expect(css).toContain('body[data-tip-open] [data-slot="tooltip-content"][data-tip-warm="true"][data-state="instant-open"]');
    expect(css).toContain("animation-duration: var(--dur-instant)");
    expect(css).toContain("--tip-y: -2px");
    expect(css).toContain("--tip-x: 2px");
    expect(css).toContain("shared-tip-fade-in");
  });
});
