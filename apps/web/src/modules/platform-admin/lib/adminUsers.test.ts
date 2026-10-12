import { describe, expect, it } from "vitest";

import { formatAdminLastLogin, getAdminUserAvatarUrl, normalizeAdminUsers } from "@/modules/platform-admin/lib/adminUsers";
import type { AdminUser } from "@/modules/platform-admin/types/admin";

const user: AdminUser = {
  id: "user-1",
  azure_id: "azure-user-1",
  email: "  User.One@northwindcg.example  ",
  name: "  User One  ",
  role_id: "role-user",
  is_active: true,
  job_title: "  Project Manager  ",
  phone: "  (678) 555-0000  ",
  avatar_url: null,
  role_version: 1,
  last_login_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: null,
  role: { id: "role-user", name: "User", description: null, is_system: false },
};

describe("adminUsers avatar helpers", () => {
  it("prefers explicit avatar URLs and normalizes backend proxy paths", () => {
    expect(getAdminUserAvatarUrl({ ...user, avatar_url: "/api/users/azure-user-1/photo" })).toBe(
      "/api/backend/users/azure-user-1/photo?size=648x648",
    );
    expect(getAdminUserAvatarUrl({ ...user, avatar_url: "/api/backend/users/azure-user-1/photo" })).toBe(
      "/api/backend/users/azure-user-1/photo?size=648x648",
    );
  });

  it("derives an Azure photo proxy URL when avatar_url is empty", () => {
    expect(getAdminUserAvatarUrl(user)).toBe("/api/backend/users/azure-user-1/photo?size=648x648");
  });
});

describe("normalizeAdminUsers", () => {
  it("normalizes avatar, role name, and profile fields in one pass", () => {
    const [result] = normalizeAdminUsers([user]);

    expect(result?.avatar_url).toBe("/api/backend/users/azure-user-1/photo?size=648x648");
    expect(result?.name).toBe("User One");
    expect(result?.email).toBe("user.one@northwindcg.example");
    expect(result?.job_title).toBe("Project Manager");
    expect(result?.phone).toBe("(678) 555-0000");
  });

  it("normalizes embedded role names", () => {
    const [result] = normalizeAdminUsers([
      { ...user, role: { id: "role-admin", name: "admin", description: null, is_system: true } },
    ]);

    expect(result?.role?.name).toBe("Admin");
  });

  it("converts whitespace-only job_title and phone to null", () => {
    const [result] = normalizeAdminUsers([{ ...user, job_title: "   ", phone: "" }]);

    expect(result?.job_title).toBeNull();
    expect(result?.phone).toBeNull();
  });
});

describe("formatAdminLastLogin", () => {
  it("delegates to platform formatter", () => {
    expect(formatAdminLastLogin(null)).toBe("Never");
    expect(formatAdminLastLogin("2026-05-01T14:30:00.000Z")).toBe("May 1, 2026");
    expect(formatAdminLastLogin("invalid")).toBe("Unknown");
  });
});
