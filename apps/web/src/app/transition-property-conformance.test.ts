import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = existsSync(resolve(process.cwd(), "src/app/globals.css"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");
const sourceRoot = resolve(webRoot, "src");
const forbiddenUtility = ["transition", "all"].join("-");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("transition property conformance", () => {
  it("keeps the broad transition utility out of web source", () => {
    const matches = sourceFiles(sourceRoot).filter((path) =>
      readFileSync(path, "utf8").includes(forbiddenUtility),
    );

    expect(matches).toEqual([]);
  });

  it("preserves explicit button and tab state properties", () => {
    const button = readFileSync(resolve(sourceRoot, "modules/shared/components/ui/button.tsx"), "utf8");
    const tabs = readFileSync(resolve(sourceRoot, "modules/shared/components/ui/tabs.tsx"), "utf8");
    const stateProperties = "transition-[background-color,color,border-color,box-shadow]";

    expect(button).toContain(stateProperties);
    expect(tabs).toContain(stateProperties);
  });
});
