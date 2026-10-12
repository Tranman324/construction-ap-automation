import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TitleRuleEditor } from "@/modules/platform-admin/components/TitleRuleEditor";

const roles = [
  {
    id: "role-1",
    name: "Project Executive",
    description: null,
    is_system: false,
    user_count: 3,
  },
];

describe("TitleRuleEditor", () => {
  it("submits a normalized payload from the current form state", () => {
    const onSubmit = vi.fn();

    render(
      <TitleRuleEditor
        mode="edit"
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        roles={roles}
        rule={{
          id: "rule-1",
          pattern: "Executive",
          match_type: "contains",
          role_id: "role-1",
          priority: 80,
          is_active: true,
          created_at: "2026-05-13T10:00:00.000Z",
          role_name: "Project Executive",
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText(/pattern/i), {
      target: { value: "Senior Executive" },
    });
    fireEvent.change(screen.getByLabelText(/priority/i), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      pattern: "Senior Executive",
      match_type: "contains",
      role_id: "role-1",
      priority: 90,
      is_active: false,
    });
  });

  it("blocks submission when a rule has no selected role", () => {
    const onSubmit = vi.fn();

    render(
      <TitleRuleEditor mode="create" open onOpenChange={vi.fn()} onSubmit={onSubmit} roles={[]} />,
    );

    fireEvent.change(screen.getByLabelText(/pattern/i), {
      target: { value: "Coordinator" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create rule/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Select a role before saving a title rule.")).toBeInTheDocument();
  });
});