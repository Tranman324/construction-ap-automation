import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/modules/platform-admin/lib/api", () => ({
  getAdminPermissions: vi.fn(),
  getAdminRolePermissions: vi.fn(),
  getAdminRoles: vi.fn(),
  getAdminTitleRules: vi.fn(),
  getAdminUserOverrides: vi.fn(),
  getAdminUsers: vi.fn(),
}));

import {
  getAdminPermissions,
  getAdminRolePermissions,
  getAdminRoles,
  getAdminTitleRules,
  getAdminUserOverrides,
  getAdminUsers,
} from "@/modules/platform-admin/lib/api";
import {
  adminQueryKeys,
  useAdminPermissions,
  useAdminRolePermissions,
  useAdminRoles,
  useAdminTitleRules,
  useAdminUsers,
  useAdminUserOverrides,
} from "@/modules/platform-admin/hooks/queries";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  return Wrapper;
}

beforeEach(() => {
  vi.mocked(getAdminRoles).mockReset();
  vi.mocked(getAdminTitleRules).mockReset();
  vi.mocked(getAdminUsers).mockReset();
  vi.mocked(getAdminPermissions).mockReset();
  vi.mocked(getAdminRolePermissions).mockReset();
  vi.mocked(getAdminUserOverrides).mockReset();
});

describe("platform-admin queries", () => {
  it("defines stable admin query key patterns", () => {
    expect(adminQueryKeys.all).toEqual(["platform-admin"]);
    expect(adminQueryKeys.roles()).toEqual(["platform-admin", "roles"]);
    expect(adminQueryKeys.users()).toEqual(["platform-admin", "users"]);
    expect(adminQueryKeys.permissions()).toEqual(["platform-admin", "permissions"]);
    expect(adminQueryKeys.rolePermissions("role-1")).toEqual([
      "platform-admin",
      "role-permissions",
      "role-1",
    ]);
    expect(adminQueryKeys.userOverrides("user-1")).toEqual([
      "platform-admin",
      "user-overrides",
      "user-1",
    ]);
    expect(adminQueryKeys.titleRules()).toEqual(["platform-admin", "title-rules"]);
  });

  it("normalizes admin users with Azure photo proxy fallbacks", async () => {
    vi.mocked(getAdminUsers).mockResolvedValue([
      {
        id: "user-2",
        azure_id: "azure-user-2",
        email: "user.two@northwindcg.example",
        name: "User Two",
        role_id: "role-user",
        is_active: true,
        job_title: "Project Engineer",
        phone: null,
        avatar_url: null,
        role_version: 4,
        last_login_at: null,
        created_at: "2026-01-01T10:00:00.000Z",
        updated_at: null,
        role: { id: "role-user", name: "User", description: null, is_system: false },
      },
    ]);

    const { result } = renderHook(() => useAdminUsers(), { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(result.current.data?.[0]?.avatar_url).toBe("/api/backend/users/azure-user-2/photo?size=648x648"),
    );
  });

  it("normalizes role and title-rule role names from the API", async () => {
    vi.mocked(getAdminRoles).mockResolvedValue([
      { id: "role-admin", name: "admin", description: null, is_system: true, user_count: 1 },
    ]);
    vi.mocked(getAdminTitleRules).mockResolvedValue([
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
    ]);

    const roles = renderHook(() => useAdminRoles(), { wrapper: makeWrapper() });
    const titleRules = renderHook(() => useAdminTitleRules(), { wrapper: makeWrapper() });

    await waitFor(() => expect(roles.result.current.data?.[0]?.name).toBe("Admin"));
    await waitFor(() => expect(titleRules.result.current.data?.[0]?.role_name).toBe("Admin"));
  });

  it("loads roles and grouped permissions through the admin API layer", async () => {
    vi.mocked(getAdminRoles).mockResolvedValue([
      {
        id: "role-1",
        name: "Platform Admin",
        description: null,
        is_system: true,
        user_count: 1,
      },
    ]);
    vi.mocked(getAdminPermissions).mockResolvedValue({
      platform: [{ key: "platform.admin", description: null }],
    });

    const roles = renderHook(() => useAdminRoles(), { wrapper: makeWrapper() });
    const permissions = renderHook(() => useAdminPermissions(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(roles.result.current.data?.[0]?.name).toBe("Platform Admin"));
    await waitFor(() =>
      expect(permissions.result.current.data?.platform[0]?.key).toBe("platform.admin"),
    );

    expect(vi.mocked(getAdminRoles)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getAdminPermissions)).toHaveBeenCalledTimes(1);
  });

  it("does not fetch role permissions until a role id is available", async () => {
    renderHook(() => useAdminRolePermissions(""), { wrapper: makeWrapper() });

    expect(vi.mocked(getAdminRolePermissions)).not.toHaveBeenCalled();

    vi.mocked(getAdminRolePermissions).mockResolvedValue(["platform.admin"]);

    const { result } = renderHook(() => useAdminRolePermissions("role-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual(["platform.admin"]));
    expect(vi.mocked(getAdminRolePermissions)).toHaveBeenCalledWith("role-1");
  });

  it("does not fetch user overrides until a user id is available", async () => {
    renderHook(() => useAdminUserOverrides(undefined), { wrapper: makeWrapper() });

    expect(vi.mocked(getAdminUserOverrides)).not.toHaveBeenCalled();

    vi.mocked(getAdminUserOverrides).mockResolvedValue([
      { key: "platform.manage_roles", granted: false },
    ]);

    const { result } = renderHook(() => useAdminUserOverrides("user-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() =>
      expect(result.current.data).toEqual([{ key: "platform.manage_roles", granted: false }]),
    );
    expect(vi.mocked(getAdminUserOverrides)).toHaveBeenCalledWith("user-1");
  });
});