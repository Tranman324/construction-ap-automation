import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformMeshBackground } from "./PlatformMeshBackground";

interface MockMeshGradientProps {
  colors: string[];
  distortion: number;
  speed: number;
  swirl: number;
}

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: ({ colors, distortion, speed, swirl }: MockMeshGradientProps) => (
    <div
      data-testid="platform-mesh-gradient"
      data-colors={colors.join("|")}
      data-distortion={distortion}
      data-speed={speed}
      data-swirl={swirl}
    />
  ),
}));

function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  });
}

describe("PlatformMeshBackground", () => {
  beforeEach(() => {
    mockReducedMotion(false);
    document.documentElement.className = "";
  });

  it("renders a token-driven mesh background layer", async () => {
    render(<PlatformMeshBackground />);

    const mesh = await screen.findByTestId("platform-mesh-gradient");

    expect(screen.getByTestId("platform-mesh-background")).toHaveAttribute("aria-hidden", "true");
    expect(mesh.getAttribute("data-colors")?.split("|")).toHaveLength(6);
    expect(mesh).toHaveAttribute("data-distortion", "1.12");
    expect(mesh).toHaveAttribute("data-speed", "0.18");
  });

  it("keeps the static fallback and skips animation when reduced motion is enabled", async () => {
    mockReducedMotion(true);

    render(<PlatformMeshBackground />);

    await waitFor(() => {
      expect(screen.queryByTestId("platform-mesh-gradient")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("platform-mesh-background")).toBeInTheDocument();
  });
});
