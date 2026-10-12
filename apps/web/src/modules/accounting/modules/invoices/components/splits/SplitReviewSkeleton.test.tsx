import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { SplitReviewSkeleton } from "@/modules/accounting/modules/invoices/components/splits/SplitReviewSkeleton";

describe("SplitReviewSkeleton", () => {
  it("renders loading placeholders", () => {
    const { container } = render(<SplitReviewSkeleton />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
