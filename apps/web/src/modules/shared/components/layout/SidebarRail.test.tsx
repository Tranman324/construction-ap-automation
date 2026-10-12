import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/modules/shared/components/ui/tooltip";
import { getVisibleModules } from "@/modules/shared/lib/moduleRegistry";
import { SidebarRail } from "@/modules/shared/components/layout/SidebarRail";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

function renderRail(overrides: Partial<React.ComponentProps<typeof SidebarRail>> = {}) {
  const modules = overrides.modules ?? getVisibleModules({ isAdmin: false, permissions: ["accounting.invoices.view", "projects.view"] });

  return render(
    <TooltipProvider>
      <SidebarRail
        modules={modules}
        pathname="/accounting/invoices/queue"
        user={{
          name: "Dana Brown",
          email: "dana@northwindcg.example",
          position: "Finance Manager",
          image: null,
        }}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

describe("SidebarRail", () => {
  it("highlights the active module from the current pathname", () => {
    renderRail({ pathname: "/accounting/invoices/queue" });

    expect(screen.getByRole("link", { name: /accounting/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /projects/i })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link", { name: /^documents$/i })).not.toBeInTheDocument();
  });

  it("keeps future modules visible with a coming soon tooltip and no navigation", async () => {
    renderRail();

    const leadsButton = screen.getByRole("button", { name: /leads/i });

    expect(screen.queryByRole("link", { name: /leads/i })).not.toBeInTheDocument();

    fireEvent.focus(leadsButton);

    await waitFor(() => expect(leadsButton).toHaveAttribute("aria-describedby"));

    const tooltipId = leadsButton.getAttribute("aria-describedby");
    const tooltip = tooltipId ? document.getElementById(tooltipId) : null;

    expect(tooltip).not.toBeNull();
    expect(tooltip).toHaveTextContent(/leads/i);
    expect(tooltip).toHaveTextContent(/coming soon/i);
  });

  it("bubbles child attention state onto the module rail item", () => {
    renderRail({ modules: getVisibleModules({ isAdmin: false, permissions: ["accounting.invoices.view"] }) });

    const accountingLink = screen.getByRole("link", { name: /accounting/i });

    expect(within(accountingLink).getByLabelText(/accounting needs attention/i)).toBeInTheDocument();
  });

  it("renders only the rail skeleton while auth is loading", () => {
    const { container } = renderRail({ isLoading: true });

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(8);
    expect(screen.queryByRole("navigation", { name: /primary navigation rail/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /accounting/i })).not.toBeInTheDocument();
  });

  it("opens the user settings menu from the rail avatar and signs out", async () => {
    const user = userEvent.setup();
    const handleSignOut = vi.fn();

    renderRail({ onSignOut: handleSignOut });

    await user.click(screen.getByRole("button", { name: /open user settings menu/i }));

    expect(screen.getByText("Dana Brown")).toBeInTheDocument();
    expect(screen.getByText("Finance Manager")).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));

    expect(handleSignOut).toHaveBeenCalledTimes(1);
  });
});
