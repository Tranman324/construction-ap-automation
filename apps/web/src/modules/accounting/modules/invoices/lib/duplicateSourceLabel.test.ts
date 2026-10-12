import { describe, expect, it } from "vitest";

import {
  duplicateSourceLabel,
  duplicateSourceLabelLower,
} from "@/modules/accounting/modules/invoices/lib/duplicateSourceLabel";

describe("duplicateSourceLabel", () => {
  it.each([
    ["OPEN_ITEMS", "Unpaid (open items)"],
    ["APPROVAL", "Awaiting approval"],
    ["PAYMENT_HIST", "Paid"],
  ])("maps %s to %s", (source, expected) => {
    expect(duplicateSourceLabel(source)).toBe(expected);
  });

  it.each([[null], [undefined], [""], ["SOMETHING_NEW"], ["constructor"], ["open_items"]])(
    "maps %j to Submitted from Toolbox",
    (source) => {
      expect(duplicateSourceLabel(source)).toBe("Submitted from Toolbox");
    },
  );
});

describe("duplicateSourceLabelLower", () => {
  it("lowercases only the first character", () => {
    expect(duplicateSourceLabelLower("OPEN_ITEMS")).toBe("unpaid (open items)");
    expect(duplicateSourceLabelLower("APPROVAL")).toBe("awaiting approval");
    expect(duplicateSourceLabelLower("PAYMENT_HIST")).toBe("paid");
    expect(duplicateSourceLabelLower(null)).toBe("submitted from Toolbox");
    expect(duplicateSourceLabelLower("SOMETHING_NEW")).toBe("submitted from Toolbox");
  });
});
