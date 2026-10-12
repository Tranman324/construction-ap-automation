import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Breadcrumbs } from "./Breadcrumbs";

const testState = vi.hoisted(() => ({
  navigation: {
    pathname: "/projects/alpha",
    push: vi.fn(),
    search: "",
  },
  user: {
    isAdmin: false,
    permissions: ["feature_requests.view", "projects.view"],
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => testState.navigation.pathname,
  useRouter: () => ({ push: testState.navigation.push }),
  useSearchParams: () => new URLSearchParams(testState.navigation.search),
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => ({ user: testState.user }),
}));

describe("Breadcrumbs", () => {
  beforeEach(() => {
    testState.navigation.pathname = "/projects/alpha";
    testState.navigation.search = "";
    testState.navigation.push.mockReset();
    testState.user = {
      isAdmin: false,
      permissions: ["feature_requests.view", "projects.view"],
    };
  });

  it("derives the current trail from the module registry and navigates from prior segments", async () => {
    const user = userEvent.setup();

    render(<Breadcrumbs />);

    const desktopTrail = screen.getByTestId("breadcrumbs-desktop");

    expect(within(desktopTrail).getByText("Toolbox")).toBeInTheDocument();
    expect(within(desktopTrail).getByRole("button", { name: "Projects" })).toBeInTheDocument();
    expect(within(desktopTrail).getByText("Active")).toHaveAttribute("aria-current", "page");

    await user.click(within(desktopTrail).getByRole("button", { name: "Projects" }));

    expect(testState.navigation.push).toHaveBeenCalledWith("/projects");
  });

  it("shows the compact first-and-current trail on mobile", () => {
    render(<Breadcrumbs />);

    const mobileTrail = screen.getByTestId("breadcrumbs-mobile");

    expect(within(mobileTrail).getByText("Toolbox")).toBeInTheDocument();
    expect(within(mobileTrail).getByText("Active")).toBeInTheDocument();
    expect(within(mobileTrail).queryByText("Projects")).not.toBeInTheDocument();
  });

  it("falls back to Toolbox when no module route matches", () => {
    testState.navigation.pathname = "/unknown-route";

    render(<Breadcrumbs />);

    const desktopTrail = screen.getByTestId("breadcrumbs-desktop");

    expect(within(desktopTrail).getByText("Toolbox")).toHaveAttribute("aria-current", "page");
    expect(within(desktopTrail).queryByRole("button")).not.toBeInTheDocument();
  });

  it("derives admin breadcrumbs from the section query parameter", () => {
    testState.navigation.pathname = "/admin";
    testState.navigation.search = "section=role-perms";
    testState.user = {
      isAdmin: true,
      permissions: ["platform.admin"],
    };

    render(<Breadcrumbs />);

    const desktopTrail = screen.getByTestId("breadcrumbs-desktop");

    expect(within(desktopTrail).getByText("Toolbox")).toBeInTheDocument();
    expect(within(desktopTrail).getByRole("button", { name: "Admin" })).toBeInTheDocument();
    expect(within(desktopTrail).getByText("Role Permissions")).toHaveAttribute("aria-current", "page");
  });

  it("assigns document detail breadcrumbs to Accounting AP Billing", () => {
    testState.navigation.pathname = "/accounting/documents/doc-1";
    testState.user = {
      isAdmin: false,
      permissions: ["accounting.invoices.view", "accounting.invoices.view_details"],
    };

    render(<Breadcrumbs />);

    const desktopTrail = screen.getByTestId("breadcrumbs-desktop");

    expect(within(desktopTrail).getByRole("button", { name: "Accounting" })).toBeInTheDocument();
    expect(within(desktopTrail).getByText("AP Billing")).toHaveAttribute("aria-current", "page");
    expect(within(desktopTrail).queryByText("Documents")).not.toBeInTheDocument();
  });
});
