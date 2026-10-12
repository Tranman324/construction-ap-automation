import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("new duplicate components never key off [data-theme] (CLS-05)", () => {
  it.each([
    "duplicateCardModel.ts",
    "duplicateCardCopy.ts",
    "useDuplicateCardActions.ts",
    "SpectrumConfirmDialog.tsx",
  ])("%s has no data-theme selector or attribute", (file) => {
    expect(readFileSync(join(here, file), "utf8")).not.toMatch(/data-theme|\[data-theme/);
  });

  it("resolve card tokens stay under :root and .dark (checked by the token suite)", () => {
    const css = readFileSync(join(here, "../../../../../../app/globals.css"), "utf8");
    const themed = css.split("\n").filter((line) => /\[data-theme/.test(line));
    expect(themed).toHaveLength(1);
    expect(themed[0]).toContain("html[data-theme-switching] body");
  });
});
