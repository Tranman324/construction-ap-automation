import { describe, expect, it } from "vitest";

import { getActiveSplitDocTypeOptions } from "@/modules/accounting/modules/invoices/lib/splitLayout";
import type { ClassificationInfo } from "@/modules/accounting/modules/invoices/types/api";

describe("splitLayout", () => {
  it("derives split doc-type options from active classification records", () => {
    const classifications: ClassificationInfo[] = [
      { name: "building-permit", label: "Building Permit", opensAs: "other", action: "view-only", builtIn: false, status: "active" },
      { name: "warranty", label: "Warranty", opensAs: "warranty", action: "view-only", builtIn: false, status: "active" },
      { name: "disabled-type", label: "Disabled Type", opensAs: "other", action: "view-only", builtIn: false, status: "disabled" },
    ];

    expect(getActiveSplitDocTypeOptions(classifications)).toEqual([
      { value: "building-permit", label: "Building Permit" },
      { value: "warranty", label: "Warranty" },
    ]);
  });
});
