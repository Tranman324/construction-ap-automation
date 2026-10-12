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

import { useReplaceAdminRolePermissions } from "@/modules/platform-admin/hooks/mutations";
import { adminQueryKeys } from "@/modules/platform-admin/hooks/queries";
import { replaceAdminRolePermissions } from "@/modules/platform-admin/lib/api";

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
  vi.mocked(replaceAdminRolePermissions).mockReset();
  TM.emitAuditEvent.mockReset();
});

describe("role permission replacement audit emission", () => {
  it("emits a role update audit event with permission changes after success", async () => {
    vi.mocked(replaceAdminRolePermissions).mockResolvedValue({
      ok: true,
      permissions: ["platform.admin", "platform.manage_roles"],
    });

    const { queryClient, Wrapper } = makeWrapper();
    queryClient.setQueryData(adminQueryKeys.rolePermissions("role-1"), ["platform.admin"]);
    const { result } = renderHook(() => useReplaceAdminRolePermissions(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        roleId: "role-1",
        payload: { permissions: ["platform.admin", "platform.manage_roles"] },
      });
    });

    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.role.updated",
      actor: expect.objectContaining({ userId: "admin-1" }),
      target: expect.objectContaining({ type: "role", id: "role-1" }),
      severity: "warning",
      summary: "Updated permissions for role role-1",
      changes: {
        permissions: {
          from: ["platform.admin"],
          to: ["platform.admin", "platform.manage_roles"],
        },
      },
    }));
  });

  it("does not emit a role permission audit event when replacement fails", async () => {
    vi.mocked(replaceAdminRolePermissions).mockRejectedValue(new Error("offline"));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useReplaceAdminRolePermissions(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({
        roleId: "role-1",
        payload: { permissions: ["platform.admin"] },
      })).rejects.toThrow("offline");
    });

    expect(TM.emitAuditEvent).not.toHaveBeenCalled();
  });
});
