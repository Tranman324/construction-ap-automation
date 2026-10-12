import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const AM = vi.hoisted(() => ({
  authReturn: {
    isLoading: false,
    isAuthenticated: true,
    signIn: vi.fn(async () => {}),
  },
  permissionsReturn: {
    hasPermission: vi.fn(),
    hasAnyPermission: vi.fn(() => false),
    hasAllPermissions: vi.fn(() => false),
    role: "",
    isAdmin: false,
    permissions: [] as string[],
  },
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => AM.authReturn,
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => AM.permissionsReturn,
}));

import { AuthGate } from "@/modules/shared/components/AuthGate";

describe("AuthGate", () => {
  beforeEach(() => {
    AM.authReturn = {
      isLoading: false,
      isAuthenticated: true,
      signIn: vi.fn(async () => {}),
    };
    AM.permissionsReturn = {
      hasPermission: vi.fn(),
      hasAnyPermission: vi.fn(() => false),
      hasAllPermissions: vi.fn(() => false),
      role: "employee",
      isAdmin: false,
      permissions: [],
    };
  });

  it("renders children for an authenticated user without requiredPermissions", () => {
    render(
      <AuthGate>
        <div>protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it("does not render children when requiredPermissions are missing", () => {
    AM.permissionsReturn.hasAllPermissions = vi.fn(() => false);

    render(
      <AuthGate requiredPermissions={["platform.admin"]}>
        <div>protected content</div>
      </AuthGate>,
    );

    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
  });

  it("renders children for an authenticated admin via usePermissions bypass", () => {
    AM.permissionsReturn = {
      ...AM.permissionsReturn,
      isAdmin: true,
      permissions: ["*"],
      hasAnyPermission: vi.fn(() => true),
      hasAllPermissions: vi.fn(() => true),
    };

    render(
      <AuthGate requiredPermissions={["platform.admin"]}>
        <div>protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it("renders children when the user has all required permissions", () => {
    AM.permissionsReturn.hasAllPermissions = vi.fn(() => true);

    render(
      <AuthGate requiredPermissions={["projects.view", "feature_requests.view"]}>
        <div>protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText("protected content")).toBeInTheDocument();
  });

  it("uses mode='all' by default and denies partial permission matches", () => {
    AM.permissionsReturn.hasAllPermissions = vi.fn(() => false);

    render(
      <AuthGate requiredPermissions={["projects.view", "feature_requests.view"]}>
        <div>protected content</div>
      </AuthGate>,
    );

    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("renders children with mode='any' when any required permission matches", () => {
    AM.permissionsReturn.hasAnyPermission = vi.fn(() => true);

    render(
      <AuthGate requiredPermissions={["projects.view", "platform.admin"]} mode="any">
        <div>protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText("protected content")).toBeInTheDocument();
  });
});