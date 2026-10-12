import { describe, expect, it } from "vitest";

import {
  defaultSplitGroupName,
  normalizeSplitPages,
  orderedSplitPages,
  splitPageRangeLabel,
} from "@/modules/accounting/modules/invoices/lib/splitPageModel";

describe("splitPageModel", () => {
  it("normalizes page ranges and labels", () => {
    expect(orderedSplitPages(3)).toEqual([1, 2, 3]);
    expect(normalizeSplitPages([3, 1, 3, 0, 5], 4)).toEqual([1, 3]);
    expect(defaultSplitGroupName(1)).toBe("Document 2");
    expect(splitPageRangeLabel([4, 2, 3])).toBe("p2-4");
  });
});
