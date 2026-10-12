import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilterSummaryBar } from "@/modules/shared/components/patterns/FilterSummaryBar";

describe("FilterSummaryBar", () => {
  it("renders summary content and clear action", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();

    render(
      <FilterSummaryBar onClear={onClear}>
        Showing <strong>Approved</strong> results
      </FilterSummaryBar>,
    );

    expect(screen.getByText("Approved")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(onClear).toHaveBeenCalledOnce();
  });
});
