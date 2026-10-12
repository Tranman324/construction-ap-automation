import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginParticleCircle } from "./LoginParticleCircle";

interface MockCanvasContext {
  arc: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  fillStyle: string;
  globalAlpha: number;
  globalCompositeOperation: string;
  setTransform: ReturnType<typeof vi.fn>;
}

function createCanvasContext(): MockCanvasContext {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    fillStyle: "",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    setTransform: vi.fn(),
  };
}

function mockMatchMedia(matches: boolean) {
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

function mockViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

describe("LoginParticleCircle", () => {
  let context: MockCanvasContext;

  beforeEach(() => {
    context = createCanvasContext();
    mockMatchMedia(true);
    mockViewportWidth(1280);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 520,
      height: 520,
      left: 0,
      right: 520,
      top: 0,
      width: 520,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an aria-hidden canvas for the token-driven particle ring", () => {
    render(<LoginParticleCircle className="absolute inset-0" />);

    const canvas = screen.getByTestId("login-particle-circle");

    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveClass("absolute", "inset-0");
  });

  it("draws a static full-circle frame when reduced motion is enabled", () => {
    render(<LoginParticleCircle />);

    expect(context.arc).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
  });

  it("reduces particle density on tablet and mobile viewports", () => {
    mockViewportWidth(900);

    render(<LoginParticleCircle densityScale={0.5} />);

    expect(context.arc).toHaveBeenCalledTimes(413);
  });
});
