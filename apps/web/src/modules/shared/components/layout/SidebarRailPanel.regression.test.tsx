import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/modules/shared/lib/SidebarContext";
import type { ResolvedModuleRegistryModule } from "@/modules/shared/lib/moduleRegistry";
import { SidebarRailPanel } from "./SidebarRailPanel";

interface MockPanelProps {
  module: ResolvedModuleRegistryModule;
  activeSubmoduleId?: string;
}

interface MockUser {
  email: string;
  image: string | null;
  isAdmin: boolean;
  name: string;
  permissions: string[];
  position: string;
  role: string;
}

function makeUser(
  permissions: string[] = ["accounting.invoices.view", "projects.view", "accounting.invoices.view_details", "feature_requests.view"],
  isAdmin = false,
): MockUser {
  return {
    email: "dana@northwindcg.example",
    image: null,
    isAdmin,
    name: "Dana Brown",
    permissions,
    position: "Finance Manager",
    role: isAdmin ? "admin" : "manager",
  };
}

const testState = vi.hoisted(() => ({
  auth: {
    isLoading: false,
    signOut: vi.fn(),
    user: makeUser(),
  },
  navigation: {
    pathname: "/accounting/invoices/queue",
    search: "",
    push: vi.fn(),
  },
  panel: {
    props: null as MockPanelProps | null,
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => testState.navigation.pathname,
  useSearchParams: () => new URLSearchParams(testState.navigation.search),
  useRouter: () => ({ push: testState.navigation.push }),
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => testState.auth,
}));

vi.mock("@/modules/shared/components/layout/SidebarRail", () => ({
  SidebarRail: ({ isLoading, modules, onModuleSelect }: { isLoading?: boolean; modules: readonly ResolvedModuleRegistryModule[]; onModuleSelect?: (moduleId: string) => void }) => {
    if (isLoading) {
      return <div data-testid="rail-loading">Loading rail</div>;
    }

    return (
      <div data-testid="rail">
        {modules.map((module) => (
          <button
            key={module.id}
            type="button"
            data-visibility={module.visibility}
            onClick={() => onModuleSelect?.(module.id)}
          >
            {module.label}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock("@/modules/shared/components/layout/SidebarPanel", () => ({
  SidebarPanel: (props: MockPanelProps) => {
    testState.panel.props = props;

    return (
      <div
        data-testid="panel"
        data-active-submodule-id={props.activeSubmoduleId ?? ""}
        data-module-id={props.module.id}
      >
        {props.module.label}
      </div>
    );
  },
}));

function renderSidebarRailPanel() {
  return render(
    <SidebarProvider>
      <SidebarRailPanel />
    </SidebarProvider>,
  );
}

describe("SidebarRailPanel route and permission regressions", () => {
  beforeEach(() => {
    testState.auth.isLoading = false;
    testState.auth.signOut.mockReset();
    testState.auth.user = makeUser();
    testState.navigation.pathname = "/accounting/invoices/queue";
    testState.navigation.search = "";
    testState.navigation.push.mockReset();
    testState.panel.props = null;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1280,
    });
    window.localStorage.clear();
  });

  it("hides Admin for non-admin users and keeps future modules visible-disabled", async () => {
    const user = userEvent.setup();

    renderSidebarRailPanel();

    expect(screen.queryByRole("button", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leads" })).toHaveAttribute("data-visibility", "disabled-future");
    expect(screen.getByRole("button", { name: "Estimates" })).toHaveAttribute("data-visibility", "disabled-future");
    expect(screen.getByRole("button", { name: "Closeouts" })).toHaveAttribute("data-visibility", "disabled-future");

    await user.click(screen.getByRole("button", { name: "Leads" }));

    expect(testState.navigation.push).not.toHaveBeenCalled();
  });

  it("renders the rail-only skeleton while auth is loading with no unauthorized flash", () => {
    window.localStorage.setItem("tbx-panel-pinned", "true");
    testState.auth.isLoading = true;

    renderSidebarRailPanel();

    expect(screen.getByTestId("rail-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accounting" })).not.toBeInTheDocument();
  });

  it("keeps /invoices gated behind invoice permissions", () => {
    window.localStorage.setItem("tbx-panel-pinned", "true");
    testState.auth.user = makeUser(["projects.view"]);
    testState.navigation.pathname = "/accounting/invoices/queue";

    renderSidebarRailPanel();

    expect(screen.queryByRole("button", { name: "Accounting" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
  });

  it.each([
    ["/accounting/invoices/queue", "accounting", "ap-billing"],
    ["/projects/alpha", "projects", "active"],
    ["/accounting/documents/123", "accounting", "ap-billing"],
    ["/feature-requests/board", "dashboard", "feedback"],
  ] as const)("maps %s to the expected active module and submodule", (pathname, moduleId, submoduleId) => {
    window.localStorage.setItem("tbx-panel-pinned", "true");
    testState.auth.user = makeUser([
      "accounting.invoices.view",
      "projects.view",
      "accounting.invoices.view_details",
      "feature_requests.view",
      "platform.admin",
    ]);
    testState.navigation.pathname = pathname;

    renderSidebarRailPanel();

    expect(screen.getByTestId("panel")).toHaveAttribute("data-module-id", moduleId);
    expect(screen.getByTestId("panel")).toHaveAttribute("data-active-submodule-id", submoduleId);
  });

  it("syncs the admin active submodule from the section query param", () => {
    window.localStorage.setItem("tbx-panel-pinned", "true");
    testState.auth.user = makeUser(
      [
        "accounting.invoices.view",
        "projects.view",
        "accounting.invoices.view_details",
        "feature_requests.view",
        "platform.admin",
      ],
      true,
    );
    testState.navigation.pathname = "/admin";
    testState.navigation.search = "section=rules";

    renderSidebarRailPanel();

    expect(screen.getByTestId("panel")).toHaveAttribute("data-module-id", "admin");
    expect(screen.getByTestId("panel")).toHaveAttribute("data-active-submodule-id", "rules");
  });

  it("keeps non-admin active matching path-based even when a section query is present", () => {
    window.localStorage.setItem("tbx-panel-pinned", "true");
    testState.navigation.pathname = "/projects/alpha";
    testState.navigation.search = "section=users";

    renderSidebarRailPanel();

    expect(screen.getByTestId("panel")).toHaveAttribute("data-module-id", "projects");
    expect(screen.getByTestId("panel")).toHaveAttribute("data-active-submodule-id", "active");
  });
});
