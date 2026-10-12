import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText, FolderOpen } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedModuleRegistryModule } from "@/modules/shared/lib/moduleRegistry";
import { SidebarPanel } from "./SidebarPanel";
import type { SidebarPanelUser } from "./sidebarPanel.types";

const testUser: SidebarPanelUser = {
  name: "Maria Chen",
  email: "maria@northwindcg.example",
  position: "Project Manager",
};

const testModule: ResolvedModuleRegistryModule = {
  id: "accounting",
  label: "Accounting",
  icon: FileText,
  availability: "live",
  defaultSubmodule: "billing",
  permission: "accounting.invoices.view",
  visibility: "live",
  children: [
    {
      id: "billing",
      label: "AP Billing",
      icon: FileText,
      availability: "live",
      routePrefixes: ["/accounting/invoices"],
      href: "/accounting/invoices",
      attention: true,
      visibility: "live",
    },
    {
      id: "archive",
      label: "Archive",
      icon: FolderOpen,
      availability: "future",
      routePrefixes: [],
      attention: false,
      visibility: "disabled-future",
    },
  ],
};

describe("SidebarPanel", () => {
  it("renders profile details, pin state, attention markers, and action callbacks", async () => {
    const user = userEvent.setup();
    const handleNavigate = vi.fn();
    const handleSetDefault = vi.fn();
    const handleTogglePinned = vi.fn();

    render(
      <SidebarPanel
        module={testModule}
        activeSubmoduleId="billing"
        currentDefaultSubmoduleId="billing"
        isPinned={true}
        user={testUser}
        onTogglePinned={handleTogglePinned}
        onNavigateSubmodule={handleNavigate}
        onSetDefaultSubmodule={handleSetDefault}
      />,
    );

    expect(screen.getByText("Maria Chen")).toBeInTheDocument();
    expect(screen.getByText("Project Manager")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /theme toggle/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close panel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open user settings menu/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pinned/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/default on open/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ap billing needs attention/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /pinned/i }));
    expect(handleTogglePinned).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /ap billing/i }));
    expect(handleNavigate).toHaveBeenCalledWith("accounting", "billing", "/accounting/invoices");

    const archiveButton = screen.getByRole("button", { name: /archive/i });
    expect(archiveButton).toBeDisabled();
    await user.click(archiveButton);
    expect(handleNavigate).toHaveBeenCalledTimes(1);

    expect(screen.queryByRole("menuitem", { name: /sign out/i })).not.toBeInTheDocument();
  });
});