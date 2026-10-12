import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppLayout from "./AppLayout";

const testState = vi.hoisted(() => ({
  user: {
    email: "dana@northwindcg.example",
    name: "Dana Brown",
  } as { email?: string; name?: string } | null,
}));

const setDefaultHeaderMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/shared/components/layout/PlatformMeshBackground", () => ({
  PlatformMeshBackground: () => <div data-testid="platform-mesh-background" />,
}));

vi.mock("@/modules/shared/components/layout/SidebarRailPanel", () => ({
  SidebarRailPanel: () => <div data-testid="sidebar-rail-panel" />,
}));

vi.mock("@/modules/shared/components/layout/UtilityBar", () => ({
  UtilityBar: () => <div data-testid="utility-bar" />,
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => ({ user: testState.user }),
}));

vi.mock("@/modules/shared/lib/api", () => ({
  setDefaultHeader: setDefaultHeaderMock,
}));

describe("AppLayout", () => {
  beforeEach(() => {
    testState.user = {
      email: "dana@northwindcg.example",
      name: "Dana Brown",
    };
    setDefaultHeaderMock.mockReset();
  });

  it("renders the semantic platform shell with the shared background behind dashboard content", () => {
    const { container } = render(
      <AppLayout>
        <div data-testid="dashboard-child">Dashboard content</div>
      </AppLayout>,
    );

    expect(screen.getByTestId("platform-mesh-background")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-rail-panel")).toBeInTheDocument();
    expect(screen.getByTestId("utility-bar")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-child")).toBeInTheDocument();

    expect(container.querySelector(".tbx-platform-shell")).toBeInTheDocument();
    expect(container.querySelector(".tbx-platform-header-underlay")).toBeInTheDocument();
    expect(container.querySelector(".tbx-platform-main")).toBeInTheDocument();
    expect(container.querySelector(".tbx-platform-content")).toBeInTheDocument();
  });

  it("preserves scoped auth headers for dashboard requests", () => {
    render(
      <AppLayout>
        <div>Dashboard content</div>
      </AppLayout>,
    );

    expect(setDefaultHeaderMock).toHaveBeenCalledWith("x-user-id", "dana@northwindcg.example");
    expect(setDefaultHeaderMock).toHaveBeenCalledWith("x-user-name", "Dana Brown");
  });
});