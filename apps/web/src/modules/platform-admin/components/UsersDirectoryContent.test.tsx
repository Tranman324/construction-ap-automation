import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UsersDirectoryContent } from "@/modules/platform-admin/components/UsersDirectoryContent";
import type { AdminUser } from "@/modules/platform-admin/types/admin";

const users: AdminUser[] = [
  {
    id: "user-1",
    azure_id: null,
    email: "ava@northwindcg.example",
    name: "Ava Stone",
    role_id: "role-admin",
    is_active: true,
    job_title: "Controller",
    phone: null,
    avatar_url: null,
    role_version: 6,
    last_login_at: "2026-05-13T10:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: null,
    role: { id: "role-admin", name: "Platform Admin", description: null, is_system: true },
  },
];

describe("UsersDirectoryContent", () => {
  it("renders mobile cards and forwards user selection", () => {
    const onSelectUser = vi.fn();

    render(
      <UsersDirectoryContent
        isLoading={false}
        isError={false}
        errorMessage=""
        filteredUsers={users}
        selectedUserId={null}
        hasFilters={false}
        onResetFilters={vi.fn()}
        onSelectUser={onSelectUser}
      />,
    );

    expect(screen.getByTestId("users-mobile-list")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("user-card-user-1"));

    expect(onSelectUser).toHaveBeenCalledWith("user-1");
  });
});