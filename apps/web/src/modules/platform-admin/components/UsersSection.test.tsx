import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface QueryState<TData> {
  data: TData | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

const TM = vi.hoisted(() => ({
  desktopMatches: true,
  users: {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
  } as QueryState<
    Array<{
      id: string;
      email: string;
      name: string;
      role_id: string;
      is_active: boolean;
      job_title: string | null;
      role_version: number;
      last_login_at: string | null;
      role: { id: string; name: string; description: null; is_system: boolean };
    }>
  >,
  roles: {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
  } as QueryState<
    Array<{
      id: string;
      name: string;
      description: null;
      is_system: boolean;
      user_count: number;
    }>
  >,
}));

vi.mock("@/modules/platform-admin/hooks/queries", () => ({
  useAdminUsers: () => TM.users,
  useAdminRoles: () => TM.roles,
}));

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(min-width: 1024px)" ? TM.desktopMatches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

vi.mock("@/modules/platform-admin/components/UserDetailPanel", () => ({
  UserDetailPanel: ({ user }: { user: { name: string } | null }) => (
    <div data-testid="detail-panel-stub">{user ? user.name : "No selection"}</div>
  ),
}));

import { UsersSection } from "@/modules/platform-admin/components/UsersSection";

describe("UsersSection", () => {
  beforeEach(() => {
    TM.desktopMatches = true;
    TM.users = {
      data: [
        {
          id: "user-1",
          email: "ava@northwindcg.example",
          name: "Ava Stone",
          role_id: "role-admin",
          is_active: true,
          job_title: "Controller",
          role_version: 6,
          last_login_at: "2026-05-13T10:00:00.000Z",
          role: { id: "role-admin", name: "Platform Admin", description: null, is_system: true },
        },
        {
          id: "user-2",
          email: "bruno@northwindcg.example",
          name: "Bruno Vale",
          role_id: "role-user",
          is_active: false,
          job_title: "Estimator",
          role_version: 2,
          last_login_at: null,
          role: { id: "role-user", name: "User", description: null, is_system: false },
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
    };
    TM.roles = {
      data: [
        { id: "role-admin", name: "Platform Admin", description: null, is_system: true, user_count: 1 },
        { id: "role-user", name: "User", description: null, is_system: false, user_count: 1 },
      ],
      isLoading: false,
      isError: false,
      error: null,
    };
  });

  it("renders the user table and updates the detail panel on row selection", () => {
    render(<UsersSection />);

    const table = screen.getByTestId("users-table");

    expect(within(table).getByText("Ava Stone")).toBeInTheDocument();
    expect(within(table).getByText("Bruno Vale")).toBeInTheDocument();
    expect(screen.getByTestId("detail-panel-stub")).toHaveTextContent("No selection");

    fireEvent.click(within(table).getByTestId("user-row-user-2"));

    expect(screen.getByTestId("detail-panel-stub")).toHaveTextContent("Bruno Vale");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the detail panel in a sheet below the desktop breakpoint", () => {
    TM.desktopMatches = false;

    render(<UsersSection />);

    fireEvent.click(screen.getByTestId("user-row-user-2"));

    expect(screen.getByRole("dialog")).toHaveTextContent("Bruno Vale");
  });

  it("filters the table by search across job title and email", () => {
    render(<UsersSection />);

    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "estimator" } });

    const table = screen.getByTestId("users-table");

    expect(within(table).getByText("Bruno Vale")).toBeInTheDocument();
    expect(within(table).queryByText("Ava Stone")).not.toBeInTheDocument();
  });

  it("filters the table by role", () => {
    render(<UsersSection />);

    fireEvent.change(screen.getByLabelText("Role filter"), { target: { value: "role-admin" } });

    const table = screen.getByTestId("users-table");

    expect(within(table).getByText("Ava Stone")).toBeInTheDocument();
    expect(within(table).queryByText("Bruno Vale")).not.toBeInTheDocument();
  });

  it("filters the table by active status", () => {
    render(<UsersSection />);

    fireEvent.change(screen.getByLabelText("Active status filter"), { target: { value: "inactive" } });

    const table = screen.getByTestId("users-table");

    expect(within(table).getByText("Bruno Vale")).toBeInTheDocument();
    expect(within(table).queryByText("Ava Stone")).not.toBeInTheDocument();
  });
});