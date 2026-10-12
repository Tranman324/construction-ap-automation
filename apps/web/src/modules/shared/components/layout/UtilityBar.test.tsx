import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider, useSidebar } from "@/modules/shared/lib/SidebarContext";
import { UtilityBar } from "./UtilityBar";

const testState = vi.hoisted(() => ({
  navigation: {
    pathname: "/projects/alpha",
    search: "",
    push: vi.fn(),
  },
  theme: {
    setTheme: vi.fn(),
    theme: "light",
  },
  user: {
    isAdmin: false,
    permissions: ["feature_requests.view", "projects.view"],
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => testState.navigation.pathname,
  useSearchParams: () => new URLSearchParams(testState.navigation.search),
  useRouter: () => ({ push: testState.navigation.push }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({
    setTheme: testState.theme.setTheme,
    theme: testState.theme.theme,
  }),
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => ({ user: testState.user }),
}));

function SidebarStateProbe() {
  const { isSidebarOpen } = useSidebar();

  return <span data-testid="sidebar-state">{isSidebarOpen ? "open" : "closed"}</span>;
}

function renderUtilityBar(notificationBadgeCount?: number) {
  return render(
    <SidebarProvider>
      <UtilityBar notificationBadgeCount={notificationBadgeCount} />
      <SidebarStateProbe />
    </SidebarProvider>,
  );
}

describe("UtilityBar", () => {
  beforeEach(() => {
    testState.navigation.pathname = "/projects/alpha";
    testState.navigation.search = "";
    testState.navigation.push.mockReset();
    testState.theme.setTheme.mockReset();
    testState.theme.theme = "light";
    testState.user = {
      isAdmin: false,
      permissions: ["feature_requests.view", "projects.view"],
    };
  });

  it("renders breadcrumb navigation, search, theme, and the default notification indicator", async () => {
    const user = userEvent.setup();

    renderUtilityBar();

    const desktopTrail = screen.getByTestId("breadcrumbs-desktop");

    expect(within(desktopTrail).getByText("Toolbox")).toBeInTheDocument();
    expect(within(desktopTrail).getByRole("button", { name: "Projects" })).toBeInTheDocument();
    expect(within(desktopTrail).getByText("Active")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /open command palette/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeInTheDocument();
    expect(screen.getByTestId("utility-bar-notification-dot")).toBeInTheDocument();

    await user.click(within(desktopTrail).getByRole("button", { name: "Projects" }));

    expect(testState.navigation.push).toHaveBeenCalledWith("/projects");
  });

  it("falls back to Toolbox on unknown routes and swaps to a red badge when a count is provided", () => {
    testState.navigation.pathname = "/unknown-route";

    renderUtilityBar(3);

    const desktopTrail = screen.getByTestId("breadcrumbs-desktop");

    expect(within(desktopTrail).getByText("Toolbox")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("utility-bar-notification-badge")).toHaveTextContent("3");
    expect(screen.queryByTestId("utility-bar-notification-dot")).not.toBeInTheDocument();
  });

  it("toggles the sidebar from the mobile hamburger control", async () => {
    const user = userEvent.setup();

    renderUtilityBar();

    expect(screen.getByTestId("sidebar-state")).toHaveTextContent("closed");

    await user.click(screen.getByRole("button", { name: /open navigation panel/i }));

    expect(screen.getByTestId("sidebar-state")).toHaveTextContent("open");
  });
});