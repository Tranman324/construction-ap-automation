import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompactStatGrid } from "@/modules/shared/components/patterns/CompactStatGrid";

describe("CompactStatGrid", () => {
  it("renders labeled compact stats with accessible values", () => {
    render(
      <CompactStatGrid
        items={[
          { label: "Documents", value: 3, ariaLabel: "Documents count" },
          { label: "Total value", value: "$120.00", ariaLabel: "Total value" },
        ]}
      />,
    );

    expect(screen.getByText("Documents")).toBeInTheDocument();
    expect(screen.getByLabelText("Documents count")).toHaveTextContent("3");
    expect(screen.getByLabelText("Total value")).toHaveTextContent("$120.00");
  });
});
