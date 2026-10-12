import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  RetentionClassificationBadge,
  RetentionStatusBadge,
} from "@/modules/accounting/modules/invoices/components/settings/RetentionBadges";

describe("RetentionBadges", () => {
  it("renders wildcard classification and terminal status labels", () => {
    render(
      <div>
        <RetentionClassificationBadge classification="*" wildcardLabel="All Non-Invoice Types" />
        <RetentionStatusBadge status="retry-pending" labels={{ "retry-pending": "Retry Pending" }} />
      </div>,
    );

    expect(screen.getByText("All Non-Invoice Types")).toBeInTheDocument();
    expect(screen.getByText("Retry Pending")).toBeInTheDocument();
  });
});
