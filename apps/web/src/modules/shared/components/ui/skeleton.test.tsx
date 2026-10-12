import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton } from "./skeleton";
import styles from "./skeleton.module.css";

const cssPath = resolve(process.cwd(), "src/modules/shared/components/ui/skeleton.module.css");

describe("Skeleton shimmer contract", () => {
  it("keeps the shared loading shape and consumer radius overrides", () => {
    const { rerender } = render(<Skeleton data-testid="skeleton" />);

    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton).toHaveAttribute("data-slot", "skeleton");
    expect(skeleton).toHaveClass(styles.shimmer, "rounded");

    rerender(<Skeleton data-testid="skeleton" className="rounded-lg" />);
    expect(skeleton).toHaveClass(styles.shimmer, "rounded-lg");
    expect(skeleton).not.toHaveClass("rounded");
  });

  it("defines one exact linear shimmer with a flat reduced-motion fallback", () => {
    const css = readFileSync(cssPath, "utf8");

    expect(css).toContain(
      "linear-gradient(90deg,\n    var(--muted) 25%,\n    color-mix(in srgb, var(--muted) 45%, var(--card)) 50%,\n    var(--muted) 75%)",
    );
    expect(css).toContain("background-size: 400% 100%;");
    expect(css).toContain("animation: skeleton-shimmer 1.4s linear infinite;");
    expect(css).toContain("0% { background-position: 100% 0; }");
    expect(css).toContain("100% { background-position: 0 0; }");
    expect(css).toContain("animation: none;\n    background: var(--muted);");
  });

  it("keeps the scoped outside consumers on the shared class", () => {
    const metricCard = readFileSync(resolve(process.cwd(), "src/modules/shared/components/patterns/MetricCard.tsx"), "utf8");
    const sectionHeader = readFileSync(resolve(process.cwd(), "src/modules/shared/components/patterns/PlatformSectionHeader.tsx"), "utf8");

    expect(metricCard).toContain("skeletonStyles.shimmer");
    expect(sectionHeader).toContain("skeletonStyles.shimmer");
    const pulseClass = ["animate", "pulse"].join("-");
    expect(metricCard).not.toContain(pulseClass);
    expect(sectionHeader).not.toContain(pulseClass);
  });
});
