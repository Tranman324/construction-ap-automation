import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { RuleStatStrip } from "@/modules/accounting/modules/invoices/components/settings/RuleStatStrip";

describe("RuleStatStrip", () => {
  it("renders rule workspace stats", () => {
    render(
      <RuleStatStrip
        stats={{
          total: 4,
          active: 3,
          disabled: 1,
          stopOnMatch: 2,
          actionCount: 5,
          latestUpdatedAt: "2026-01-03T00:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("3/4")).toBeInTheDocument();
    expect(screen.getByText("2026-01-03")).toBeInTheDocument();
  });
});
