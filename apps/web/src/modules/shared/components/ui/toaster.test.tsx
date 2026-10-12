import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sonnerProps = vi.hoisted(() => ({
  values: [] as Array<{
    position?: string;
    offset?: unknown;
    mobileOffset?: unknown;
    gap?: number;
  }>,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light" }),
}));

vi.mock("sonner", () => ({
  Toaster: (props: { position?: string; offset?: unknown; mobileOffset?: unknown }) => {
    sonnerProps.values.push(props);
    return <div data-testid="sonner-toaster" data-position={props.position} />;
  },
  toast: {},
}));

import { setDocumentToastAnchor, Toaster } from "@/modules/shared/components/ui/toaster";

describe("Toaster", () => {
  afterEach(() => {
    sonnerProps.values = [];
    setDocumentToastAnchor(null);
  });

  it("places compact global toasts at the bottom left with consistent edge/stack spacing", () => {
    render(<Toaster />);

    expect(screen.getByTestId("sonner-toaster")).toHaveAttribute("data-position", "bottom-left");
    expect(sonnerProps.values.at(-1)?.offset).toBe(16);
    expect(sonnerProps.values.at(-1)?.mobileOffset).toBe(12);
    expect(sonnerProps.values.at(-1)?.gap).toBe(8);
  });

  it("keeps document-panel notifications in the same corner despite viewer anchor updates", () => {
    render(<Toaster />);

    act(() => {
      setDocumentToastAnchor({ left: 48, bottom: 24 });
    });

    expect(screen.getByTestId("sonner-toaster")).toHaveAttribute("data-position", "bottom-left");
    expect(sonnerProps.values.at(-1)?.offset).toBe(16);
    act(() => setDocumentToastAnchor(null));
    expect(screen.getByTestId("sonner-toaster")).toHaveAttribute("data-position", "bottom-left");
  });

  it("ignores a viewer anchor left before the toaster mounts", () => {
    setDocumentToastAnchor({ left: 48, bottom: 24 });
    render(<Toaster />);
    expect(screen.getByTestId("sonner-toaster")).toHaveAttribute("data-position", "bottom-left");
    expect(sonnerProps.values.at(-1)?.offset).toBe(16);
  });
});
