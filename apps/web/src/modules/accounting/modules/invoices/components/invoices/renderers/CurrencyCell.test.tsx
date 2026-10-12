import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CurrencyCell } from "@/modules/accounting/modules/invoices/components/invoices/renderers/CurrencyCell";

describe("CurrencyCell", () => {
  it("uses the invoice money treatment for AP queue scanning", () => {
    render(<CurrencyCell amount={1234.56} />);

    expect(screen.getByText("$1,234.56")).toHaveClass("tbx-money");
  });

  it("renders a quiet dash for missing amounts", () => {
    render(<CurrencyCell amount={null} />);

    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });
});
