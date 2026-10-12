import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlatformSectionHeader } from "@/modules/shared/components/patterns/PlatformSectionHeader";
import skeletonStyles from "@/modules/shared/components/ui/skeleton.module.css";

describe("PlatformSectionHeader", () => {
  it("renders platform title treatment with cyan accent and optional actions", () => {
    render(
      <PlatformSectionHeader
        title="Accounting"
        accentLabel="AP Billing"
        pulseTestId="section-pulse"
        actions={<button type="button">Submit to Spectrum</button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Accounting // AP Billing" })).toHaveClass(
      "font-bold",
      "uppercase",
      "tracking-[0.24em]",
    );
    expect(screen.getByText("// AP Billing")).toHaveClass("text-ncg-cyan");
    expect(screen.getByTestId("section-pulse")).toHaveClass(
      skeletonStyles.shimmer,
    );
    expect(screen.getByTestId("section-pulse")).not.toHaveClass(["animate", "pulse"].join("-"));
    expect(screen.getByRole("button", { name: "Submit to Spectrum" })).toBeInTheDocument();
  });
});
