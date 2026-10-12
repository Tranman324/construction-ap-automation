import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScrollableList, ScrollableListRow } from "@/modules/shared/components/patterns/ScrollableList";

describe("ScrollableList", () => {
  it("renders a framed scrollable list with rows", () => {
    render(
      <ScrollableList ariaLabel="Results" maxHeight="sm">
        <ScrollableListRow ariaLabel="INV-1 success">INV-1</ScrollableListRow>
        <ScrollableListRow active ariaLabel="INV-2 failed">INV-2</ScrollableListRow>
      </ScrollableList>,
    );

    expect(screen.getByLabelText("Results")).toHaveClass("max-h-72");
    expect(screen.getByLabelText("INV-2 failed")).toHaveAttribute("aria-current", "true");
  });
});
