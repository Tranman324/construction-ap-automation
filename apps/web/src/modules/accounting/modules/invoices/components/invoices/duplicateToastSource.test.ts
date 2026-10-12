import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const TOASTER = "@/modules/shared/components/ui/toaster";
const sources = readdirSync(here).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|\.testUtils\.tsx?$/.test(f));

describe("toasts come only from the shared toaster (CLS-04)", () => {
  it("the controller imports toast from the toaster module", () => {
    const text = readFileSync(join(here, "useDuplicateCardActions.ts"), "utf8");
    expect(text).toContain(`import { toast } from "${TOASTER}";`);
  });

  it.each(sources)("%s imports no other toast library or toast path", (file) => {
    const text = readFileSync(join(here, file), "utf8");
    expect(text).not.toMatch(/from\s+"(?:sonner|react-hot-toast)"/);
    for (const [, from] of text.matchAll(/import\s*\{[^}]*\btoast\b[^}]*\}\s*from\s*"([^"]+)"/g)) {
      expect(from).toBe(TOASTER);
    }
  });
});
