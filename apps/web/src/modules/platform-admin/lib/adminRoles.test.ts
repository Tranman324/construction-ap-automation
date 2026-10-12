import { describe, expect, it } from "vitest";

import {
  formatAdminRoleLabel,
  formatAdminRoleName,
  normalizeAdminRoleName,
  normalizeAdminRoles,
  normalizeAdminTitleRules,
  normalizeRoleOptionsFromUsers,
} from "@/modules/platform-admin/lib/adminRoles";

describe("adminRoles", () => {
  it("capitalizes the first letter of role names", () => {
    expect(formatAdminRoleName("admin")).toBe("Admin");
    expect(formatAdminRoleName("  leadership  ")).toBe("Leadership");
    expect(normalizeAdminRoleName("project controls")).toBe("Project controls");
  });

  it("normalizes role collections and labels", () => {
    expect(normalizeAdminRoles([{ id: "role-admin", name: "admin" }])[0]?.name).toBe("Admin");
    expect(formatAdminRoleLabel(null)).toBe("Unassigned");
  });

  it("normalizes title rule role names", () => {
    expect(
      normalizeAdminTitleRules([
        {
          id: "rule-1",
          pattern: "Director",
          match_type: "contains",
          role_id: "role-admin",
          priority: 100,
          is_active: true,
          created_at: "2026-05-13T00:00:00.000Z",
          role_name: "admin",
        },
      ])[0]?.role_name,
    ).toBe("Admin");
  });

  it("derives normalized role options from admin users", () => {
    expect(
      normalizeRoleOptionsFromUsers([
        { role: { id: "role-admin", name: "admin", description: null, is_system: true } },
      ])[0]?.name,
    ).toBe("Admin");
  });
});
