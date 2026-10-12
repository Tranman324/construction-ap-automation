import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TitleRulesSection } from "@/modules/platform-admin/components/TitleRulesSection";

const testState = vi.hoisted(() => ({
  roles: [
    {
      id: "role-1",
      name: "Project Executive",
      description: null,
      is_system: false,
      user_count: 3,
    },
    {
      id: "role-2",
      name: "Project Coordinator",
      description: null,
      is_system: false,
      user_count: 5,
    },
  ],
  rules: [
    {
      id: "rule-low",
      pattern: "Coordinator",
      match_type: "contains",
      role_id: "role-2",
      priority: 20,
      is_active: true,
      created_at: "2026-05-13T10:00:00.000Z",
      role_name: "Project Coordinator",
    },
    {
      id: "rule-high",
      pattern: "Executive",
      match_type: "contains",
      role_id: "role-1",
      priority: 90,
      is_active: true,
      created_at: "2026-05-13T10:00:00.000Z",
      role_name: "Project Executive",
    },
  ],
  rulesLoading: false,
  canManageTitleRules: true,
  createMutation: { mutate: vi.fn(), isPending: false },
  updateMutation: { mutate: vi.fn(), isPending: false },
  deleteMutation: { mutate: vi.fn(), isPending: false },
  previewMutation: { mutate: vi.fn(), isPending: false },
}));

vi.mock("@/modules/platform-admin/hooks/queries", () => ({
  useAdminRoles: () => ({ data: testState.roles, isLoading: false, error: null }),
  useAdminTitleRules: () => ({
    data: testState.rulesLoading ? undefined : testState.rules,
    isLoading: testState.rulesLoading,
    error: null,
  }),
}));

vi.mock("@/modules/platform-admin/hooks/mutations", () => ({
  useCreateAdminTitleRule: () => testState.createMutation,
  useUpdateAdminTitleRule: () => testState.updateMutation,
  useDeleteAdminTitleRule: () => testState.deleteMutation,
  usePreviewTitleRule: () => testState.previewMutation,
}));

vi.mock("@/modules/shared/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: (key: string) =>
      key === "platform.manage_title_rules" ? testState.canManageTitleRules : false,
    hasAnyPermission: () => false,
    hasAllPermissions: () => false,
    role: "platform.admin",
    isAdmin: false,
    permissions: [],
  }),
}));

describe("TitleRulesSection", () => {
  beforeEach(() => {
    testState.rulesLoading = false;
    testState.canManageTitleRules = true;
    testState.createMutation.isPending = false;
    testState.updateMutation.isPending = false;
    testState.deleteMutation.isPending = false;
    testState.previewMutation.isPending = false;
    testState.createMutation.mutate.mockReset();
    testState.updateMutation.mutate.mockReset();
    testState.deleteMutation.mutate.mockReset();
    testState.previewMutation.mutate.mockReset();
  });

  it("renders a distinct loading state while the title-rules query is pending", () => {
    testState.rulesLoading = true;

    render(<TitleRulesSection />);

    expect(screen.getByTestId("title-rules-loading-state")).toBeInTheDocument();
    expect(screen.getByText("Loading title rules...")).toBeInTheDocument();
    expect(screen.queryByText("No title rules are configured yet.")).not.toBeInTheDocument();
  });

  it("sorts rules by descending priority and displays role_name", () => {
    render(<TitleRulesSection />);

    expect(
      screen.getAllByTestId(/title-rule-row-/).map((row) => row.getAttribute("data-testid")),
    ).toEqual(["title-rule-row-rule-high", "title-rule-row-rule-low"]);
    expect(screen.getByText("Project Executive")).toBeInTheDocument();
  });

  it("submits create, edit, and delete payloads through the admin title rule mutations", () => {
    render(<TitleRulesSection />);

    fireEvent.click(screen.getByRole("button", { name: /create rule/i }));
    fireEvent.change(screen.getByLabelText(/pattern/i), {
      target: { value: "Project Manager" },
    });
    fireEvent.change(screen.getByLabelText(/priority/i), {
      target: { value: "55" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create rule$/i }));

    expect(testState.createMutation.mutate).toHaveBeenCalledWith(
      {
        pattern: "Project Manager",
        match_type: "contains",
        role_id: "role-1",
        priority: 55,
        is_active: true,
      },
      expect.any(Object),
    );

    fireEvent.click(screen.getByTestId("edit-title-rule-rule-high"));
    fireEvent.change(screen.getByLabelText(/pattern/i), {
      target: { value: "Senior Executive" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(testState.updateMutation.mutate).toHaveBeenCalledWith(
      {
        ruleId: "rule-high",
        payload: {
          pattern: "Senior Executive",
          match_type: "contains",
          role_id: "role-1",
          priority: 90,
          is_active: true,
        },
      },
      expect.any(Object),
    );

    fireEvent.click(screen.getByTestId("delete-title-rule-rule-low"));
    expect(screen.getByText("Delete Coordinator?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /delete rule/i }));

    expect(testState.deleteMutation.mutate).toHaveBeenCalledWith(
      { ruleId: "rule-low" },
      expect.any(Object),
    );
  });

  it("sends the preview payload as jobTitle and renders matched and unmatched states", () => {
    render(<TitleRulesSection />);

    fireEvent.change(screen.getByLabelText(/preview job title/i), {
      target: { value: "Executive" },
    });
    fireEvent.click(screen.getByRole("button", { name: /run preview/i }));

    expect(testState.previewMutation.mutate).toHaveBeenCalledWith(
      { jobTitle: "Executive" },
      expect.any(Object),
    );

    let [, options] = testState.previewMutation.mutate.mock.calls[0];
    act(() => {
      options.onSuccess?.({ matched: testState.rules[1] });
    });

    expect(screen.getByTestId("title-rule-preview-result")).toHaveTextContent("Matched Executive");
    expect(screen.getByTestId("title-rule-preview-result")).toHaveTextContent("Project Executive");

    fireEvent.change(screen.getByLabelText(/preview job title/i), {
      target: { value: "Intern" },
    });
    fireEvent.click(screen.getByRole("button", { name: /run preview/i }));

    [, options] = testState.previewMutation.mutate.mock.calls[1];
    act(() => {
      options.onSuccess?.({ matched: null });
    });

    expect(screen.getByTestId("title-rule-preview-result")).toHaveTextContent("No active rule matched");
  });

  it("keeps title-rule controls visible but disabled when the permission is missing", () => {
    testState.canManageTitleRules = false;

    render(<TitleRulesSection />);

    expect(screen.getByRole("button", { name: /create rule/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /create rule/i })).toHaveAttribute("title", "Requires platform.manage_title_rules");
    expect(screen.getByTestId("edit-title-rule-rule-high")).toBeDisabled();
    expect(screen.getByTestId("delete-title-rule-rule-high")).toBeDisabled();
    expect(screen.getAllByText("Requires platform.manage_title_rules").length).toBeGreaterThan(0);
  });
});