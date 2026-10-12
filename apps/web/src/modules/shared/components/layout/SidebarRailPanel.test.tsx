import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/modules/shared/components/ui/tooltip";
import { SidebarProvider } from "@/modules/shared/lib/SidebarContext";
import { SidebarRailPanel } from "./SidebarRailPanel";

const testState = vi.hoisted(() => ({
  auth: {
    isLoading: false,
    signOut: vi.fn(),
    user: {
      email: "dana@northwindcg.example",
      image: null,
      isAdmin: false,
      name: "Dana Brown",
      permissions: ["accounting.invoices.view", "projects.view"],
      position: "Finance Manager",
      role: "manager",
    },
  },
  navigation: {
    pathname: "/accounting/invoices/queue",
    search: "",
    push: vi.fn(),
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

vi.mock("@/modules/shared/components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme Toggle</button>,
}));

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

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function getSidebarRailPanelTree() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <SidebarRailPanel />
      </SidebarProvider>
    </TooltipProvider>
  );
}

function renderSidebarRailPanel() {
  return render(getSidebarRailPanelTree());
}

describe("SidebarRailPanel", () => {
  beforeEach(() => {
    testState.auth.isLoading = false;
    testState.auth.signOut.mockReset();
    testState.auth.user = {
      email: "dana@northwindcg.example",
      image: null,
      isAdmin: false,
      name: "Dana Brown",
      permissions: ["accounting.invoices.view", "projects.view"],
      position: "Finance Manager",
      role: "manager",
    };
    testState.navigation.pathname = "/accounting/invoices/queue";
    testState.navigation.search = "";
    testState.navigation.push.mockReset();
    setViewportWidth(1280);
    window.localStorage.clear();
  });

  it("uses only the approved persistence keys while restoring and saving integrated preferences", async () => {
    const user = userEvent.setup();
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    window.localStorage.setItem("tbx-panel-pinned", "true");
    renderSidebarRailPanel();

    fireEvent.contextMenu(screen.getByRole("button", { name: /ap billing/i }));
    await user.click(screen.getByRole("button", { name: /pinned/i }));

    expect(getItemSpy.mock.calls.every(([key]) => ["tbx-panel-pinned", "tbx-module-defaults"].includes(key))).toBe(true);
    expect(setItemSpy.mock.calls.every(([key]) => ["tbx-panel-pinned", "tbx-module-defaults"].includes(key))).toBe(true);

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it("restores the saved pinned state after the auth skeleton resolves", async () => {
    window.localStorage.setItem("tbx-panel-pinned", "true");
    testState.auth.isLoading = true;

    const view = renderSidebarRailPanel();

    expect(screen.queryByRole("navigation", { name: /primary navigation rail/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /accounting/i })).not.toBeInTheDocument();

    testState.auth.isLoading = false;
    view.rerender(getSidebarRailPanelTree());

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: /primary navigation rail/i })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /accounting/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /pinned/i })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("toggles the active module without navigation and preserves panel openness when routing to a different module", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tbx-panel-pinned", "true");
    const view = renderSidebarRailPanel();

    await user.click(screen.getByRole("button", { name: "Accounting" }));
    expect(testState.navigation.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /accounting/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Accounting" }));
    expect(screen.getByRole("heading", { name: /accounting/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Projects" }));
    expect(testState.navigation.push).toHaveBeenCalledWith("/projects");

    testState.navigation.pathname = "/projects";
    view.rerender(getSidebarRailPanelTree());

    expect(screen.getByRole("heading", { name: /projects/i })).toBeInTheDocument();
  });

  it("toggles the active panel when the Toolbox rail mark is clicked", async () => {
    const user = userEvent.setup();

    renderSidebarRailPanel();

    expect(screen.queryByRole("heading", { name: /accounting/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /expand toolbox panel/i }));

    expect(screen.getByRole("heading", { name: /accounting/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /collapse toolbox panel/i }));

    expect(screen.queryByRole("heading", { name: /accounting/i })).not.toBeInTheDocument();
  });

  it("collapses an unpinned panel after an outside click", async () => {
    const user = userEvent.setup();

    renderSidebarRailPanel();
    await user.click(screen.getByRole("button", { name: "Accounting" }));

    expect(screen.getByRole("heading", { name: /accounting/i })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /accounting/i })).not.toBeInTheDocument();
    });
  });

  it("closes the panel after unpinned sub-item navigation", async () => {
    const user = userEvent.setup();

    renderSidebarRailPanel();
    await user.click(screen.getByRole("button", { name: "Accounting" }));

    expect(screen.getByRole("heading", { name: /accounting/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /ap billing/i }));

    expect(testState.navigation.push).toHaveBeenCalledWith("/accounting/invoices");
    expect(screen.queryByRole("heading", { name: /accounting/i })).not.toBeInTheDocument();
  });

  it("keeps the panel open after pinned sub-item navigation", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tbx-panel-pinned", "true");
    renderSidebarRailPanel();

    await user.click(screen.getByRole("button", { name: /ap billing/i }));

    expect(testState.navigation.push).toHaveBeenCalledWith("/accounting/invoices");
    expect(screen.getByRole("heading", { name: /accounting/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pinned/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("persists right-click default choices in integrated context and filters hidden modules", async () => {
    testState.auth.user.permissions = ["projects.view"];
    testState.navigation.pathname = "/projects/alpha";
    window.localStorage.setItem("tbx-panel-pinned", "true");
    renderSidebarRailPanel();

    expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accounting" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leads" })).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole("button", { name: /pending intake/i }));

    expect(window.localStorage.getItem("tbx-module-defaults")).toBe(JSON.stringify({ projects: "pending" }));
    expect(screen.getByLabelText(/default on open/i)).toBeInTheDocument();
  });

  it("collapses a pinned panel from the Toolbox rail mark while keeping the rail available", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tbx-panel-pinned", "true");
    renderSidebarRailPanel();

    expect(screen.getByRole("navigation", { name: /primary navigation rail/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /accounting/i })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /close panel/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /collapse toolbox panel/i }));

    expect(screen.getByRole("navigation", { name: /primary navigation rail/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /accounting/i })).not.toBeInTheDocument();
  });

  it("keeps the rail visible on mobile while overlaying the panel separately", async () => {
    const user = userEvent.setup();

    setViewportWidth(900);

    renderSidebarRailPanel();

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: /primary navigation rail/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole("heading", { name: /accounting/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close sidebar overlay" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Accounting" }));

    expect(screen.getByRole("navigation", { name: /primary navigation rail/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /accounting/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close sidebar overlay" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close sidebar overlay" }));

    expect(screen.getByRole("navigation", { name: /primary navigation rail/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /accounting/i })).not.toBeInTheDocument();
  });

  it("dismisses the mobile drawer after an outside pointer interaction", async () => {
    const user = userEvent.setup();

    setViewportWidth(900);
    renderSidebarRailPanel();

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: /primary navigation rail/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Accounting" }));

    expect(screen.getByRole("heading", { name: /accounting/i })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /accounting/i })).not.toBeInTheDocument();
    });
  });

  it("opens the user settings menu from the rail avatar and signs out", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tbx-panel-pinned", "true");
    renderSidebarRailPanel();

    expect(screen.queryByRole("button", { name: /theme toggle/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open profile menu/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open user settings menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));

    expect(testState.auth.signOut).toHaveBeenCalledTimes(1);
  });
});