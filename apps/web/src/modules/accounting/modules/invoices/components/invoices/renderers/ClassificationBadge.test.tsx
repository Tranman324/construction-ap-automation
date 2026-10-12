import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CATALOG = vi.hoisted(() => ({
  classifications: [{ name: "lien-waiver", label: "Lien Waiver" }, { name: "warranty", label: "Warranty" }],
  isError: false,
  isLoading: false,
}));
vi.mock("@/modules/accounting/modules/invoices/hooks/queries", () => ({
  useClassifications: () => CATALOG,
}));

import { ClassificationBadge } from "@/modules/accounting/modules/invoices/components/invoices/renderers/ClassificationBadge";

describe("ClassificationBadge", () => {
  beforeEach(() => {
    CATALOG.isError = false;
    CATALOG.isLoading = false;
  });
  it("renders canonical classification labels with an icon prefix", () => {
    const { container } = render(<ClassificationBadge classification="lien-waiver" />);

    expect(screen.getByText("Lien Waiver")).toBeInTheDocument();
    expect(container.querySelector("svg.inv-class__icon")).not.toBeNull();
  });

  it("supports design sample classifications beyond the previous production set", () => {
    render(<ClassificationBadge classification="warranty" />);

    expect(screen.getByText("Warranty")).toBeInTheDocument();
  });

  it("renders an explicit unavailable state for an unknown classification", () => {
    render(<ClassificationBadge classification="expense-report" />);

    expect(screen.getByText("Classification unavailable")).toBeInTheDocument();
  });

  it("does not substitute a local label when the served catalog is unavailable", () => {
    CATALOG.isError = true;
    render(<ClassificationBadge classification="lien-waiver" />);

    expect(screen.getByText("Classification unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Lien Waiver")).not.toBeInTheDocument();
  });
});
