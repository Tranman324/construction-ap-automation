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

import {
  createAdminTitleRule,
  deleteAdminTitleRule,
  updateAdminTitleRule,
} from "@/modules/platform-admin/lib/api";
import {
  useCreateAdminTitleRule,
  useDeleteAdminTitleRule,
  useUpdateAdminTitleRule,
} from "@/modules/platform-admin/hooks/mutations";

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
  vi.mocked(createAdminTitleRule).mockReset();
  vi.mocked(updateAdminTitleRule).mockReset();
  vi.mocked(deleteAdminTitleRule).mockReset();
  TM.emitAuditEvent.mockReset();
});

describe("platform-admin title-rule mutation audit emissions", () => {
  it("emits title-rule audit events after successful title-rule mutations", async () => {
    const titleRule = {
      id: "rule-1",
      pattern: "Controller",
      match_type: "contains" as const,
      role_id: "role-1",
      priority: 10,
      is_active: true,
      created_at: "2026-05-13T10:00:00.000Z",
      role_name: "Platform Admin",
    };
    vi.mocked(createAdminTitleRule).mockResolvedValue(titleRule);
    vi.mocked(updateAdminTitleRule).mockResolvedValue({ ...titleRule, priority: 20 });
    vi.mocked(deleteAdminTitleRule).mockResolvedValue(undefined);

    const Wrapper = makeWrapper();
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
      await updateHook.result.current.mutateAsync({ ruleId: "rule-1", payload: { priority: 20 } });
      await deleteHook.result.current.mutateAsync({ ruleId: "rule-1" });
    });

    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.title_rule.created",
      target: expect.objectContaining({ type: "title_rule", id: "rule-1", label: "Controller" }),
    }));
    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.title_rule.updated",
      target: expect.objectContaining({ type: "title_rule", id: "rule-1", label: "Controller" }),
    }));
    expect(TM.emitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.title_rule.deleted",
      target: expect.objectContaining({ type: "title_rule", id: "rule-1" }),
    }));
  });
});
