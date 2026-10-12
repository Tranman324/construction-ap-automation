import { describe, expect, it } from "vitest";

import {
  formatPlatformJobTitle,
  formatPlatformLastLogin,
  formatPlatformPhone,
  normalizePlatformUser,
  normalizeProfileEmail,
  normalizeProfileString,
  PLATFORM_PROFILE_FALLBACKS,
  PLATFORM_PROFILE_PHOTO_SIZE,
  resolvePlatformUserPhotoUrl,
  resolvePlatformUserProfile,
} from "@/modules/shared/lib/userProfile";

const user = {
  id: "user-1",
  azure_id: "azure-user-1",
  avatar_url: null,
  name: "Dana Whitfield",
  email: "Dana.whitfield@northwindcg.example",
  job_title: "  Project Manager  ",
  phone: "  (678) 555-1234  ",
  last_login_at: "2026-05-01T14:30:00.000Z",
};

describe("userProfile — photo resolution", () => {
  it("resolves platform photo URLs from Azure IDs", () => {
    expect(resolvePlatformUserPhotoUrl(user, { preferredSize: PLATFORM_PROFILE_PHOTO_SIZE })).toBe(
      "/api/backend/users/azure-user-1/photo?size=648x648",
    );
  });

  it("normalizes API photo URLs without double-prefixing backend paths", () => {
    expect(resolvePlatformUserPhotoUrl({ ...user, avatar_url: "/api/users/azure-user-1/photo" })).toBe(
      "/api/backend/users/azure-user-1/photo",
    );
    expect(resolvePlatformUserPhotoUrl({ ...user, avatar_url: "/api/backend/users/azure-user-1/photo" })).toBe(
      "/api/backend/users/azure-user-1/photo",
    );
  });

  it("adds the preferred Graph photo size to backend photo proxy URLs", () => {
    expect(
      resolvePlatformUserPhotoUrl(
        { ...user, avatar_url: "/api/backend/users/azure-user-1/photo?cache=warm" },
        { preferredSize: "648x648" },
      ),
    ).toBe("/api/backend/users/azure-user-1/photo?cache=warm&size=648x648");
  });

  it("can return generated fallbacks when no identity is available", () => {
    const resolved = resolvePlatformUserProfile(
      { id: "", azure_id: null, avatar_url: null, name: "Dana Whitfield" },
      { fallbackToGeneratedAvatar: true },
    );

    expect(resolved.avatar_url).toContain("https://ui-avatars.com/api/");
  });
});

describe("userProfile — string normalization", () => {
  it("trims strings and converts empty/whitespace to null", () => {
    expect(normalizeProfileString("  hello  ")).toBe("hello");
    expect(normalizeProfileString("")).toBeNull();
    expect(normalizeProfileString("   ")).toBeNull();
    expect(normalizeProfileString(null)).toBeNull();
    expect(normalizeProfileString(undefined)).toBeNull();
  });

  it("normalizes emails to lowercase and trims", () => {
    expect(normalizeProfileEmail("  Dana.w@NORTHWINDCG.EXAMPLE  ")).toBe("dana.w@northwindcg.example");
    expect(normalizeProfileEmail("")).toBeNull();
    expect(normalizeProfileEmail(null)).toBeNull();
  });
});

describe("userProfile — display formatters", () => {
  it("formats last login timestamps or returns fallbacks", () => {
    expect(formatPlatformLastLogin("2026-05-01T14:30:00.000Z")).toBe("May 1, 2026");
    expect(formatPlatformLastLogin(null)).toBe(PLATFORM_PROFILE_FALLBACKS.lastLogin);
    expect(formatPlatformLastLogin("not-a-date")).toBe(PLATFORM_PROFILE_FALLBACKS.lastLoginInvalid);
  });

  it("formats job titles with configurable fallbacks", () => {
    expect(formatPlatformJobTitle("  Project Manager  ")).toBe("Project Manager");
    expect(formatPlatformJobTitle(null)).toBe(PLATFORM_PROFILE_FALLBACKS.jobTitle);
    expect(formatPlatformJobTitle("")).toBe(PLATFORM_PROFILE_FALLBACKS.jobTitle);
    expect(formatPlatformJobTitle(null, "N/A")).toBe("N/A");
  });

  it("formats phone numbers with configurable fallbacks", () => {
    expect(formatPlatformPhone("  (678) 555-1234  ")).toBe("(678) 555-1234");
    expect(formatPlatformPhone(null)).toBe(PLATFORM_PROFILE_FALLBACKS.phone);
    expect(formatPlatformPhone("", "None")).toBe("None");
  });
});

describe("userProfile — full normalization", () => {
  it("normalizes all profile fields in one pass", () => {
    const result = normalizePlatformUser(user, { preferredSize: PLATFORM_PROFILE_PHOTO_SIZE });

    expect(result.name).toBe("Dana Whitfield");
    expect(result.email).toBe("dana.whitfield@northwindcg.example");
    expect(result.job_title).toBe("Project Manager");
    expect(result.phone).toBe("(678) 555-1234");
    expect(result.avatar_url).toBe("/api/backend/users/azure-user-1/photo?size=648x648");
  });

  it("converts empty/whitespace fields to null", () => {
    const result = normalizePlatformUser({
      ...user,
      job_title: "   ",
      phone: "",
    });

    expect(result.job_title).toBeNull();
    expect(result.phone).toBeNull();
  });

  it("preserves email case when lowercaseEmail is false", () => {
    const result = normalizePlatformUser(user, { lowercaseEmail: false });

    expect(result.email).toBe("Dana.whitfield@northwindcg.example");
  });

  it("preserves extra fields from the original user type", () => {
    const adminUser = {
      ...user,
      role_id: "role-admin",
      is_active: true,
      role_version: 3,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: null,
      role: { id: "role-admin", name: "admin", description: null, is_system: true },
    };

    const result = normalizePlatformUser(adminUser);

    expect(result.role_id).toBe("role-admin");
    expect(result.is_active).toBe(true);
    expect(result.role_version).toBe(3);
    expect(result.role.name).toBe("admin");
  });

  it("handles minimal PlatformUserProfileSource (only id required)", () => {
    const minimal = { id: "user-minimal" };
    const result = normalizePlatformUser(minimal);

    expect(result.id).toBe("user-minimal");
    expect(result.avatar_url).toBe("/api/backend/users/user-minimal/photo");
  });
});
