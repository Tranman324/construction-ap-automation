import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { describe, expect, it } from "vitest";

const webRoot = existsSync(resolve(process.cwd(), "src/app/globals.css"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");
const cssPath = resolve(webRoot, "src/app/globals.css");
const docsPath = resolve(webRoot, "docs/design-system/motion.md");
const sidebarCssPath = resolve(webRoot, "src/modules/shared/components/layout/SidebarRailPanel.module.css");

const css = readFileSync(cssPath, "utf8");
const sidebarCss = readFileSync(sidebarCssPath, "utf8");
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

const canonicalTokens = {
  "--ease-out": "cubic-bezier(0.23, 1, 0.32, 1)",
  "--ease-in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
  "--ease-drawer": "cubic-bezier(0.32, 0.72, 0, 1)",
  "--ease-press": "cubic-bezier(0.2, 0, 0, 1)",
  "--ease-sidebar": "cubic-bezier(0.16, 1, 0.3, 1)",
  "--dur-instant": "0ms",
  "--dur-hover": "120ms",
  "--dur-press": "150ms",
  "--dur-tip": "150ms",
  "--dur-pop": "200ms",
  "--dur-modal": "240ms",
  "--dur-drawer": "300ms",
  "--dur-exit": "140ms",
  "--dur-stagger": "50ms",
  "--dur-quick": "100ms",
  "--dur-reveal": "180ms",
  "--dur-notice": "220ms",
  "--dur-scrim": "260ms",
  "--dur-sheet": "280ms",
  "--dur-progress": "320ms",
  "--dur-spin": "0.7s",
  "--scrim-ink": "rgba(15, 23, 42, 0.44)",
  "--scrim-blur": "6px",
  "--press-scale": "0.96",
} as const;

describe("shared motion tokens", () => {
  it("defines every canonical and supplemental value exactly once in :root", () => {
    for (const [name, value] of Object.entries(canonicalTokens)) {
      expect(rootBlock).toContain(`${name}: ${value};`);
      expect(css.split(`${name}: ${value};`).length - 1).toBe(1);
    }
    expect(darkBlock).toContain("--scrim-ink: rgba(2, 6, 18, 0.58);");
  });

  it("documents the platform rules and stays concise", () => {
    const reference = readFileSync(docsPath, "utf8");
    expect(reference.split("\n").length).toBeLessThan(200);
    for (const rule of [
      "Raw timing",
      "bare `ease`, `ease-in`",
      "`transition: all`",
      "Exits are shorter",
      "trigger-aware",
      "Hover movement",
      "Focus rings are instant",
      "Do not animate row or list entrances",
      "remove movement and scale",
      "opacity and color feedback",
    ]) {
      expect(reference).toContain(rule);
    }
  });

  it("keeps the sidebar width transition on its named curve token", () => {
    expect(sidebarCss).toContain("transition: width 240ms var(--ease-sidebar);");
  });

  it("resolves named motion utilities through the real Tailwind CSS plugin", async () => {
    const utilities = [
      "ease-out-strong",
      "ease-in-out-smooth",
      "ease-drawer",
      "ease-press",
      "duration-instant",
      "duration-hover",
      "duration-press",
      "duration-tip",
      "duration-pop",
      "duration-modal",
      "duration-drawer",
      "duration-exit",
      "duration-stagger",
      "duration-quick",
      "duration-reveal",
      "duration-notice",
      "duration-scrim",
      "duration-sheet",
      "duration-progress",
      "duration-spin",
      "bg-scrim-ink",
      "backdrop-scrim-blur",
      "scale-press",
    ];
    const output = await postcss([tailwind()]).process(
      `${css}\n@source inline("${utilities.join(" ")}");`,
      { from: cssPath },
    );

    const generatedRules = new Map<string, string>();
    postcss.parse(output.css).walkRules((rule) => {
      for (const utility of utilities) {
        if (rule.selector === `.${utility}`) generatedRules.set(utility, rule.toString());
      }
    });

    for (const [utility, token] of [
      ["ease-out-strong", "--ease-out"],
      ["ease-in-out-smooth", "--ease-in-out"],
      ["ease-drawer", "--ease-drawer"],
      ["ease-press", "--ease-press"],
    ]) {
      expect(generatedRules.get(utility)).toContain(`transition-timing-function: var(${token})`);
    }
    for (const token of Object.keys(canonicalTokens).filter((name) => name.startsWith("--dur-"))) {
      const utility = `duration-${token.slice("--dur-".length)}`;
      const property = utility === "duration-spin" ? "animation-duration" : "transition-duration";
      expect(generatedRules.get(utility)).toContain(`${property}: var(${token})`);
    }
    expect(generatedRules.get("bg-scrim-ink")).toContain("background-color: var(--scrim-ink)");
    expect(generatedRules.get("backdrop-scrim-blur")).toContain("backdrop-filter: blur(var(--scrim-blur))");
    expect(generatedRules.get("scale-press")).toContain("scale: var(--press-scale)");
  });
});
