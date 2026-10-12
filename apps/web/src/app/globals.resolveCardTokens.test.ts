import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { describe, expect, it } from "vitest";

const webRoot = existsSync(resolve(process.cwd(), "src/app/globals.css"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");
const cssPath = resolve(webRoot, "src/app/globals.css");
const CSS = readFileSync(cssPath, "utf8");

interface Rule {
  selector: string;
  body: string;
}

/** Top-level rules by brace depth. Comments are blanked first so braces inside them do not count. */
function topLevelRules(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  const rules: Rule[] = [];
  let depth = 0;
  let selectorStart = 0;
  let bodyStart = 0;
  let selector = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) {
        selector = text.slice(selectorStart, i).trim();
        bodyStart = i + 1;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        rules.push({ selector, body: text.slice(bodyStart, i) });
        selectorStart = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      selectorStart = i + 1;
    }
  }
  return rules;
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of body.split(";")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (name.startsWith("--")) out.set(name, part.slice(idx + 1).trim());
  }
  return out;
}

/** Whitespace removed and hex digits upper-cased, so the literals below read like the spec. */
function norm(value: string | undefined): string {
  return (value ?? "<missing>").replace(/\s+/g, "").replace(/#[0-9a-fA-F]+/g, (h) => h.toUpperCase());
}

const rules = topLevelRules(CSS);
const rcRoles = ["ink", "icon", "line", "line-strong", "wash", "tint", "tint-strong"] as const;
const rcTones = ["blocking", "failed", "waiting", "info"] as const;
const rcNameRe = /^--rc-(blocking|failed|waiting|info)-/;
const isGlyph = (name: string) => name.startsWith("--rc-blocking-glyph");

/** The `:root`/`.dark` rule that holds the tone-role tokens (not the glyph rule). */
function toneBlock(selector: ":root" | ".dark"): Map<string, string> {
  const hit = rules.filter((r) => r.selector === selector && r.body.includes("--rc-blocking-ink:"));
  expect(hit, `${selector} rule holding --rc-blocking-ink`).toHaveLength(1);
  return declarations(hit[0].body);
}
const light = toneBlock(":root");
const dark = toneBlock(".dark");

function expectTokens(tone: string, block: Map<string, string>, table: Record<string, string>): void {
  for (const [role, expected] of Object.entries(table)) {
    expect(norm(block.get(`--rc-${tone}-${role}`)), `--rc-${tone}-${role}`).toBe(norm(expected));
  }
}

describe("resolve-card tone tokens", () => {
  it("TK-01 blocking tokens in :root and .dark", () => {
    expectTokens("blocking", light, {
      ink: "#92400E", icon: "#B45309", solid: "var(--tone-amber)", "solid-fg": "#FFFFFF", "solid-hover": "#B45309",
      line: "#FDE68A", "line-strong": "#FCD34D", wash: "#FFFBEB", tint: "#FEF3C7", "tint-strong": "#FDE68A",
    });
    expectTokens("blocking", dark, {
      ink: "#FCD34D", icon: "var(--tone-amber)", solid: "var(--tone-amber)", "solid-fg": "#1F1300", "solid-hover": "#F59E0B",
      line: "rgba(245,158,11,.30)", "line-strong": "rgba(245,158,11,.45)", wash: "rgba(245,158,11,.10)",
      tint: "rgba(245,158,11,.16)", "tint-strong": "rgba(245,158,11,.24)",
    });
  });

  it("TK-02 failed tokens in :root and .dark", () => {
    expectTokens("failed", light, {
      ink: "#991B1B", icon: "#DC2626", line: "#FECACA", "line-strong": "#FCA5A5", wash: "#FEF2F2", tint: "#FEE2E2", "tint-strong": "#FECACA",
    });
    expectTokens("failed", dark, {
      ink: "#FCA5A5", icon: "#F87171", line: "rgba(239,68,68,.30)", "line-strong": "rgba(239,68,68,.45)",
      wash: "rgba(239,68,68,.10)", tint: "rgba(239,68,68,.16)", "tint-strong": "rgba(239,68,68,.24)",
    });
  });

  it("TK-03 waiting tokens in :root and .dark", () => {
    expectTokens("waiting", light, {
      ink: "#1E40AF", icon: "#1D4ED8", line: "#BFDBFE", "line-strong": "#93C5FD", wash: "#EFF6FF", tint: "#DBEAFE", "tint-strong": "#BFDBFE",
    });
    expectTokens("waiting", dark, {
      ink: "#93C5FD", icon: "#60A5FA", line: "rgba(59,130,246,.30)", "line-strong": "rgba(59,130,246,.45)",
      wash: "rgba(59,130,246,.10)", tint: "rgba(59,130,246,.16)", "tint-strong": "rgba(59,130,246,.24)",
    });
  });

  it("TK-04 info tokens are var() references declared identically in both blocks", () => {
    const info = {
      ink: "var(--foreground)", icon: "var(--muted-foreground)", line: "var(--border)", "line-strong": "var(--border)",
      wash: "color-mix(in srgb, var(--muted) 50%, var(--card))", tint: "var(--muted)", "tint-strong": "var(--accent)",
    };
    expectTokens("info", light, info);
    expectTokens("info", dark, info);
  });

  it("TK-05 each block holds exactly 31 tone-role names, the sets match, var() tokens are in both, no [data-theme]", () => {
    const names = (block: Map<string, string>) => [...block.keys()].filter((n) => rcNameRe.test(n) && !isGlyph(n));
    const lightNames = names(light);
    const darkNames = names(dark);
    expect(lightNames).toHaveLength(31);
    expect(darkNames).toHaveLength(31);
    for (const [tone, count] of [["blocking", 10], ["failed", 7], ["waiting", 7], ["info", 7]] as const) {
      expect(lightNames.filter((n) => n.startsWith(`--rc-${tone}-`))).toHaveLength(count);
    }
    expect([...lightNames].sort()).toEqual([...darkNames].sort());
    for (const name of lightNames) {
      const inLight = light.get(name) ?? "";
      const inDark = dark.get(name) ?? "";
      if (inLight.includes("var(") || inDark.includes("var(")) {
        expect(light.has(name) && dark.has(name), `${name} must be declared in both blocks`).toBe(true);
      }
    }
    const underDataTheme = rules.filter((r) => r.selector.includes("[data-theme") && r.body.includes("--rc-"));
    expect(underDataTheme).toHaveLength(0);
  });

  it("TK-06 glyph tokens live in one commented block, apart from the tone-role tokens", () => {
    const glyphRules = rules.filter((r) => r.body.includes("--rc-blocking-glyph"));
    expect(glyphRules.map((r) => r.selector).sort()).toEqual([".dark", ":root"]);
    const byName = (sel: string) => declarations(glyphRules.find((r) => r.selector === sel)?.body ?? "");
    expect(norm(byName(":root").get("--rc-blocking-glyph"))).toBe("#D97706");
    expect(norm(byName(".dark").get("--rc-blocking-glyph"))).toBe("#FCD34D");
    expect(norm(byName(":root").get("--rc-blocking-glyph-hover"))).toBe("#B45309");
    expect(norm(byName(".dark").get("--rc-blocking-glyph-hover"))).toBe("var(--tone-amber)");
    for (const r of glyphRules) expect([...declarations(r.body).keys()].filter((n) => !isGlyph(n))).toEqual([]);
    expect(CSS).toMatch(/\/\*[^*]*glyph[^*]*\*\/\s*:root\s*\{[^}]*--rc-blocking-glyph:[^}]*\}\s*\.dark\s*\{[^}]*--rc-blocking-glyph:/);
    expect(light.has("--rc-blocking-glyph")).toBe(false);
    expect(dark.has("--rc-blocking-glyph")).toBe(false);
  });

  it("TK-07 four data-tone rules bind the seven roles to the matching tone tokens", () => {
    const toneRules = rules.filter((r) => r.selector.startsWith("[data-tone="));
    expect(toneRules.map((r) => r.selector)).toEqual(rcTones.map((t) => `[data-tone="${t}"]`));
    for (const tone of rcTones) {
      const rule = toneRules.find((r) => r.selector === `[data-tone="${tone}"]`);
      const decl = declarations(rule?.body ?? "");
      expect(decl.size).toBe(7);
      for (const role of rcRoles) expect(decl.get(`--rc-${role}`), `${tone} ${role}`).toBe(`var(--rc-${tone}-${role})`);
    }
  });

  it("TK-08 @theme inline maps the twelve rc names", () => {
    const themeRules = rules.filter((r) => r.selector === "@theme inline");
    expect(themeRules.length).toBeGreaterThan(0);
    const theme = declarations(themeRules[0].body);
    const suffixes = [
      "ink", "icon", "line", "line-strong", "wash", "tint", "tint-strong",
      "blocking-solid", "blocking-solid-fg", "blocking-solid-hover", "waiting-ink", "waiting-tint",
    ];
    for (const s of suffixes) expect(theme.get(`--color-rc-${s}`), `--color-rc-${s}`).toBe(`var(--rc-${s})`);
    expect([...theme.keys()].filter((n) => n.startsWith("--color-rc-"))).toHaveLength(12);
    expect(rules.some((r) => r.selector === "@theme" && r.body.includes("--color-rc-"))).toBe(false);
    expect([...theme.keys()].some((n) => n.includes("glyph"))).toBe(false);
  });

  it("TK-09 no --dup- tokens and a single [data-theme occurrence", () => {
    expect(CSS.match(/--dup-/g)).toBeNull();
    expect(CSS.match(/\[data-theme/g)).toHaveLength(1);
    expect(CSS).toContain("html[data-theme-switching] body");
  });

  it("TK-10 violet tone tokens and the violet status pill survive", () => {
    const rootAll = declarations(rules.filter((r) => r.selector === ":root").map((r) => r.body).join(";"));
    const darkAll = declarations(rules.filter((r) => r.selector === ".dark").map((r) => r.body).join(";"));
    expect(norm(rootAll.get("--tone-violet"))).toBe("#7C3AED");
    expect(norm(darkAll.get("--tone-violet"))).toBe("#A78BFA");
    const theme = declarations(rules.find((r) => r.selector === "@theme inline")?.body ?? "");
    expect(theme.get("--color-tone-violet")).toBe("var(--tone-violet)");
    const pill = rules.find((r) => r.selector === ".tbx-status-pill--violet");
    expect(pill, ".tbx-status-pill--violet rule").toBeDefined();
    expect(declarations(pill?.body ?? "").get("--tbx-pill-color")).toBe("var(--tone-violet)");
  });
});

