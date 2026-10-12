import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface QueryState<TData> {
  data: TData | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

const TM = vi.hoisted(() => ({
  users: {
    data: [
      { id: "u-1", is_active: true },
      { id: "u-2", is_active: false },
      { id: "u-3", is_active: true },
    ],
    isLoading: false,
    isError: false,
    error: null,
  } as QueryState<Array<{ id: string; is_active: boolean }>>,
  roles: {
    data: [{ id: "r-1" }, { id: "r-2" }, { id: "r-3" }],
    isLoading: false,
    isError: false,
    error: null,
  } as QueryState<Array<{ id: string }>>,
  permissions: {
    data: {
      platform: [{ key: "platform.admin" }, { key: "platform.manage_users" }],
      invoices: [{ key: "accounting.invoices.view" }],
    },
    isLoading: false,
    isError: false,
    error: null,
  } as QueryState<Record<string, Array<{ key: string }>>>,
  titleRules: {
    data: [{ id: "rule-1", is_active: true }, { id: "rule-2", is_active: false }],
    isLoading: false,
    isError: false,
    error: null,
  } as QueryState<Array<{ id: string; is_active: boolean }>>,
}));

vi.mock("@/modules/platform-admin/hooks/queries", () => ({
  useAdminUsers: () => TM.users,
  useAdminRoles: () => TM.roles,
  useAdminPermissions: () => TM.permissions,
  useAdminTitleRules: () => TM.titleRules,
}));

import { AdminOverview } from "@/modules/platform-admin/components/AdminOverview";

describe("AdminOverview", () => {
  beforeEach(() => {
    TM.users = {
      data: [
        { id: "u-1", is_active: true },
        { id: "u-2", is_active: false },
        { id: "u-3", is_active: true },
      ],
      isLoading: false,
      isError: false,
      error: null,
    };
    TM.roles = {
      data: [{ id: "r-1" }, { id: "r-2" }, { id: "r-3" }],
      isLoading: false,
      isError: false,
      error: null,
    };
    TM.permissions = {
      data: {
        platform: [{ key: "platform.admin" }, { key: "platform.manage_users" }],
        invoices: [{ key: "accounting.invoices.view" }],
      },
      isLoading: false,
      isError: false,
      error: null,
    };
    TM.titleRules = {
      data: [{ id: "rule-1", is_active: true }, { id: "rule-2", is_active: false }],
      isLoading: false,
      isError: false,
      error: null,
    };
  });

  it("renders query-backed overview metrics", () => {
    render(<AdminOverview />);

    expect(screen.getByTestId("overview-metric-grid").className).toContain("lg:grid-cols-5");
    expect(screen.getByTestId("overview-metric-slot-active-title-rules")).toHaveClass("hidden", "md:block");
    expect(screen.getByTestId("overview-metric-total-users")).toHaveTextContent("3");
    expect(screen.getByTestId("overview-metric-active-users")).toHaveTextContent("2");
    expect(screen.getByTestId("overview-metric-roles")).toHaveTextContent("3");
    expect(screen.getByTestId("overview-metric-registered-permissions")).toHaveTextContent("3");
    expect(screen.getByTestId("overview-metric-registered-permissions")).toHaveTextContent("Permissions");
    expect(screen.getByTestId("overview-metric-active-title-rules")).toHaveTextContent("1");
    expect(screen.getByTestId("overview-metric-active-title-rules")).toHaveTextContent("Active rules");
    expect(screen.getByText("Operational health")).toBeInTheDocument();
  });

  it("falls back only the metric cards backed by a failing query", () => {
    TM.roles = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Role service unavailable"),
    };

    render(<AdminOverview />);

    expect(screen.getByTestId("overview-metric-roles")).toHaveTextContent("Unavailable");
    expect(screen.getByTestId("overview-metric-roles")).toHaveTextContent("Role service unavailable");
    expect(screen.getByTestId("overview-metric-total-users")).toHaveTextContent("3");
    expect(screen.getByTestId("overview-metric-registered-permissions")).toHaveTextContent("3");
  });
});
