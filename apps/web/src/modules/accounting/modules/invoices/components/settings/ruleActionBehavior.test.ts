import { describe, expect, it } from "vitest";

import {
  ACTION_SUBTITLES,
  CLEARABLE_ACTIONS,
  VALUELESS_ACTIONS,
} from "@/modules/accounting/modules/invoices/components/settings/ruleActionBehavior";

describe("ruleActionBehavior", () => {
  it("keeps the valueless and clearable action behavior maps", () => {
    expect(VALUELESS_ACTIONS.has("auto_approve")).toBe(true);
    expect(VALUELESS_ACTIONS.has("set_vendor")).toBe(false);
    expect(CLEARABLE_ACTIONS.has("set_vendor")).toBe(true);
    expect(CLEARABLE_ACTIONS.has("set_classification")).toBe(false);
  });

  it("exposes action subtitles for value-less actions", () => {
    expect(ACTION_SUBTITLES.auto_approve).toBe("Marks invoice as approved automatically");
  });
});
