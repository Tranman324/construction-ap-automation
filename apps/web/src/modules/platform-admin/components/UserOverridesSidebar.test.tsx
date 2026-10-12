import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UserOverridesSidebar } from "@/modules/platform-admin/components/UserOverridesSidebar";
import type { AdminUser } from "@/modules/platform-admin/types/admin";

const users: AdminUser[] = [
  {
    id: "user-1",
    azure_id: null,
    email: "taylor@northwindcg.example",
    name: "Taylor One",
    role_id: "role-1",
    is_active: true,
    job_title: "Project Engineer",
    phone: null,
    avatar_url: null,
    role_version: 3,
    last_login_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: null,
    role: { id: "role-1", name: "Engineer", description: null, is_system: false },
  },
  {
    id: "user-2",
    azure_id: null,
    email: "paula@northwindcg.example",
    name: "Paula Two",
    role_id: "role-2",
    is_active: false,
    job_title: "Project Manager",
    phone: null,
    avatar_url: null,
    role_version: 5,
    last_login_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: null,
    role: { id: "role-2", name: "Manager", description: null, is_system: false },
  },
];

function SidebarHarness({ onSelectUser }: { onSelectUser: (userId: string) => void }) {
  const [search, setSearch] = useState("");

  return (
    <UserOverridesSidebar
      users={users}
      selectedUserId="user-1"
      search={search}
      missingRequestedUserId="missing-user"
      onSearchChange={setSearch}
      onSelectUser={onSelectUser}
    />
  );
}

describe("UserOverridesSidebar", () => {
  it("filters the user list and keeps the missing-user warning visible", () => {
    render(<SidebarHarness onSelectUser={vi.fn()} />);

    expect(screen.getByTestId("user-overrides-missing-user")).toHaveTextContent("missing-user");

    fireEvent.change(screen.getByRole("textbox", { name: /search override users/i }), {
      target: { value: "paula" },
    });

    expect(screen.queryByTestId("override-user-option-user-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("override-user-option-user-2")).toBeInTheDocument();
  });

  it("calls onSelectUser when a user is chosen", () => {
    const onSelectUser = vi.fn();

    render(<SidebarHarness onSelectUser={onSelectUser} />);

    fireEvent.click(screen.getByTestId("override-user-option-user-2"));

    expect(onSelectUser).toHaveBeenCalledWith("user-2");
  });
});