import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  search: "",
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(testState.search),
}));

vi.mock("@/modules/platform-admin/components/AdminOverview", () => ({
  AdminOverview: () => <section data-testid="admin-section-overview">Overview stub</section>,
}));

vi.mock("@/modules/platform-admin/components/UsersSection", () => ({
  UsersSection: () => <section data-testid="admin-section-users">Users stub</section>,
}));

vi.mock("@/modules/platform-admin/components/RolesSection", () => ({
  RolesSection: () => <section data-testid="admin-section-roles">Roles stub</section>,
}));

vi.mock("@/modules/platform-admin/components/RolePermissionsSection", () => ({
  RolePermissionsSection: () => <section data-testid="admin-section-role-perms">Role permissions stub</section>,
}));

vi.mock("@/modules/platform-admin/components/UserOverridesSection", () => ({
  UserOverridesSection: ({ userId }: { userId?: string | null }) => (
    <section data-testid="admin-section-overrides">{userId ?? "none"}</section>
  ),
}));

vi.mock("@/modules/platform-admin/components/TitleRulesSection", () => ({
  TitleRulesSection: () => <section data-testid="admin-section-rules">Title rules stub</section>,
}));

import { AdminPanel } from "@/modules/platform-admin/components/AdminPanel";

describe("AdminPanel", () => {
  beforeEach(() => {
    testState.search = "";
  });

  it("falls back to Overview when section is missing or invalid", () => {
    const { rerender } = render(<AdminPanel />);

    expect(screen.getByText("// OVERVIEW")).toBeInTheDocument();
    expect(screen.getByTestId("admin-section-overview")).toBeInTheDocument();

    testState.search = "section=not-real";
    rerender(<AdminPanel />);

    expect(screen.getByText("// OVERVIEW")).toBeInTheDocument();
    expect(screen.getByTestId("admin-section-overview")).toBeInTheDocument();
  });

  it("renders the matching placeholder section from the query param", () => {
    testState.search = "section=roles";

    render(<AdminPanel />);

    expect(screen.getByText("// ROLES")).toBeInTheDocument();
    expect(screen.getByTestId("admin-section-roles")).toBeInTheDocument();
  });

  it("preserves userId context only for the overrides section", () => {
    testState.search = "section=overrides&userId=user-42";

    render(<AdminPanel />);

    expect(screen.getByText("// USER OVERRIDES")).toBeInTheDocument();
    expect(screen.getByTestId("admin-section-overrides")).toBeInTheDocument();
    expect(screen.getByTestId("admin-section-overrides")).toHaveTextContent("user-42");
  });
});