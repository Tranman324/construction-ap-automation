import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRYING_LOADER_SIZE,
  MAX_RETRYING_LOADER_SIZE,
  MIN_RETRYING_LOADER_SIZE,
  normalizeRetryingLoaderSize,
  RetryingLoader,
} from "./RetryingLoader";

const css = readFileSync(
  resolve(process.cwd(), "src/modules/accounting/modules/invoices/components/documents/RetryingLoader.module.css"),
  "utf8",
);

describe("RetryingLoader", () => {
  it("uses the default size and exposes a supplied size for QA", () => {
    const { rerender } = render(<RetryingLoader />);
    expect(screen.getByTestId("retrying-loader")).toHaveAttribute("data-size", String(DEFAULT_RETRYING_LOADER_SIZE));
    rerender(<RetryingLoader size={128} />);
    expect(screen.getByTestId("retrying-loader")).toHaveAttribute("data-size", "128");
  });

  it("keeps size within the supported QA range", () => {
    expect(normalizeRetryingLoaderSize(0)).toBe(MIN_RETRYING_LOADER_SIZE);
    expect(normalizeRetryingLoaderSize(999)).toBe(MAX_RETRYING_LOADER_SIZE);
  });

  it("uses theme tokens and disables both animations for reduced motion", () => {
    expect(css).toContain("stop-color: var(--primary);");
    expect(css).toContain("stop-color: var(--primary-hover);");
    const reducedMotion = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reducedMotion).toContain(".arc,");
    expect(reducedMotion).toContain(".dashes");
    expect(reducedMotion).toContain("animation: none;");
  });
});
