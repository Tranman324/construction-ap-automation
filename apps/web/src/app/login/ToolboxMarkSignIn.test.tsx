import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToolboxMarkSignIn } from "./ToolboxMarkSignIn";

describe("ToolboxMarkSignIn", () => {
  it("renders a Toolbox mark sign-in control with the default caption", () => {
    render(<ToolboxMarkSignIn onSignIn={vi.fn()} />);

    expect(screen.getByRole("button", { name: /sign in to toolbox/i })).toBeInTheDocument();
    expect(screen.getByText(/click to sign in/i)).toBeInTheDocument();
    expect(screen.getByTestId("toolbox-mark-default")).toBeInTheDocument();
    expect(screen.getByTestId("toolbox-mark-hover")).toBeInTheDocument();
  });

  it("calls onSignIn when clicked", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();

    render(<ToolboxMarkSignIn onSignIn={onSignIn} />);

    await user.click(screen.getByRole("button", { name: /sign in to toolbox/i }));

    expect(onSignIn).toHaveBeenCalledOnce();
  });
});

