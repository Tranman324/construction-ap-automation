import { describe, expect, it } from "vitest";

import {
  ADMIN_SECTION_IDS,
  ADMIN_SECTION_OPTIONS,
  ADMIN_SECTION_QUERY_PARAM,
  DEFAULT_ADMIN_SECTION_ID,
  FUTURE_ADMIN_SECTION_IDS,
  getAdminSectionLabel,
  getAdminSectionQueryValue,
  isAdminSectionId,
  normalizeAdminSection,
} from "@/modules/shared/lib/adminNavigation";

describe("admin navigation contract", () => {
  it("preserves admin section URL values and normalization", () => {
    expect(ADMIN_SECTION_QUERY_PARAM).toBe("section");
    expect(ADMIN_SECTION_IDS).toEqual(["overview", "users", "roles", "role-perms", "overrides", "rules"]);
    expect(ADMIN_SECTION_OPTIONS.map((section) => section.id)).toEqual(ADMIN_SECTION_IDS);
    expect(normalizeAdminSection("roles")).toBe("roles");
    expect(normalizeAdminSection("audit-log")).toBe(DEFAULT_ADMIN_SECTION_ID);
  });

  it("keeps future sections outside the current route contract", () => {
    FUTURE_ADMIN_SECTION_IDS.forEach((sectionId) => {
      expect(isAdminSectionId(sectionId)).toBe(false);
    });
    expect(getAdminSectionLabel("role-perms")).toBe("Role Permissions");
    expect(getAdminSectionQueryValue("overrides")).toBe("overrides");
  });
});
