import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UserOverridesPanel } from "@/modules/platform-admin/components/UserOverridesPanel";
import type { AdminUser } from "@/modules/platform-admin/types/admin";

const selectedUser: AdminUser = {
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
};

describe("UserOverridesPanel", () => {
  it("renders the choose-user empty state when no user is selected", () => {
    render(
      <UserOverridesPanel
        selectedUser={null}
        missingRequestedUserId={null}
        showDataError={false}
        errorDescription=""
        showDataLoading={false}
        moduleEntries={[]}
        inheritedPermissions={new Set()}
        overrideModeMap={{}}
        summaryCounts={{ inheritedCount: 0, grantCount: 0, revokeCount: 0 }}
        canManagePermissions={true}
        isSaving={false}
        isDirty={false}
        feedback={null}
        onRetryData={vi.fn()}
        onModeChange={vi.fn()}
        onReset={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText(/choose a user/i)).toBeInTheDocument();
  });

  it("renders summary counts and forwards reset/save actions", () => {
    const onReset = vi.fn();
    const onSave = vi.fn();

    render(
      <UserOverridesPanel
        selectedUser={selectedUser}
        missingRequestedUserId={null}
        showDataError={false}
        errorDescription=""
        showDataLoading={false}
        moduleEntries={[["platform", [{ key: "platform.manage_users", description: "Manage users." }]]]}
        inheritedPermissions={new Set()}
        overrideModeMap={{}}
        summaryCounts={{ inheritedCount: 1, grantCount: 1, revokeCount: 0 }}
        canManagePermissions={true}
        isSaving={false}
        isDirty={true}
        feedback={null}
        onRetryData={vi.fn()}
        onModeChange={vi.fn()}
        onReset={onReset}
        onSave={onSave}
      />,
    );

    expect(screen.getByTestId("summary-inherited")).toHaveTextContent("1");
    expect(screen.getByTestId("summary-grant")).toHaveTextContent("1");
    expect(screen.getByTestId("user-overrides-save-bar").className).toContain("sticky");

    fireEvent.click(screen.getByRole("button", { name: /reset all/i }));
    fireEvent.click(screen.getByRole("button", { name: /save overrides/i }));

    expect(onReset).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalled();
  });
});