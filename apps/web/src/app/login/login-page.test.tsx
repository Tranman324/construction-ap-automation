import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockSignIn: vi.fn(),
  sessionReturn: {
    data: null as { user: { name: string } } | null,
    status: "unauthenticated" as "authenticated" | "unauthenticated" | "loading",
  },
}));

vi.mock("next-auth/react", () => ({
  useSession: () => testState.sessionReturn,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: testState.mockPush }),
}));

vi.mock("@/modules/shared/lib/auth", () => ({
  useAuth: () => ({ signIn: testState.mockSignIn }),
}));

vi.mock("@/modules/shared/components/layout/PlatformMeshBackground", () => ({
  PlatformMeshBackground: () => <div data-testid="platform-mesh-background" />,
}));

vi.mock("@/modules/shared/components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button" aria-label="Toggle theme" />,
}));

interface MockLoginParticleCircleProps {
  densityScale?: number;
  motionScale?: number;
  thicknessScale?: number;
}

vi.mock("@/app/login/LoginParticleCircle", () => ({
  LoginParticleCircle: ({ densityScale, motionScale, thicknessScale }: MockLoginParticleCircleProps) => (
    <canvas
      data-density-scale={densityScale}
      data-motion-scale={motionScale}
      data-testid="login-particle-circle"
      data-thickness-scale={thicknessScale}
    />
  ),
}));

import LoginPage from "@/app/login/page";

beforeEach(() => {
  testState.sessionReturn = { data: null, status: "unauthenticated" };
  testState.mockPush.mockReset();
  testState.mockSignIn.mockReset();
});

describe("LoginPage", () => {
  it("renders the V2 particle sign-in experience when unauthenticated", () => {
    render(React.createElement(LoginPage));

    expect(screen.getByTestId("platform-mesh-background")).toBeInTheDocument();
    expect(screen.getByTestId("login-particle-circle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in to toolbox/i })).toBeInTheDocument();
    expect(screen.getByText(/click to sign in/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in with microsoft/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("login-particle-circle")).toHaveAttribute("data-density-scale", "0.5");
    expect(screen.getByTestId("login-particle-circle")).toHaveAttribute("data-motion-scale", "0");
    expect(screen.getByTestId("login-particle-circle")).toHaveAttribute("data-thickness-scale", "0.45");
  });

  it("clicking the Toolbox mark starts sign-in", async () => {
    const user = userEvent.setup();

    render(React.createElement(LoginPage));

    await user.click(screen.getByRole("button", { name: /sign in to toolbox/i }));

    expect(testState.mockSignIn).toHaveBeenCalledOnce();
  });

  it("expands particle thickness while preserving preferred density on hover", async () => {
    const user = userEvent.setup();

    render(React.createElement(LoginPage));

    await user.hover(screen.getByTestId("login-particle-stage"));

    expect(screen.getByTestId("login-particle-circle")).toHaveAttribute("data-density-scale", "0.5");
    expect(screen.getByTestId("login-particle-circle")).toHaveAttribute("data-motion-scale", "1.44");
    expect(screen.getByTestId("login-particle-circle")).toHaveAttribute("data-thickness-scale", "1");

    await user.unhover(screen.getByTestId("login-particle-stage"));

    expect(screen.getByTestId("login-particle-circle")).toHaveAttribute("data-density-scale", "0.5");
    expect(screen.getByTestId("login-particle-circle")).toHaveAttribute("data-motion-scale", "0");
    expect(screen.getByTestId("login-particle-circle")).toHaveAttribute("data-thickness-scale", "0.45");
  });

  it("shows loading state without the sign-in mark while session status is loading", () => {
    testState.sessionReturn = { data: null, status: "loading" };

    render(React.createElement(LoginPage));

    expect(screen.getByLabelText(/loading session/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in to toolbox/i })).not.toBeInTheDocument();
  });

  it("redirects to root when the session is already authenticated", async () => {
    testState.sessionReturn = { data: { user: { name: "Dana" } }, status: "authenticated" };

    render(React.createElement(LoginPage));

    await waitFor(() => {
      expect(testState.mockPush).toHaveBeenCalledWith("/");
    });
  });
});
