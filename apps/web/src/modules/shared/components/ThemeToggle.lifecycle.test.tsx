import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

describe("next-themes html boundary", () => {
  beforeEach(() => {
    document.documentElement.style.setProperty("--dur-modal", "240ms");
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.removeAttribute("data-theme-switching");
    document.documentElement.style.removeProperty("--dur-modal");
    window.localStorage.removeItem("motion-theme-test");
  });

  it("switches the html class and clears the marker at the body transition end", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider attribute="class" defaultTheme="light" storageKey="motion-theme-test" enableSystem={false}>
        <ThemeToggle />
      </ThemeProvider>,
    );
    await waitFor(() => expect(document.documentElement).toHaveClass("light"));
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(document.documentElement).toHaveAttribute("data-theme-switching", "true");
    fireEvent.transitionEnd(document.body, { propertyName: "background-color" });
    expect(document.documentElement).not.toHaveAttribute("data-theme-switching");
  });
});
