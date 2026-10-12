import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

const testState = vi.hoisted(() => ({
  navigation: {
    push: vi.fn(),
  },
  user: {
    isAdmin: false,
    permissions: ["feature_requests.view", "projects.view", "accounting.invoices.view"],
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: testState.navigation.push }),
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => ({ user: testState.user }),
}));

vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

describe("CommandPalette", () => {
  beforeEach(() => {
    testState.navigation.push.mockReset();
    testState.user = {
      isAdmin: false,
      permissions: ["feature_requests.view", "projects.view", "accounting.invoices.view"],
    };
  });

  it("opens from the trigger and closes on Escape", async () => {
    const user = userEvent.setup();

    render(<CommandPalette />);

    await user.click(screen.getByRole("button", { name: /open command palette/i }));
    expect(screen.getByPlaceholderText(/search pages/i)).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/search pages/i)).not.toBeInTheDocument();
    });
  });

  it("opens from the Ctrl/Cmd+K shortcut", async () => {
    render(<CommandPalette />);

    fireEvent.keyDown(window, { ctrlKey: true, key: "k" });

    expect(await screen.findByPlaceholderText(/search pages/i)).toBeInTheDocument();
  });

  it("renders dialog title and description inside the dialog content", async () => {
    const user = userEvent.setup();

    render(<CommandPalette />);
    await user.click(screen.getByRole("button", { name: /open command palette/i }));

    const dialog = screen.getByRole("dialog", { name: /search pages/i });

    expect(within(dialog).getByText("Search pages")).toBeInTheDocument();
    expect(within(dialog).getByText("Search the Toolbox module registry")).toBeInTheDocument();
  });

  it("filters modules by permission and keeps placeholder items disabled", async () => {
    const user = userEvent.setup();
    testState.user = {
      isAdmin: false,
      permissions: ["projects.view"],
    };

    render(<CommandPalette />);
    await user.click(screen.getByRole("button", { name: /open command palette/i }));

    expect(screen.getByTestId("command-item-projects-active")).toBeInTheDocument();
    expect(screen.queryByTestId("command-item-accounting-ap-billing")).not.toBeInTheDocument();

    const archivedItem = screen.getByTestId("command-item-projects-archived");
    expect(within(archivedItem).getByText(/coming soon/i)).toBeInTheDocument();

    await user.click(archivedItem);
    expect(testState.navigation.push).not.toHaveBeenCalled();
  });

  it("filters the visible results as the query changes", async () => {
    const user = userEvent.setup();

    render(<CommandPalette />);
    await user.click(screen.getByRole("button", { name: /open command palette/i }));
    await user.type(screen.getByPlaceholderText(/search pages/i), "pending");

    expect(screen.getByTestId("command-item-projects-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("command-item-accounting-ap-billing")).not.toBeInTheDocument();
  });

  it("navigates from live command items and closes the palette", async () => {
    const user = userEvent.setup();

    render(<CommandPalette />);
    await user.click(screen.getByRole("button", { name: /open command palette/i }));
    await user.click(screen.getByTestId("command-item-projects-pending"));

    expect(testState.navigation.push).toHaveBeenCalledWith("/projects/pending");

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/search pages/i)).not.toBeInTheDocument();
    });
  });
});