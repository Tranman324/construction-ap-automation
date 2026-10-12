import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TM = vi.hoisted(() => ({
  routerPush: vi.fn(),
  authUserId: "admin-1",
  canManageUsers: true,
  mutateAsync: vi.fn(async () => ({})),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: TM.routerPush }),
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => ({ user: { userId: TM.authUserId } }),
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => TM.canManageUsers }),
}));

vi.mock("@/modules/platform-admin/hooks/mutations", () => ({
  useUpdateAdminUser: () => ({ isPending: false, mutateAsync: TM.mutateAsync }),
}));

import { UserDetailPanel } from "@/modules/platform-admin/components/UserDetailPanel";
import type { AdminRole, AdminUser } from "@/modules/platform-admin/types/admin";

const roles: AdminRole[] = [
  { id: "role-user", name: "User", description: null, is_system: false, user_count: 2 },
  { id: "role-admin", name: "Platform Admin", description: null, is_system: true, user_count: 1 },
];

const baseUser: AdminUser = {
  id: "user-2",
  azure_id: null,
  email: "user.two@northwindcg.example",
  name: "User Two",
  role_id: "role-user",
  is_active: true,
  job_title: "Project Engineer",
  phone: null,
  avatar_url: null,
  role_version: 4,
  last_login_at: "2026-05-12T10:00:00.000Z",
  created_at: "2026-01-01T10:00:00.000Z",
  updated_at: null,
  role: { id: "role-user", name: "User", description: null, is_system: false },
};

describe("UserDetailPanel", () => {
  beforeEach(() => {
    TM.routerPush.mockReset();
    TM.authUserId = "admin-1";
    TM.canManageUsers = true;
    TM.mutateAsync = vi.fn(async () => ({}));
  });

  it("blocks self role edits and active state changes", () => {
    TM.authUserId = "user-2";

    render(<UserDetailPanel user={baseUser} roles={roles} />);

    expect(screen.getByLabelText("Role assignment")).toBeDisabled();
    expect(screen.getByLabelText("Role assignment")).toHaveAttribute("title", expect.stringMatching(/cannot change your own role/i));
    expect(screen.getByTestId("deactivate-user-button")).toBeDisabled();
    expect(screen.getByTestId("deactivate-user-button")).toHaveAttribute("title", expect.stringMatching(/cannot change your own active state/i));
    expect(screen.getByText(/cannot change your own role/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot change your own active state/i)).toBeInTheDocument();
  });

  it("requires confirmation before deactivation", async () => {
    render(<UserDetailPanel user={baseUser} roles={roles} />);

    fireEvent.click(screen.getByTestId("deactivate-user-button"));
    fireEvent.click(screen.getByRole("button", { name: /confirm deactivation/i }));

    await waitFor(() => {
      expect(TM.mutateAsync).toHaveBeenCalledWith({
        userId: "user-2",
        payload: { is_active: false },
      });
    });
  });

  it("requires typing approved before elevated admin role assignment", async () => {
    render(<UserDetailPanel user={baseUser} roles={roles} />);

    fireEvent.change(screen.getByLabelText("Role assignment"), { target: { value: "role-admin" } });

    expect(screen.getByTestId("role-save-button")).toBeDisabled();

    fireEvent.change(screen.getByTestId("role-confirmation-input"), {
      target: { value: "approved" },
    });
    fireEvent.click(screen.getByTestId("role-save-button"));

    await waitFor(() => {
      expect(TM.mutateAsync).toHaveBeenCalledWith({
        userId: "user-2",
        payload: { role_id: "role-admin" },
      });
    });
  });

  it("renders the Azure profile image when an avatar URL is available", () => {
    render(<UserDetailPanel user={{ ...baseUser, avatar_url: "https://example.com/avatar.jpg" }} roles={roles} />);

    expect(screen.getByRole("img", { name: "User Two" })).toHaveAttribute("src", "https://example.com/avatar.jpg");
    expect(screen.getByText("Project Engineer")).toHaveClass("font-bold");
  });

  it("keeps mutation controls visible but disabled without platform.manage_users", () => {
    TM.canManageUsers = false;

    render(<UserDetailPanel user={baseUser} roles={roles} />);

    expect(screen.getByLabelText("Role assignment")).toBeDisabled();
    expect(screen.getByLabelText("Role assignment")).toHaveAttribute("title", expect.stringMatching(/requires platform\.manage_users/i));
    expect(screen.getByTestId("deactivate-user-button")).toBeDisabled();
    expect(screen.getByTestId("deactivate-user-button")).toHaveAttribute("title", expect.stringMatching(/requires platform\.manage_users/i));
    expect(screen.getAllByText(/requires platform\.manage_users/i).length).toBeGreaterThan(0);
  });

  it("navigates to overrides with durable user context", () => {
    render(<UserDetailPanel user={baseUser} roles={roles} />);

    fireEvent.click(screen.getByTestId("manage-overrides-button"));

    expect(TM.routerPush).toHaveBeenCalledWith("/admin?section=overrides&userId=user-2");
  });
});