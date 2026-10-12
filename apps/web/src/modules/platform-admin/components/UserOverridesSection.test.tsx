import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  canManagePermissions: true,
  usersPending: false,
  permissionsPending: false,
  rolePermissionsPending: false,
  userOverridesPending: false,
  usersError: null as Error | null,
  permissionsError: null as Error | null,
  rolePermissionsError: null as Error | null,
  userOverridesError: null as Error | null,
  users: [
    {
      id: "user-1",
      azure_id: null,
      email: "taylor@northwindcg.example",
      name: "Taylor One",
      role_id: "role-ops",
      is_active: true,
      job_title: "Project Engineer",
      phone: null,
      avatar_url: null,
      role_version: 3,
      last_login_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: null,
      role: { id: "role-ops", name: "Operations", description: null, is_system: false },
    },
    {
      id: "user-2",
      azure_id: null,
      email: "paula@northwindcg.example",
      name: "Paula Two",
      role_id: "role-pm",
      is_active: false,
      job_title: "Project Manager",
      phone: null,
      avatar_url: null,
      role_version: 5,
      last_login_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: null,
      role: { id: "role-pm", name: "Project Manager", description: null, is_system: false },
    },
  ],
  permissions: {
    platform: [
      { key: "platform.manage_users", description: "Manage users." },
      { key: "platform.manage_permissions", description: "Manage permissions." },
    ],
    invoices: [
      { key: "accounting.invoices.submit_spectrum", description: "Submit invoices." },
      { key: "accounting.invoices.view", description: "View invoices." },
    ],
  },
  rolePermissionsByRole: {
    "role-ops": ["accounting.invoices.view"],
    "role-pm": ["accounting.invoices.view", "platform.manage_permissions"],
  } as Record<string, string[]>,
  userOverridesByUser: {
    "user-1": [{ key: "platform.manage_users", granted: true }],
    "user-2": [{ key: "accounting.invoices.submit_spectrum", granted: false }],
  } as Record<string, Array<{ key: string; granted: boolean }>>,
  mutateAsync: vi.fn(async ({ payload }: { payload: { overrides: Array<{ key: string; granted: boolean }> } }) => ({
    ok: true as const,
    overrides: payload.overrides,
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: testState.routerReplace }),
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: vi.fn((permissionKey: string) =>
      permissionKey === "platform.manage_permissions" ? testState.canManagePermissions : false,
    ),
  }),
}));

vi.mock("@/modules/platform-admin/hooks/queries", () => ({
  useAdminUsers: () => ({
    data: testState.users,
    isPending: testState.usersPending,
    isError: Boolean(testState.usersError),
    error: testState.usersError,
    refetch: vi.fn(async () => undefined),
  }),
  useAdminPermissions: () => ({
    data: testState.permissions,
    isPending: testState.permissionsPending,
    isError: Boolean(testState.permissionsError),
    error: testState.permissionsError,
    refetch: vi.fn(async () => undefined),
  }),
  useAdminRolePermissions: (roleId?: string | null) => ({
    data: roleId ? testState.rolePermissionsByRole[roleId] ?? [] : undefined,
    isPending: Boolean(roleId) && testState.rolePermissionsPending,
    isError: Boolean(testState.rolePermissionsError),
    error: testState.rolePermissionsError,
    refetch: vi.fn(async () => undefined),
  }),
  useAdminUserOverrides: (userId?: string | null) => ({
    data: userId ? testState.userOverridesByUser[userId] ?? [] : undefined,
    isPending: Boolean(userId) && testState.userOverridesPending,
    isError: Boolean(testState.userOverridesError),
    error: testState.userOverridesError,
    refetch: vi.fn(async () => undefined),
  }),
}));

vi.mock("@/modules/platform-admin/hooks/mutations", () => ({
  useReplaceAdminUserOverrides: () => ({
    isPending: false,
    mutateAsync: testState.mutateAsync,
  }),
}));

