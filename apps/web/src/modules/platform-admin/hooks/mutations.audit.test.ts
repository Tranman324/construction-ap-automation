import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TM = vi.hoisted(() => ({
  emitAuditEvent: vi.fn(),
  authUser: {
    userId: "admin-1",
    name: "Alex Admin",
    email: "admin@example.com",
    role: "admin",
  },
}));

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
  emitAuditEvent: TM.emitAuditEvent,
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => ({ user: TM.authUser }),
}));

import { createAdminRole, deleteAdminRole, replaceAdminUserOverrides, updateAdminRole, updateAdminUser } from "@/modules/platform-admin/lib/api";
import { useCreateAdminRole, useDeleteAdminRole, useReplaceAdminUserOverrides, useUpdateAdminRole, useUpdateAdminUser } from "@/modules/platform-admin/hooks/mutations";

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

  return Wrapper;
}

beforeEach(() => {
  vi.mocked(createAdminRole).mockReset();
  vi.mocked(updateAdminRole).mockReset();
  vi.mocked(deleteAdminRole).mockReset();
  vi.mocked(updateAdminUser).mockReset();
  vi.mocked(replaceAdminUserOverrides).mockReset();
  TM.emitAuditEvent.mockReset();
});

describe("platform-admin mutation audit emissions", () => {
  it("emits role audit events after successful role mutations", async () => {
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

    const Wrapper = makeWrapper();
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

    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.role.created",
      actor: expect.objectContaining({ userId: "admin-1" }),
      target: expect.objectContaining({ type: "role", id: "role-1", label: "Operations" }),
      severity: "info",
    }));
    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.role.updated",
      severity: "warning",
    }));
    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.role.deleted",
      severity: "critical",
    }));
  });

  it("emits user role and override audit events only for matching successful mutations", async () => {
    vi.mocked(updateAdminUser)
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        id: "user-1",
        azure_id: null,
        email: "admin@example.com",
        name: "Alex Admin",
        role_id: "role-2",
        is_active: true,
        job_title: null,
        phone: null,
        avatar_url: null,
        role_version: 3,
        last_login_at: null,
        created_at: "2026-05-13T10:00:00.000Z",
        updated_at: null,
        role: { id: "role-2", name: "Platform Admin", description: null, is_system: true },
      });
    vi.mocked(replaceAdminUserOverrides).mockResolvedValue({
      ok: true,
      overrides: [{ key: "platform.manage_roles", granted: false }],
    });

    const Wrapper = makeWrapper();
    const updateUserHook = renderHook(() => useUpdateAdminUser(), { wrapper: Wrapper });
    const overridesHook = renderHook(() => useReplaceAdminUserOverrides(), { wrapper: Wrapper });

    await act(async () => {
      await updateUserHook.result.current.mutateAsync({ userId: "user-1", payload: { is_active: false } });
      await updateUserHook.result.current.mutateAsync({ userId: "user-1", payload: { role_id: "role-2" } });
      await overridesHook.result.current.mutateAsync({
        userId: "user-1",
        payload: { overrides: [{ key: "platform.manage_roles", granted: false }] },
      });
    });

    expect(TM.emitAuditEvent).toHaveBeenCalledTimes(2);
    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.user.role_changed",
      target: expect.objectContaining({ type: "user", id: "user-1", label: "Alex Admin" }),
      summary: "Changed Alex Admin's role to Platform Admin",
    }));
    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.user.permissions_overridden",
      target: expect.objectContaining({ type: "user", id: "user-1" }),
    }));
  });

  it("does not emit audit events when an admin mutation fails", async () => {
    vi.mocked(updateAdminRole).mockRejectedValue(new Error("offline"));

    const Wrapper = makeWrapper();
    const { result } = renderHook(() => useUpdateAdminRole(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({
        roleId: "role-1",
        payload: { description: "Updated" },
      })).rejects.toThrow("offline");
    });

    expect(TM.emitAuditEvent).not.toHaveBeenCalled();
  });
});
