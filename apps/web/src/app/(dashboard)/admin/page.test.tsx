import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const PM = vi.hoisted(() => ({
  search: "section=users",
  authReturn: {
    isLoading: false,
    isAuthenticated: true,
    signIn: vi.fn(async () => {}),
  },
  permissionsReturn: {
    hasPermission: vi.fn(),
    hasAnyPermission: vi.fn(() => false),
    hasAllPermissions: vi.fn(() => true),
    role: "admin",
    isAdmin: true,
    permissions: ["platform.admin"] as string[],
  },
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => PM.authReturn,
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => PM.permissionsReturn,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(PM.search),
}));

vi.mock("@/modules/platform-admin/components/AdminPanel", () => ({
  AdminPanel: () => <div data-testid="admin-panel-stub">Admin panel stub</div>,
}));

import AdminPage from "@/app/(dashboard)/admin/page";

describe("AdminPage", () => {
  beforeEach(() => {
    PM.authReturn = {
      isLoading: false,
      isAuthenticated: true,
      signIn: vi.fn(async () => {}),
    };
    PM.permissionsReturn = {
      hasPermission: vi.fn(),
      hasAnyPermission: vi.fn(() => false),
      hasAllPermissions: vi.fn(() => true),
      role: "admin",
      isAdmin: true,
      permissions: ["platform.admin"],
    };
    PM.search = "section=users";
  });

  it("renders the admin shell for an admin user", () => {
    render(React.createElement(AdminPage));

    expect(screen.getByTestId("admin-panel-stub")).toBeInTheDocument();
  });

  it("renders the AuthGate fallback for users without platform.admin", () => {
    PM.permissionsReturn = {
      ...PM.permissionsReturn,
      role: "employee",
      isAdmin: false,
      permissions: [],
      hasAllPermissions: vi.fn(() => false),
    };

    render(React.createElement(AdminPage));

    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.queryByText("Admin Panel — Coming Soon")).not.toBeInTheDocument();
  });
});