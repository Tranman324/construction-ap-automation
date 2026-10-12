import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UserOverrideModuleCard } from "@/modules/platform-admin/components/UserOverrideModuleCard";

describe("UserOverrideModuleCard", () => {
  it("shows high-risk treatment, inherited/effective badges, and tri-state controls", () => {
    const onModeChange = vi.fn();

    render(
      <UserOverrideModuleCard
        moduleId="platform"
        permissions={[
          { key: "platform.manage_users", description: "Manage platform users." },
          { key: "accounting.invoices.view", description: "View invoices." },
        ]}
        inheritedPermissions={new Set(["accounting.invoices.view"])}
        overrideModeMap={{ "platform.manage_users": "grant" }}
        controlsDisabled={false}
        onModeChange={onModeChange}
      />,
    );

    expect(screen.getByTestId("override-row-platform.manage_users")).toHaveTextContent("High risk");
    expect(screen.getByTestId("override-row-accounting.invoices.view")).toHaveTextContent("Inherited grant");
    expect(screen.getByTestId("override-row-accounting.invoices.view")).toHaveTextContent("Effective grant");

    fireEvent.click(screen.getByRole("radio", { name: /set accounting\.invoices\.view to revoke/i }));

    expect(onModeChange).toHaveBeenCalledWith("accounting.invoices.view", "revoke");
  });

  it("keeps the tri-state controls visible but disabled when editing is blocked", () => {
    render(
      <UserOverrideModuleCard
        moduleId="platform"
        permissions={[{ key: "platform.manage_users", description: "Manage platform users." }]}
        inheritedPermissions={new Set()}
        overrideModeMap={{}}
        controlsDisabled={true}
        onModeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /set platform\.manage_users to grant/i })).toBeDisabled();
  });
});
