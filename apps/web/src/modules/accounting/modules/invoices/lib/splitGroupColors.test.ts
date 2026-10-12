import { describe, expect, it } from "vitest";

import {
  getGroupBorderColor,
  getGroupColor,
  getGroupRingColor,
  getGroupSoftColor,
  getGroupTextColor,
} from "@/modules/accounting/modules/invoices/lib/splitGroupColors";

describe("splitGroupColors", () => {
  it("cycles deterministic group color classes", () => {
    expect(getGroupColor(0)).toBe("bg-blue-500");
    expect(getGroupColor(10)).toBe("bg-blue-500");
    expect(getGroupRingColor(1)).toBe("ring-emerald-500");
    expect(getGroupBorderColor(2)).toBe("border-violet-500");
    expect(getGroupSoftColor(3)).toContain("bg-orange-50");
    expect(getGroupTextColor(4)).toContain("text-pink-700");
  });
});
