import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SpectrumConfirmDialog source", () => {
  it("uses no hex, palette color or console in the source (DLG-07)", () => {
    const file = "SpectrumConfirmDialog.tsx";
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(text).not.toMatch(/\b(?:text|bg|border|ring)-(?:amber|violet|red|green|blue|slate|gray|zinc|neutral|stone|orange|yellow|emerald|rose|sky|indigo|purple|pink|teal|cyan|lime|fuchsia)-\d/);
    expect(text).not.toMatch(/console\./);
    expect(text.split("\n").length).toBeLessThanOrEqual(200);
  });
});
