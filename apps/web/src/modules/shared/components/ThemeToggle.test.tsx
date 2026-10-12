import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

const testState = vi.hoisted(() => ({
  setTheme: vi.fn(),
  theme: "light",
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({
    setTheme: testState.setTheme,
    theme: testState.theme,
  }),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    testState.theme = "light";
    testState.setTheme.mockReset();
    document.documentElement.style.setProperty("--dur-modal", "240ms");
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.style.removeProperty("--dur-modal");
    document.documentElement.removeAttribute("data-theme-switching");
    Reflect.deleteProperty(document, "hidden");
  });

  it("preserves the default toggle behavior", async () => {
    const user = userEvent.setup();

    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /toggle theme/i }));

    expect(testState.setTheme).toHaveBeenCalledWith("dark");
  });

  it("supports optional className styling overrides", () => {
    render(<ThemeToggle className="h-8 w-8 rounded-md" />);

    expect(screen.getByRole("button", { name: /toggle theme/i })).toHaveClass("h-8", "w-8", "rounded-md");
  });

  it("clears the html switching marker after the token duration", () => {
    vi.useFakeTimers();
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(document.documentElement).toHaveAttribute("data-theme-switching", "true");
    expect(testState.setTheme).toHaveBeenCalledWith("dark");
    act(() => vi.advanceTimersByTime(239));
    expect(document.documentElement).toHaveAttribute("data-theme-switching", "true");
    act(() => vi.advanceTimersByTime(1));
    expect(document.documentElement).not.toHaveAttribute("data-theme-switching");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears on transition end or hidden document and cancels the fallback timer", () => {
    vi.useFakeTimers();
    render(<ThemeToggle />);
    const toggle = screen.getByRole("button", { name: /toggle theme/i });
    fireEvent.click(toggle);
    fireEvent.transitionEnd(document.body, { propertyName: "background-color" });
    expect(document.documentElement).not.toHaveAttribute("data-theme-switching");
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(toggle);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    fireEvent(document, new Event("visibilitychange"));
    expect(document.documentElement).not.toHaveAttribute("data-theme-switching");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarts cleanup on a second toggle and clears listeners on unmount", () => {
    vi.useFakeTimers();
    const view = render(<ThemeToggle />);
    const toggle = screen.getByRole("button", { name: /toggle theme/i });
    fireEvent.click(toggle);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(toggle);
    act(() => vi.advanceTimersByTime(140));
    expect(document.documentElement).toHaveAttribute("data-theme-switching", "true");
    view.unmount();
    expect(document.documentElement).not.toHaveAttribute("data-theme-switching");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not leave a switching marker when the document is already hidden", () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(testState.setTheme).toHaveBeenCalledWith("dark");
    expect(document.documentElement).not.toHaveAttribute("data-theme-switching");
    expect(vi.getTimerCount()).toBe(0);
  });
});