describe("resolve-card Tailwind theme mapping (TK-12)", () => {
  it("emits utilities that resolve against the nearest data-tone", async () => {
    const utilities = "bg-rc-wash border-rc-line text-rc-ink border-rc-line-strong bg-rc-blocking-solid text-rc-icon hover:bg-rc-blocking-solid-hover dark:hover:bg-rc-tint";
    const source = `${CSS}\n@source inline("${utilities}");\n`;
    const output = await postcss([tailwind()]).process(source, { from: cssPath });
    const css = output.css;
    expect(css).toContain("background-color: var(--rc-wash)");
    expect(css).toContain("border-color: var(--rc-line)");
    expect(css).toContain("color: var(--rc-ink)");
    expect(css).toContain("border-color: var(--rc-line-strong)");
    expect(css).toContain("background-color: var(--rc-blocking-solid)");
    expect(css).toContain("color: var(--rc-icon)");
    expect(css).toMatch(
      /\.hover\\:bg-rc-blocking-solid-hover\s*\{\s*&:hover\s*\{\s*@media \(hover: hover\)\s*\{\s*background-color: var\(--rc-blocking-solid-hover\)/,
    );
    expect(css).toMatch(
      /\.dark\\:hover\\:bg-rc-tint\s*\{\s*&:is\(\.dark \*\)\s*\{\s*&:hover\s*\{\s*@media \(hover: hover\)\s*\{\s*background-color: var\(--rc-tint\)/,
    );
    expect(css).not.toContain("var(--color-rc-");
  }, 60_000);
});
