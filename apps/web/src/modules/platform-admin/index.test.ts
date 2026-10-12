import { describe, expect, it } from "vitest";

import {
  ADMIN_SECTION_IDS,
  HIGH_RISK_KEYS,
  normalizeAdminSection,
} from "@/modules/platform-admin";

describe("platform-admin barrel", () => {
  it("re-exports the module foundations", () => {
    expect(ADMIN_SECTION_IDS).toContain("overview");
    expect(HIGH_RISK_KEYS.has("platform.admin")).toBe(true);
    expect(normalizeAdminSection("invalid")).toBe("overview");
  });
});