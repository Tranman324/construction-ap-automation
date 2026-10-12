import { describe, expect, it } from "vitest";

import {
  ADMIN_SECTION_IDS,
  ADMIN_SECTION_OPTIONS,
  DEFAULT_ADMIN_SECTION_ID,
  FUTURE_ADMIN_SECTION_IDS,
  getAdminSectionLabel,
  getAdminSectionQueryValue,
  isAdminSectionId,
  normalizeAdminSection,
} from "@/modules/platform-admin/lib/constants";

describe("platform-admin constants", () => {
  it("defines all current admin section ids", () => {
    expect(ADMIN_SECTION_IDS).toEqual([
      "overview",
      "users",
      "roles",
      "role-perms",
      "overrides",
      "rules",
    ]);
    expect(ADMIN_SECTION_OPTIONS.map((section) => section.id)).toEqual(ADMIN_SECTION_IDS);
  });

  it("keeps future slots out of the v1 routing constants", () => {
    FUTURE_ADMIN_SECTION_IDS.forEach((sectionId) => {
      expect(isAdminSectionId(sectionId)).toBe(false);
    });
  });

  it("normalizes invalid or missing values to overview", () => {
    expect(normalizeAdminSection(undefined)).toBe(DEFAULT_ADMIN_SECTION_ID);
    expect(normalizeAdminSection(null)).toBe(DEFAULT_ADMIN_SECTION_ID);
    expect(normalizeAdminSection("audit-log")).toBe(DEFAULT_ADMIN_SECTION_ID);
    expect(normalizeAdminSection("roles")).toBe("roles");
  });

  it("returns labels and query values for current sections", () => {
    expect(getAdminSectionLabel("role-perms")).toBe("Role Permissions");
    expect(getAdminSectionQueryValue("overrides")).toBe("overrides");
  });
});