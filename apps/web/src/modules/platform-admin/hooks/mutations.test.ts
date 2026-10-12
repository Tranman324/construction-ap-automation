import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/modules/platform-admin/lib/api", () => ({
  createAdminRole: vi.fn(),
  createAdminTitleRule: vi.fn(),
  deleteAdminRole: vi.fn(),
  deleteAdminTitleRule: vi.fn(),
  previewTitleRule: vi.fn(),
  replaceAdminRolePermissions: vi.fn(),
  replaceAdminUserOverrides: vi.fn(),
  updateAdminRole: vi.fn(),
  updateAdminTitleRule: vi.fn(),
  updateAdminUser: vi.fn(),
}));

vi.mock("@/modules/shared/lib/auditEmitter", () => ({
  emitAuditEvent: vi.fn(),
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => ({ user: null }),
}));

import {
  createAdminRole,
  createAdminTitleRule,
  deleteAdminRole,
  deleteAdminTitleRule,
  previewTitleRule,
  replaceAdminRolePermissions,
  replaceAdminUserOverrides,
  updateAdminRole,
  updateAdminTitleRule,
  updateAdminUser,
} from "@/modules/platform-admin/lib/api";
import {
  useCreateAdminRole,
  useCreateAdminTitleRule,
  useDeleteAdminRole,
  useDeleteAdminTitleRule,
  usePreviewTitleRule,
  useReplaceAdminRolePermissions,
  useReplaceAdminUserOverrides,
  useUpdateAdminRole,
  useUpdateAdminTitleRule,
  useUpdateAdminUser,
} from "@/modules/platform-admin/hooks/mutations";
import { adminQueryKeys } from "@/modules/platform-admin/hooks/queries";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  return { queryClient, Wrapper };
}

beforeEach(() => {
  vi.mocked(createAdminRole).mockReset();
  vi.mocked(updateAdminRole).mockReset();
  vi.mocked(deleteAdminRole).mockReset();
  vi.mocked(updateAdminUser).mockReset();
  vi.mocked(replaceAdminRolePermissions).mockReset();
  vi.mocked(replaceAdminUserOverrides).mockReset();
  vi.mocked(createAdminTitleRule).mockReset();
  vi.mocked(updateAdminTitleRule).mockReset();
  vi.mocked(deleteAdminTitleRule).mockReset();
  vi.mocked(previewTitleRule).mockReset();
});

