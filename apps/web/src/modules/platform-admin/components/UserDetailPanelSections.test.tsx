import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  UserAccessStatusSection,
  UserRoleAssignmentSection,
} from "@/modules/platform-admin/components/UserDetailPanelSections";
import type { AdminRole } from "@/modules/platform-admin/types/admin";

const roles: AdminRole[] = [
  { id: "role-user", name: "User", description: null, is_system: false, user_count: 2 },
  { id: "role-admin", name: "Platform Admin", description: null, is_system: true, user_count: 1 },
];

describe("UserDetailPanelSections", () => {
  it("renders approval confirmation when elevated role confirmation is required", () => {
    render(
      <UserRoleAssignmentSection
        roles={roles}
        selectedRoleId="role-admin"
        onRoleChange={vi.fn()}
        requiresEmailConfirmation
        approvalConfirmation=""
        onApprovalConfirmationChange={vi.fn()}
        roleDisabledReason=""
        roleSaveDisabled
        isSaving={false}
        onSave={vi.fn()}
        feedback={null}
      />,
    );

    expect(screen.getByTestId("role-confirmation-input")).toBeInTheDocument();
    expect(screen.getByText(/type approved/i)).toBeInTheDocument();
  });

  it("renders the correct access action for inactive users", () => {
    const onReactivate = vi.fn();

    render(
      <UserAccessStatusSection
        isActive={false}
        statusDisabledReason=""
        isSaving={false}
        onDeactivate={vi.fn()}
        onReactivate={onReactivate}
        feedback={null}
      />,
    );

    fireEvent.click(screen.getByTestId("reactivate-user-button"));

    expect(onReactivate).toHaveBeenCalledTimes(1);
  });
});