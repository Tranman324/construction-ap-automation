"use client";

import { useCallback, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";
import { cn } from "@/modules/shared/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const timeoutRef = useRef<number | null>(null);
  const transitionEndRef = useRef<((event: TransitionEvent) => void) | null>(null);

  const clearSwitching = useCallback(() => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    if (transitionEndRef.current) document.body.removeEventListener("transitionend", transitionEndRef.current);
    transitionEndRef.current = null;
    document.documentElement.removeAttribute("data-theme-switching");
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) clearSwitching();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearSwitching();
    };
  }, [clearSwitching]);

  const toggleTheme = () => {
    clearSwitching();
    document.documentElement.setAttribute("data-theme-switching", "true");
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === document.body && event.propertyName === "background-color") clearSwitching();
    };
    transitionEndRef.current = onTransitionEnd;
    document.body.addEventListener("transitionend", onTransitionEnd);
    setTheme(theme === "dark" ? "light" : "dark");
    if (document.hidden) {
      clearSwitching();
      return;
    }

    const value = getComputedStyle(document.documentElement).getPropertyValue("--dur-modal").trim();
    const duration = Number.parseFloat(value);
    const durationMs = Number.isFinite(duration) ? duration * (value.endsWith("ms") ? 1 : 1000) : 0;
    timeoutRef.current = window.setTimeout(clearSwitching, durationMs);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className={cn(className)}
    >
      {/* Sun shown in dark mode (click to go light); Moon shown in light mode (click to go dark) */}
      <Sun className="h-5 w-5 hidden dark:block" />
      <Moon className="h-5 w-5 block dark:hidden" />
    </Button>
  );
}
