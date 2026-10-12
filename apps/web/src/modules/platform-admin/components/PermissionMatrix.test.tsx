import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PermissionMatrix } from "@/modules/platform-admin/components/PermissionMatrix";

const permissionGroups = {
  platform: [
    { key: "platform.manage_users", description: "Manage platform users." },
    { key: "platform.manage_permissions", description: "Replace role permission sets." },
  ],
  invoices: [{ key: "accounting.invoices.view", description: "View invoice data." }],
  feature_requests: [
    {
      key: "feature_requests.manage",
      description: "Manage feature request statuses and administrative actions.",
    },
  ],
};

describe("PermissionMatrix", () => {
  it("renders grouped permissions and high-risk treatment", () => {
    render(
      <PermissionMatrix
        permissionGroups={permissionGroups}
        loadedPermissions={["platform.manage_users"]}
        canManagePermissions={true}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.getByText("Invoices")).toBeInTheDocument();
    expect(screen.getByText("Feature Requests")).toBeInTheDocument();
    expect(screen.getByTestId("permission-row-feature_requests.manage")).toBeInTheDocument();
    expect(screen.getByTestId("permission-row-platform.manage_permissions")).toHaveTextContent(
      "High risk",
    );
  });

  it("tracks dirty state and supports module select, clear, and reset actions", async () => {
    const user = userEvent.setup();

    render(
      <PermissionMatrix
        permissionGroups={permissionGroups}
        loadedPermissions={["platform.manage_users"]}
        canManagePermissions={true}
        onSave={vi.fn()}
      />,
    );

    const manageUsers = screen.getByRole("checkbox", {
      name: /toggle platform.manage_users/i,
    });
    const managePermissions = screen.getByRole("checkbox", {
      name: /toggle platform.manage_permissions/i,
    });

    expect(screen.getByRole("button", { name: /save permissions/i })).toBeDisabled();
    expect(screen.getByTestId("permission-matrix-save-bar").className).toContain("sticky");

    await user.click(screen.getByRole("button", { name: /clear platform/i }));
    expect(manageUsers).not.toBeChecked();
    expect(screen.getByText(/unsaved permission changes/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /select all platform/i }));
    expect(manageUsers).toBeChecked();
    expect(managePermissions).toBeChecked();

    await user.click(screen.getByRole("button", { name: /reset platform/i }));
    expect(manageUsers).toBeChecked();
    expect(managePermissions).not.toBeChecked();
  });

  it("sends the full replacement permission list on save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});

    render(
      <PermissionMatrix
        permissionGroups={permissionGroups}
        loadedPermissions={["accounting.invoices.view"]}
        canManagePermissions={true}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: /select all feature requests/i }));
    await user.click(screen.getByRole("button", { name: /save permissions/i }));

    expect(onSave).toHaveBeenCalledWith([
      "accounting.invoices.view",
      "feature_requests.manage",
    ]);
  });

  it("keeps controls visible but disabled when permission management is missing", () => {
    render(
      <PermissionMatrix
        permissionGroups={permissionGroups}
        loadedPermissions={[]}
        canManagePermissions={false}
        disabledPermissionMessage="Requires platform.manage_permissions"
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByTestId("permission-matrix-disabled")).toHaveTextContent(
      "Requires platform.manage_permissions",
    );
    expect(screen.getByRole("checkbox", { name: /toggle accounting.invoices.view/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /select all platform/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /select all platform/i })).toHaveAttribute("title", "Requires platform.manage_permissions");
  });

  it("renders read-only messaging for protected admin roles", () => {
    render(
      <PermissionMatrix
        permissionGroups={permissionGroups}
        loadedPermissions={["platform.manage_users"]}
        canManagePermissions={true}
        readOnlyMessage="Admin bypasses permission checks"
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByTestId("permission-matrix-readonly")).toHaveTextContent(
      "Admin bypasses permission checks",
    );
    expect(screen.getByRole("checkbox", { name: /toggle platform.manage_users/i })).toBeDisabled();
  });
});
