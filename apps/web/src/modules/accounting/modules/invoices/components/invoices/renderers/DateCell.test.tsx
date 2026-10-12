import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DateCell } from "@/modules/accounting/modules/invoices/components/invoices/renderers/DateCell";

describe("DateCell", () => {
  it("renders invoice dates in the compact AP queue format", () => {
    render(<DateCell dateStr="2026-06-09" />);

    expect(screen.getByText("06/09")).toBeInTheDocument();
    expect(screen.getByText("/26")).toHaveClass("tbx-date__y");
  });

  it("renders a quiet dash for missing or invalid dates", () => {
    const { rerender } = render(<DateCell dateStr={null} />);

    expect(screen.getByText("\u2014")).toBeInTheDocument();

    rerender(<DateCell dateStr="not-a-date" />);

    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });
});
