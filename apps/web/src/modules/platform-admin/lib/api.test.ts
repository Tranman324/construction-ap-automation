import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/shared/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
}));

import { api } from "@/modules/shared/lib/api";
import {
  createAdminRole,
  createAdminTitleRule,
  deleteAdminRole,
  deleteAdminTitleRule,
  getAdminPermissions,
  getAdminRolePermissions,
  getAdminRoles,
  getAdminTitleRules,
  getAdminUserOverrides,
  getAdminUsers,
  previewTitleRule,
  replaceAdminRolePermissions,
  replaceAdminUserOverrides,
  updateAdminRole,
  updateAdminTitleRule,
  updateAdminUser,
} from "@/modules/platform-admin/lib/api";

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.put).mockReset();
  vi.mocked(api.del).mockReset();
});

describe("platform-admin api", () => {
  it("calls the verified admin read endpoints with direct response shapes", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([
        {
          id: "role-1",
          name: "Platform Admin",
          description: null,
          is_system: true,
          user_count: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "user-1",
          azure_id: null,
          email: "admin@example.com",
          name: "Alex Admin",
          role_id: "role-1",
          is_active: true,
          job_title: "Controller",
          phone: null,
          avatar_url: null,
          role_version: 1,
          last_login_at: null,
          created_at: "2026-05-13T10:00:00.000Z",
          updated_at: null,
          role: null,
        },
      ])
      .mockResolvedValueOnce({
        platform: [{ key: "platform.admin", description: null }],
      })
      .mockResolvedValueOnce(["platform.admin"])
      .mockResolvedValueOnce([{ key: "platform.manage_roles", granted: true }])
      .mockResolvedValueOnce([
        {
          id: "rule-1",
          pattern: "Controller",
          match_type: "contains",
          role_id: "role-1",
          priority: 10,
          is_active: true,
          created_at: "2026-05-13T10:00:00.000Z",
          role_name: "Platform Admin",
        },
      ]);

    expect(await getAdminRoles()).toHaveLength(1);
    expect(await getAdminUsers()).toHaveLength(1);
    expect((await getAdminPermissions()).platform[0]?.key).toBe("platform.admin");
    expect(await getAdminRolePermissions("role-1")).toEqual(["platform.admin"]);
    expect(await getAdminUserOverrides("user-1")).toEqual([
      { key: "platform.manage_roles", granted: true },
    ]);
    expect((await getAdminTitleRules())[0]?.role_name).toBe("Platform Admin");

    expect(vi.mocked(api.get)).toHaveBeenNthCalledWith(1, "/api/roles");
    expect(vi.mocked(api.get)).toHaveBeenNthCalledWith(2, "/api/admin/users");
    expect(vi.mocked(api.get)).toHaveBeenNthCalledWith(3, "/api/permissions");
    expect(vi.mocked(api.get)).toHaveBeenNthCalledWith(4, "/api/roles/role-1/permissions");
    expect(vi.mocked(api.get)).toHaveBeenNthCalledWith(5, "/api/users/user-1/overrides");
    expect(vi.mocked(api.get)).toHaveBeenNthCalledWith(6, "/api/title-rules");
  });

  it("sends verified role and title rule payloads without wrapper objects", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ id: "role-1", name: "Operations", description: null, is_system: false, user_count: 0 })
      .mockResolvedValueOnce({
        id: "rule-1",
        pattern: "Controller",
        match_type: "contains",
        role_id: "role-1",
        priority: 10,
        is_active: true,
        created_at: "2026-05-13T10:00:00.000Z",
        role_name: "Platform Admin",
      })
      .mockResolvedValueOnce({ matched: null });

    vi.mocked(api.patch)
      .mockResolvedValueOnce({ id: "role-1", name: "Operations", description: "Updated", is_system: false, user_count: 0 })
      .mockResolvedValueOnce({
        id: "rule-1",
        pattern: "Controller",
        match_type: "contains",
        role_id: "role-1",
        priority: 20,
        is_active: false,
        created_at: "2026-05-13T10:00:00.000Z",
        role_name: "Platform Admin",
      });

    await createAdminRole({ name: "Operations" });
    await createAdminTitleRule({
      pattern: "Controller",
      match_type: "contains",
      role_id: "role-1",
      priority: 10,
    });
    await previewTitleRule({ jobTitle: "Controller" });
    await updateAdminRole("role-1", { description: "Updated" });
    await updateAdminTitleRule("rule-1", { priority: 20, is_active: false });

    expect(vi.mocked(api.post)).toHaveBeenNthCalledWith(1, "/api/roles", { name: "Operations" });
    expect(vi.mocked(api.post)).toHaveBeenNthCalledWith(2, "/api/title-rules", {
      pattern: "Controller",
      match_type: "contains",
      role_id: "role-1",
      priority: 10,
    });
    expect(vi.mocked(api.post)).toHaveBeenNthCalledWith(3, "/api/title-rules/preview", {
      jobTitle: "Controller",
    });
    expect(vi.mocked(api.patch)).toHaveBeenNthCalledWith(1, "/api/roles/role-1", {
      description: "Updated",
    });
    expect(vi.mocked(api.patch)).toHaveBeenNthCalledWith(2, "/api/title-rules/rule-1", {
      priority: 20,
      is_active: false,
    });
  });

  it("uses the verified admin update, replacement, and delete endpoints", async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({
      id: "user-1",
      azure_id: null,
      email: "admin@example.com",
      name: "Alex Admin",
      role_id: "role-1",
      is_active: false,
      job_title: null,
      phone: null,
      avatar_url: null,
      role_version: 2,
      last_login_at: null,
      created_at: "2026-05-13T10:00:00.000Z",
      updated_at: null,
      role: null,
    });
    vi.mocked(api.put)
      .mockResolvedValueOnce({ ok: true, permissions: ["platform.admin"] })
      .mockResolvedValueOnce({
        ok: true,
        overrides: [{ key: "platform.manage_roles", granted: false }],
      });
    vi.mocked(api.del).mockResolvedValue(undefined);

    await updateAdminUser("user-1", { is_active: false });
    await replaceAdminRolePermissions("role-1", { permissions: ["platform.admin"] });
    await replaceAdminUserOverrides("user-1", {
      overrides: [{ key: "platform.manage_roles", granted: false }],
    });
    await deleteAdminRole("role-1");
    await deleteAdminTitleRule("rule-1");

    expect(vi.mocked(api.patch)).toHaveBeenCalledWith("/api/admin/users/user-1", {
      is_active: false,
    });
    expect(vi.mocked(api.put)).toHaveBeenNthCalledWith(1, "/api/roles/role-1/permissions", {
      permissions: ["platform.admin"],
    });
    expect(vi.mocked(api.put)).toHaveBeenNthCalledWith(2, "/api/users/user-1/overrides", {
      overrides: [{ key: "platform.manage_roles", granted: false }],
    });
    expect(vi.mocked(api.del)).toHaveBeenNthCalledWith(1, "/api/roles/role-1");
    expect(vi.mocked(api.del)).toHaveBeenNthCalledWith(2, "/api/title-rules/rule-1");
  });
});