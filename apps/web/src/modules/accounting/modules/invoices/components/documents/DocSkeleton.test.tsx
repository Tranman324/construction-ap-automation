import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocSkeleton } from "./DocSkeleton";

describe("DocSkeleton", () => {
  it("renders the document viewer shape without tabbable content", () => {
    render(<DocSkeleton />);

    expect(screen.getByTestId("doc-skeleton")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("generic").length).toBeGreaterThan(0);
  });
});
