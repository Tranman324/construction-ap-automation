import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { describe, expect, it } from "vitest";
import { resolveCardButtonClass } from "./resolveCardButtonClass";
import { TONES } from "./resolveCardModel";

const cssPath = resolve(import.meta.dirname, "../../../../../../app/globals.css");

/** `hover:bg-x` -> `hover\:bg-x`: the selector form Tailwind emits. */
const selector = (token: string) => `.${token.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`)}`;

describe("resolveCardButtonClass compiled CSS", () => {
  it("BTN-05 emits a selector for the card button utilities (complete literals reach the scanner)", async () => {
    // Test files hold the same literals as expectations; exclude them so only production sources feed the scanner.
    const source = `${readFileSync(cssPath, "utf8")}\n@source not "../**/*.test.{ts,tsx}";\n`;
    const output = await postcss([tailwind()]).process(source, { from: cssPath });
    const required = [
      "h-[28px]", "rounded-[8px]", "text-[12px]", "bg-rc-blocking-solid", "text-rc-blocking-solid-fg",
      "hover:bg-rc-blocking-solid-hover", "dark:hover:bg-rc-tint-strong", "border-rc-icon",
    ];
    for (const token of required) expect(output.css, token).toContain(selector(token));
    const used = new Set<string>();
    for (const tone of TONES) {
      for (const emphasis of ["primary", "secondary"] as const) {
        for (const armed of [false, true]) resolveCardButtonClass(tone, emphasis, armed).split(" ").forEach((t) => used.add(t));
      }
    }
    const missing = [...used].filter((token) => !output.css.includes(selector(token)));
    expect(missing).toEqual([]);
  }, 60_000);
});