import { UserOverridesSection } from "@/modules/platform-admin/components/UserOverridesSection";

describe("UserOverridesSection", () => {
  beforeEach(() => {
    testState.routerReplace.mockReset();
    testState.canManagePermissions = true;
    testState.usersPending = false;
    testState.permissionsPending = false;
    testState.rolePermissionsPending = false;
    testState.userOverridesPending = false;
    testState.usersError = null;
    testState.permissionsError = null;
    testState.rolePermissionsError = null;
    testState.userOverridesError = null;
    testState.userOverridesByUser = {
      "user-1": [{ key: "platform.manage_users", granted: true }],
      "user-2": [{ key: "accounting.invoices.submit_spectrum", granted: false }],
    };
    testState.mutateAsync.mockReset();
    testState.mutateAsync.mockImplementation(async ({ payload }: { payload: { overrides: Array<{ key: string; granted: boolean }> } }) => ({
      ok: true,
      overrides: payload.overrides,
    }));
  });

  it("preselects the requested userId and renders the inherited baseline", () => {
    render(<UserOverridesSection userId="user-1" />);

    expect(screen.getByText(/overrides for taylor one/i)).toBeInTheDocument();
    expect(screen.getByTestId("override-row-accounting.invoices.view")).toHaveTextContent("Inherited grant");
    expect(screen.getByTestId("summary-inherited")).toHaveTextContent("3");
    expect(screen.getByTestId("summary-grant")).toHaveTextContent("1");
  });

  it("shows a recoverable not-found state and lets the admin search/select another user", async () => {
    const user = userEvent.setup();

    render(<UserOverridesSection userId="missing-user" />);

    expect(screen.getByTestId("user-overrides-missing-user")).toHaveTextContent("missing-user");
    expect(screen.getByText(/requested user not found/i)).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: /search override users/i }), "paula");
    expect(screen.queryByTestId("override-user-option-user-1")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("override-user-option-user-2"));

    expect(testState.routerReplace).toHaveBeenCalledWith("/admin?section=overrides&userId=user-2");
    expect(screen.getByText(/overrides for paula two/i)).toBeInTheDocument();
  });

  it("applies tri-state changes, updates summary counts, and saves only explicit overrides", async () => {
    const user = userEvent.setup();

    render(<UserOverridesSection userId="user-1" />);

    await user.click(screen.getByRole("radio", { name: /set platform\.manage_users to inherited/i }));
    await user.click(screen.getByRole("radio", { name: /set accounting\.invoices\.view to revoke/i }));
    await user.click(screen.getByRole("radio", { name: /set accounting\.invoices\.submit_spectrum to grant/i }));

    expect(screen.getByTestId("summary-inherited")).toHaveTextContent("2");
    expect(screen.getByTestId("summary-grant")).toHaveTextContent("1");
    expect(screen.getByTestId("summary-revoke")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: /save overrides/i }));

    await waitFor(() => {
      expect(testState.mutateAsync).toHaveBeenCalledWith({
        userId: "user-1",
        payload: {
          overrides: [
            { key: "accounting.invoices.submit_spectrum", granted: true },
            { key: "accounting.invoices.view", granted: false },
          ],
        },
      });
    });

    expect(screen.getByRole("status")).toHaveTextContent("Saved 2 explicit overrides for Taylor One.");
  });

  it("keeps override controls visible but disabled without platform.manage_permissions", () => {
    testState.canManagePermissions = false;

    render(<UserOverridesSection userId="user-1" />);

    expect(screen.getByTestId("user-overrides-disabled")).toHaveTextContent(
      "Requires platform.manage_permissions",
    );
    expect(screen.getByRole("radio", { name: /set accounting\.invoices\.view to grant/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /set accounting\.invoices\.view to grant/i })).toHaveAttribute("title", "Requires platform.manage_permissions");
    expect(screen.getByRole("button", { name: /save overrides/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save overrides/i })).toHaveAttribute("title", "Requires platform.manage_permissions");
  });
});
