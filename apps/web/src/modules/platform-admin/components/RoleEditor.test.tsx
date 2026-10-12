import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoleEditor } from "@/modules/platform-admin/components/RoleEditor";

describe("RoleEditor", () => {
  it("submits a trimmed payload and normalizes empty descriptions to null", () => {
    const onSubmit = vi.fn();

    render(
      <RoleEditor mode="create" open onOpenChange={vi.fn()} onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByLabelText(/role name/i), {
      target: { value: "  Operations Lead  " },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /create role/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Operations Lead",
      description: null,
    });
  });

  it("capitalizes the first letter of typed role names", () => {
    const onSubmit = vi.fn();

    render(<RoleEditor mode="create" open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/role name/i), {
      target: { value: "  admin  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /create role/i }));

    expect(onSubmit).toHaveBeenCalledWith({ name: "Admin", description: null });
  });

  it("blocks submission when the role name is blank", () => {
    const onSubmit = vi.fn();

    render(
      <RoleEditor mode="edit" open onOpenChange={vi.fn()} onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByLabelText(/role name/i), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Role name is required.")).toBeInTheDocument();
  });
});