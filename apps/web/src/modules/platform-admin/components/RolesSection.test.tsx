import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RolesSection } from "@/modules/platform-admin/components/RolesSection";

const testState = vi.hoisted(() => ({
  roles: [
    {
      id: "role-system",
      name: "Platform Admin",
      description: "Protected administrators",
      is_system: true,
      user_count: 2,
    },
    {
      id: "role-custom",
      name: "Operations Lead",
      description: null,
      is_system: false,
      user_count: 4,
    },
  ],
  canManageRoles: true,
  createMutation: {
    mutate: vi.fn(),
    isPending: false,
  },
  updateMutation: {
    mutate: vi.fn(),
    isPending: false,
  },
  deleteMutation: {
    mutate: vi.fn(),
    isPending: false,
  },
}));

vi.mock("@/modules/platform-admin/hooks/queries", () => ({
  useAdminRoles: () => ({
    data: testState.roles,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/modules/platform-admin/hooks/mutations", () => ({
  useCreateAdminRole: () => testState.createMutation,
  useUpdateAdminRole: () => testState.updateMutation,
  useDeleteAdminRole: () => testState.deleteMutation,
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: (key: string) =>
      key === "platform.manage_roles" ? testState.canManageRoles : false,
    hasAnyPermission: () => false,
    hasAllPermissions: () => false,
    role: "platform.admin",
    isAdmin: false,
    permissions: [],
  }),
}));

describe("RolesSection", () => {
  beforeEach(() => {
    testState.canManageRoles = true;
    testState.createMutation.isPending = false;
    testState.updateMutation.isPending = false;
    testState.deleteMutation.isPending = false;
    testState.createMutation.mutate.mockReset();
    testState.updateMutation.mutate.mockReset();
    testState.deleteMutation.mutate.mockReset();
  });

  it("submits create and edit payloads through the admin role mutations", () => {
    render(<RolesSection />);

    fireEvent.click(screen.getByRole("button", { name: /create role/i }));
    fireEvent.change(screen.getByLabelText(/role name/i), {
      target: { value: "Project Controls" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "Coordinates project controls access." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create role$/i }));

    expect(testState.createMutation.mutate).toHaveBeenCalledWith(
      {
        name: "Project Controls",
        description: "Coordinates project controls access.",
      },
      expect.any(Object),
    );

    fireEvent.click(screen.getByTestId("edit-role-role-custom"));
    fireEvent.change(screen.getByLabelText(/role name/i), {
      target: { value: "Operations Director" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(testState.updateMutation.mutate).toHaveBeenCalledWith(
      {
        roleId: "role-custom",
        payload: {
          name: "Operations Director",
          description: null,
        },
      },
      expect.any(Object),
    );
  });

  it("keeps system role edit and delete controls disabled", () => {
    render(<RolesSection />);

    expect(screen.getByTestId("edit-role-role-system")).toBeDisabled();
    expect(screen.getByTestId("delete-role-role-system")).toBeDisabled();
    expect(screen.getByText("System role is locked.")).toBeInTheDocument();
  });

  it("confirms deletes and shows assigned-user conflict feedback inline", () => {
    render(<RolesSection />);

    fireEvent.click(screen.getByTestId("delete-role-role-custom"));

    expect(screen.getByText("Delete Operations Lead?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /delete role/i }));

    const [, options] = testState.deleteMutation.mutate.mock.calls[0];
    act(() => {
      options.onError?.({
        status: 409,
        message: "Role still assigned to users.",
      });
    });

    expect(testState.deleteMutation.mutate).toHaveBeenCalledWith(
      { roleId: "role-custom" },
      expect.any(Object),
    );
    expect(
      screen.getByText("This role is still assigned to one or more users and cannot be deleted."),
    ).toBeInTheDocument();
  });

  it("shows understandable duplicate-name feedback", () => {
    render(<RolesSection />);

    fireEvent.click(screen.getByRole("button", { name: /create role/i }));
    fireEvent.change(screen.getByLabelText(/role name/i), {
      target: { value: "Operations Lead" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create role$/i }));

    const [, options] = testState.createMutation.mutate.mock.calls[0];
    act(() => {
      options.onError?.({
        status: 409,
        message: "duplicate key value violates unique constraint",
      });
    });

    expect(screen.getByText("A role with this name already exists.")).toBeInTheDocument();
  });

  it("keeps management controls visible but disabled when the permission is missing", () => {
    testState.canManageRoles = false;

    render(<RolesSection />);

    expect(screen.getByRole("button", { name: /create role/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /create role/i })).toHaveAttribute("title", "Requires platform.manage_roles");
    expect(screen.getByTestId("edit-role-role-custom")).toBeDisabled();
    expect(screen.getByTestId("delete-role-role-custom")).toBeDisabled();
    expect(screen.getAllByText("Requires platform.manage_roles").length).toBeGreaterThan(0);
  });
});