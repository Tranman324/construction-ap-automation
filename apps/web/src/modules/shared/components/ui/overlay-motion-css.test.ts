import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "../../../../../");
const cssPath = resolve(webRoot, "src/app/globals.css");

describe("shared lifecycle CSS", () => {
  it("compiles state-bound motion with shared durations and curves", async () => {
    const source = readFileSync(cssPath, "utf8");
    const result = await postcss([tailwind()]).process(source, { from: cssPath });
    const rules = new Map<string, string>();
    postcss.parse(result.css).walkRules((rule) => {
      rules.set(rule.selector, rule.toString());
    });

    expect(rules.get('[data-slot="dialog-content"][data-state="open"]')).toContain("shared-dialog-in var(--dur-modal) var(--ease-out)");
    expect(rules.get('[data-slot="dialog-content"][data-state="closed"]')).toContain("shared-dialog-out var(--dur-exit) var(--ease-out)");
    expect(rules.get('[data-slot="sheet-content"][data-state="open"]')).toContain("shared-sheet-in var(--dur-drawer) var(--ease-drawer)");
    expect(rules.get('[data-slot="sheet-content"][data-state="closed"]')).toContain("shared-sheet-out var(--dur-exit) var(--ease-drawer)");
    expect(rules.get('[data-slot="sheet-content"][data-side="left"]')).toContain("--sheet-x: -100%");
    expect(rules.get('[data-slot="sheet-content"][data-side="bottom"]')).toContain("--sheet-y: 100%");
    expect(rules.get('html[data-theme-switching] body')).toContain("background-color var(--dur-modal) var(--ease-out)");
    expect(result.css).toContain("shared-menu-in var(--dur-pop) var(--ease-out)");
    expect(result.css).toContain("shared-menu-out var(--dur-exit) var(--ease-out)");
    expect(result.css).toContain(".bg-scrim-ink");
    expect(result.css).toContain(".backdrop-scrim-blur");
    expect(result.css).toContain("--menu-y: -2px");
    expect(result.css).toContain("shared-fade-in");
    expect(result.css).toContain("prefers-reduced-motion: reduce");
    const reduced = postcss.parse(result.css).nodes
      .filter((node) => node.type === "atrule" && node.name === "media" && node.params.includes("prefers-reduced-motion: reduce"))
      .map((node) => node.toString()).join("\n");
    expect(reduced).toContain("animation-name: shared-fade-in");
    expect(reduced).toContain("animation-name: shared-fade-out");
    expect(reduced).toContain("transition: opacity var(--dur-hover) var(--ease-out) !important");
  });

  it("uses Sonner mount/removal attributes without taking over swipe or stack motion", () => {
    const source = readFileSync(cssPath, "utf8");
    expect(source).toContain('[data-mounted="true"]');
    expect(source).toContain('[data-removed="true"][data-swipe-out="false"]');
    expect(source).toContain('[data-swiping="false"][data-swipe-out="false"]');
    expect(source).toContain("max-height: 0;");
    expect(source).toContain("transition-duration: var(--dur-exit);");
    expect(source).toContain("--y: translateY(12px);");
    expect(source).toContain("scale: 0.98;");
  });
});
