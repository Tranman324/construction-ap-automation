import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  UserDetailEmptyState,
  UserDetailSummary,
} from "@/modules/platform-admin/components/UserDetailPanelSummary";
import type { AdminUser } from "@/modules/platform-admin/types/admin";

const user: AdminUser = {
  id: "user-2",
  azure_id: null,
  email: "user.two@northwindcg.example",
  name: "User Two",
  role_id: "role-user",
  is_active: true,
  job_title: "Project Engineer",
  phone: null,
  avatar_url: null,
  role_version: 4,
  last_login_at: "2026-05-12T10:00:00.000Z",
  created_at: "2026-01-01T10:00:00.000Z",
  updated_at: null,
  role: { id: "role-user", name: "User", description: null, is_system: false },
};

describe("UserDetailPanelSummary", () => {
  it("renders the empty state prompt", () => {
    render(<UserDetailEmptyState />);

    expect(screen.getByText("Select a user")).toBeInTheDocument();
  });

  it("renders the identity summary with role version", () => {
    render(<UserDetailSummary user={user} isActive />);

    expect(screen.getByText("User Two")).toBeInTheDocument();
    expect(screen.getByText("Role v4")).toBeInTheDocument();
  });

  it("falls back to the Azure photo proxy when avatar_url is empty", () => {
    render(<UserDetailSummary user={{ ...user, azure_id: "azure-user-2" }} isActive />);

    expect(screen.getByRole("img", { name: "User Two" })).toHaveAttribute(
      "src",
      "/api/backend/users/azure-user-2/photo?size=648x648",
    );
  });

  it("renders the selected user avatar 50 percent larger than the previous 48px size", () => {
    render(<UserDetailSummary user={{ ...user, azure_id: "azure-user-2" }} isActive />);

    expect(screen.getByRole("img", { name: "User Two" })).toHaveClass("h-[72px]", "w-[72px]");
  });
});
