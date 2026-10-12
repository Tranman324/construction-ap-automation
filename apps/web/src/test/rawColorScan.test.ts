import { describe, expect, it } from "vitest";
import { findRawColors } from "./rawColorScan";

describe("findRawColors", () => {
  it("RAW-01 flags palette classes, hex literals and rgb() calls", () => {
    expect(findRawColors('className="text-amber-600"')).toEqual(["amber-600"]);
    expect(findRawColors('"#fff"')).toEqual(["#fff"]);
    expect(findRawColors('"#FFFBEB"')).toEqual(["#FFFBEB"]);
    expect(findRawColors('"rgb(0 0 0)"')).toEqual(["rgb("]);
    expect(findRawColors('"bg-violet-500/10"')).toEqual(["violet-500"]);
  });

  it("RAW-01 passes design tokens, arbitrary sizes and prose", () => {
    expect(findRawColors("text-rc-ink border-rc-line")).toEqual([]);
    expect(findRawColors("bg-[var(--rc-blocking-glyph)]")).toEqual([]);
    expect(findRawColors("size-[13px]")).toEqual([]);
    expect(findRawColors("h-[28px]")).toEqual([]);
    // Known limit: "word #123" is treated as prose, not a color.
    expect(findRawColors("issue #123")).toEqual([]);
  });

  it("flags a hex after punctuation and inside arbitrary values", () => {
    expect(findRawColors("color: #92400E;")).toEqual(["#92400E"]);
    expect(findRawColors("bg-[#fff]")).toEqual(["#fff"]);
  });
});
