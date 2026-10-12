import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "@/modules/accounting/modules/invoices/components/invoices/renderers/StatusBadge";

describe("StatusBadge", () => {
  it("renders pending invoices as pending pills", () => {
    render(<StatusBadge status="pending" />);

    const badge = screen.getByText("Pending").closest("[data-slot='badge']");

    expect(badge).toHaveClass("tbx-status-pill--pending");
  });

  it("preserves known status labels and edited provenance", () => {
    render(<StatusBadge status="approved" wasModified />);

    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("edited")).toBeInTheDocument();
  });

  it("humanizes unknown status values safely", () => {
    render(<StatusBadge status="queued-for-review" />);

    expect(screen.getByText("Queued For Review")).toBeInTheDocument();
  });

  it("renders duplicate as the muted pill, not violet, with a static dot", () => {
    render(<StatusBadge status="duplicate" />);

    const badge = screen.getByText("Duplicate").closest("[data-slot='badge']");

    expect(badge).toHaveClass("tbx-status-pill--muted");
    expect(badge).not.toHaveClass("tbx-status-pill--violet");
    expect(badge?.querySelector(".tbx-status-pill__dot")).not.toHaveClass("is-pulsing");
  });

  it("gives duplicate exactly the same tone classes as discarded", () => {
    const { container: discarded } = render(<StatusBadge status="discarded" />);
    const { container: duplicate } = render(<StatusBadge status="duplicate" />);
    const toneClasses = (root: HTMLElement) =>
      Array.from(root.querySelector("[data-slot='badge']")?.classList ?? []).filter((name) => name.startsWith("tbx-status-pill"));

    expect(toneClasses(discarded)).toEqual(["tbx-status-pill", "tbx-status-pill--muted"]);
    expect(toneClasses(duplicate)).toEqual(["tbx-status-pill", "tbx-status-pill--muted"]);
    expect(discarded).toHaveTextContent("Discarded");
    expect(duplicate).toHaveTextContent("Duplicate");
  });
});