describe("platform-admin mutations", () => {
  it("invalidates roles for create, update, and delete role mutations", async () => {
    vi.mocked(createAdminRole).mockResolvedValue({
      id: "role-1",
      name: "Operations",
      description: null,
      is_system: false,
      user_count: 0,
    });
    vi.mocked(updateAdminRole).mockResolvedValue({
      id: "role-1",
      name: "Operations",
      description: "Updated",
      is_system: false,
      user_count: 0,
    });
    vi.mocked(deleteAdminRole).mockResolvedValue(undefined);

    const { queryClient, Wrapper } = makeWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const createHook = renderHook(() => useCreateAdminRole(), { wrapper: Wrapper });
    const updateHook = renderHook(() => useUpdateAdminRole(), { wrapper: Wrapper });
    const deleteHook = renderHook(() => useDeleteAdminRole(), { wrapper: Wrapper });

    await act(async () => {
      await createHook.result.current.mutateAsync({ name: "Operations" });
      await updateHook.result.current.mutateAsync({
        roleId: "role-1",
        payload: { description: "Updated" },
      });
      await deleteHook.result.current.mutateAsync({ roleId: "role-1" });
    });

    expect(vi.mocked(createAdminRole)).toHaveBeenCalledWith({ name: "Operations" });
    expect(vi.mocked(updateAdminRole)).toHaveBeenCalledWith("role-1", {
      description: "Updated",
    });
    expect(vi.mocked(deleteAdminRole)).toHaveBeenCalledWith("role-1");
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: adminQueryKeys.roles(),
      }),
    );
  });

  it("invalidates users when updating an admin user", async () => {
    vi.mocked(updateAdminUser).mockResolvedValue({
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

    const { queryClient, Wrapper } = makeWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateAdminUser(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ userId: "user-1", payload: { is_active: false } });
    });

    expect(vi.mocked(updateAdminUser)).toHaveBeenCalledWith("user-1", { is_active: false });
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: adminQueryKeys.users(),
      }),
    );
  });

  it("invalidates only the targeted role permissions query when replacing role permissions", async () => {
    vi.mocked(replaceAdminRolePermissions).mockResolvedValue({
      ok: true,
      permissions: ["platform.admin"],
    });

    const { queryClient, Wrapper } = makeWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useReplaceAdminRolePermissions(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        roleId: "role-1",
        payload: { permissions: ["platform.admin"] },
      });
    });

    expect(vi.mocked(replaceAdminRolePermissions)).toHaveBeenCalledWith("role-1", {
      permissions: ["platform.admin"],
    });
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: adminQueryKeys.rolePermissions("role-1"),
      }),
    );
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: adminQueryKeys.permissions(),
    });
  });

  it("invalidates only the targeted user overrides query when replacing overrides", async () => {
    vi.mocked(replaceAdminUserOverrides).mockResolvedValue({
      ok: true,
      overrides: [{ key: "platform.manage_roles", granted: false }],
    });

    const { queryClient, Wrapper } = makeWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useReplaceAdminUserOverrides(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        userId: "user-1",
        payload: {
          overrides: [{ key: "platform.manage_roles", granted: false }],
        },
      });
    });

    expect(vi.mocked(replaceAdminUserOverrides)).toHaveBeenCalledWith("user-1", {
      overrides: [{ key: "platform.manage_roles", granted: false }],
    });
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: adminQueryKeys.userOverrides("user-1"),
      }),
    );
  });

  it("invalidates title rules for create, update, and delete title rule mutations", async () => {
    vi.mocked(createAdminTitleRule).mockResolvedValue({
      id: "rule-1",
      pattern: "Controller",
      match_type: "contains",
      role_id: "role-1",
      priority: 10,
      is_active: true,
      created_at: "2026-05-13T10:00:00.000Z",
      role_name: "Platform Admin",
    });
    vi.mocked(updateAdminTitleRule).mockResolvedValue({
      id: "rule-1",
      pattern: "Controller",
      match_type: "contains",
      role_id: "role-1",
      priority: 20,
      is_active: false,
      created_at: "2026-05-13T10:00:00.000Z",
      role_name: "Platform Admin",
    });
    vi.mocked(deleteAdminTitleRule).mockResolvedValue(undefined);

    const { queryClient, Wrapper } = makeWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const createHook = renderHook(() => useCreateAdminTitleRule(), { wrapper: Wrapper });
    const updateHook = renderHook(() => useUpdateAdminTitleRule(), { wrapper: Wrapper });
    const deleteHook = renderHook(() => useDeleteAdminTitleRule(), { wrapper: Wrapper });

    await act(async () => {
      await createHook.result.current.mutateAsync({
        pattern: "Controller",
        match_type: "contains",
        role_id: "role-1",
        priority: 10,
      });
      await updateHook.result.current.mutateAsync({
        ruleId: "rule-1",
        payload: { priority: 20, is_active: false },
      });
      await deleteHook.result.current.mutateAsync({ ruleId: "rule-1" });
    });

    expect(vi.mocked(createAdminTitleRule)).toHaveBeenCalledWith({
      pattern: "Controller",
      match_type: "contains",
      role_id: "role-1",
      priority: 10,
    });
    expect(vi.mocked(updateAdminTitleRule)).toHaveBeenCalledWith("rule-1", {
      priority: 20,
      is_active: false,
    });
    expect(vi.mocked(deleteAdminTitleRule)).toHaveBeenCalledWith("rule-1");
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: adminQueryKeys.titleRules(),
      }),
    );
  });

  it("runs title rule preview without invalidating unrelated admin queries", async () => {
    vi.mocked(previewTitleRule).mockResolvedValue({ matched: null });

    const { queryClient, Wrapper } = makeWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => usePreviewTitleRule(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ jobTitle: "Controller" });
    });

    expect(vi.mocked(previewTitleRule)).toHaveBeenCalledWith({ jobTitle: "Controller" });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
