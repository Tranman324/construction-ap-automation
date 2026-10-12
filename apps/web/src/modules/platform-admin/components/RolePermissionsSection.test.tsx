import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  roles: [
    {
      id: "role-leadership",
      name: "Leadership",
      description: "Leadership access",
      is_system: false,
      user_count: 3,
    },
    {
      id: "role-admin",
      name: "Platform Admin",
      description: "Administrative access",
      is_system: true,
      user_count: 1,
    },
  ],
  permissions: {
    platform: [
      { key: "platform.manage_users", description: "Manage platform users." },
      { key: "platform.manage_permissions", description: "Replace role permission sets." },
    ],
    accounting: [
      { key: "accounting.invoices.view", description: "View invoice data." },
      { key: "accounting.invoices.coi_override", description: "Apply and revoke COI compliance overrides." },
      { key: "accounting.invoices.manage_settings", description: "Manage invoice compliance settings." },
    ],
    feature_requests: [
      {
        key: "feature_requests.manage",
        description: "Manage feature request statuses and administrative actions.",
      },
    ],
  },
  rolePermissionsByRole: {
    "role-leadership": ["accounting.invoices.view", "accounting.invoices.coi_override"],
    "role-admin": ["platform.manage_permissions", "platform.manage_users"],
  } as Record<string, string[]>,
  rolesPending: false,
  permissionsPending: false,
  rolesError: null as Error | null,
  permissionsError: null as Error | null,
  rolePermissionsError: null as Error | null,
  canManagePermissions: true,
  refetchRoles: vi.fn(async () => undefined),
  refetchPermissions: vi.fn(async () => undefined),
  refetchRolePermissions: vi.fn(async () => undefined),
  mutateAsync: vi.fn(async ({ payload }: { payload: { permissions: string[] } }) => ({
    ok: true as const,
    permissions: payload.permissions,
  })),
}));

vi.mock("@/modules/platform-admin/hooks/queries", () => ({
  useAdminRoles: () => ({
    data: testState.roles,
    isPending: testState.rolesPending,
    isError: Boolean(testState.rolesError),
    error: testState.rolesError,
    refetch: testState.refetchRoles,
  }),
  useAdminPermissions: () => ({
    data: testState.permissions,
    isPending: testState.permissionsPending,
    isError: Boolean(testState.permissionsError),
    error: testState.permissionsError,
    refetch: testState.refetchPermissions,
  }),
  useAdminRolePermissions: (roleId?: string | null) => ({
    data: roleId ? testState.rolePermissionsByRole[roleId] ?? [] : undefined,
    isPending: false,
    isError: Boolean(testState.rolePermissionsError),
    error: testState.rolePermissionsError,
    refetch: testState.refetchRolePermissions,
  }),
}));

vi.mock("@/modules/platform-admin/hooks/mutations", () => ({
  useReplaceAdminRolePermissions: () => ({
    mutateAsync: testState.mutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: vi.fn((permissionKey: string) =>
      permissionKey === "platform.manage_permissions" ? testState.canManagePermissions : false,
    ),
    hasAnyPermission: vi.fn(() => false),
    hasAllPermissions: vi.fn(() => false),
    role: "admin",
    isAdmin: false,
    permissions: testState.canManagePermissions ? ["platform.manage_permissions"] : [],
  }),
}));

import { RolePermissionsSection } from "@/modules/platform-admin/components/RolePermissionsSection";

describe("RolePermissionsSection", () => {
  beforeEach(() => {
    testState.roles = [
      {
        id: "role-leadership",
        name: "Leadership",
        description: "Leadership access",
        is_system: false,
        user_count: 3,
      },
      {
        id: "role-admin",
        name: "Platform Admin",
        description: "Administrative access",
        is_system: true,
        user_count: 1,
      },
    ];
    testState.permissions = {
      platform: [
        { key: "platform.manage_users", description: "Manage platform users." },
        { key: "platform.manage_permissions", description: "Replace role permission sets." },
      ],
      accounting: [
        { key: "accounting.invoices.view", description: "View invoice data." },
        { key: "accounting.invoices.coi_override", description: "Apply and revoke COI compliance overrides." },
        { key: "accounting.invoices.manage_settings", description: "Manage invoice compliance settings." },
      ],
      feature_requests: [
        {
          key: "feature_requests.manage",
          description: "Manage feature request statuses and administrative actions.",
        },
      ],
    };
    testState.rolePermissionsByRole = {
      "role-leadership": ["accounting.invoices.view", "accounting.invoices.coi_override"],
      "role-admin": ["platform.manage_permissions", "platform.manage_users"],
    };
    testState.rolesPending = false;
    testState.permissionsPending = false;
    testState.rolesError = null;
    testState.permissionsError = null;
    testState.rolePermissionsError = null;
    testState.canManagePermissions = true;
    testState.refetchRoles.mockReset();
    testState.refetchPermissions.mockReset();
    testState.refetchRolePermissions.mockReset();
    testState.mutateAsync.mockReset();
    testState.mutateAsync.mockImplementation(async ({ payload }: { payload: { permissions: string[] } }) => ({
      ok: true,
      permissions: payload.permissions,
    }));
  });

  it("defaults to the first role and renders the grouped permission matrix", () => {
    render(<RolePermissionsSection />);

    expect(screen.getByTestId("role-permissions-current-role")).toHaveTextContent("Leadership");
    expect(screen.getByTestId("permission-matrix")).toBeInTheDocument();
    expect(screen.getByTestId("permission-row-feature_requests.manage")).toBeInTheDocument();
    expect(screen.getByTestId("permission-row-accounting.invoices.coi_override")).toBeInTheDocument();
    expect(screen.getByTestId("permission-row-accounting.invoices.manage_settings")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /toggle accounting.invoices.coi_override/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /toggle accounting.invoices.manage_settings/i })).not.toBeChecked();
  });

  it("supports role selection and protects admin roles with bypass messaging", async () => {
    const user = userEvent.setup();

    render(<RolePermissionsSection />);

    await user.click(screen.getByRole("combobox", { name: /role selector/i }));
    await user.click(screen.getByRole("option", { name: /platform admin/i }));

    expect(screen.getByTestId("role-permissions-current-role")).toHaveTextContent("Platform Admin");
    expect(screen.getByTestId("permission-matrix-readonly")).toHaveTextContent(
      "Admin bypasses permission checks",
    );
  });

  it("saves the full replacement payload through the existing mutation hook", async () => {
    const user = userEvent.setup();

    render(<RolePermissionsSection />);

    await user.click(screen.getByRole("button", { name: /select all feature requests/i }));
    await user.click(screen.getByRole("button", { name: /save permissions/i }));

    expect(testState.mutateAsync).toHaveBeenCalledWith({
      roleId: "role-leadership",
      payload: {
        permissions: [
          "accounting.invoices.coi_override",
          "accounting.invoices.view",
          "feature_requests.manage",
        ],
      },
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved 3 permissions for Leadership.");
  });

  it("shows an empty state when no roles are available", () => {
    testState.roles = [];

    render(<RolePermissionsSection />);

    expect(screen.getByText("No roles available")).toBeInTheDocument();
  });
});
