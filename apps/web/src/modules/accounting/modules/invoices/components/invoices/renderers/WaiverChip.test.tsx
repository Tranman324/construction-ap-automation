import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  WaiverChip,
} from "@/modules/accounting/modules/invoices/components/invoices/renderers/WaiverChip";

describe("WaiverChip", () => {
  it("renders null as an empty AP table cell", () => {
    const { container } = render(<WaiverChip status={null} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("maps attached and required to their canonical labels and tones", () => {
    const { container, rerender } = render(
      <WaiverChip status="attached" />
    );

    expect(screen.getByText("Attached")).toHaveClass("border-emerald-300", "text-emerald-700");
    expect(container.querySelector("svg")).not.toBeNull();

    rerender(<WaiverChip status="required" />);

    expect(screen.getByText("Required")).toHaveClass("border-amber-300", "text-amber-800");
  });

  it("maps requested and bypassed from their canonical statuses", () => {
    const { rerender } = render(<WaiverChip status="requested" />);
    expect(screen.getByText("Requested")).toHaveClass("border-blue-300", "text-blue-700");

    rerender(<WaiverChip status="bypassed" waiverBypassed={false} />);
    expect(screen.getByText("Bypassed")).toBeInTheDocument();
    expect(screen.getByLabelText("Lien waiver bypassed")).toBeInTheDocument();
  });

  it("renders the canonical not-required state without consulting legacy waiver fields", () => {
    const { rerender } = render(<WaiverChip status="not-required" />);

    expect(screen.getByText("Not required")).toHaveClass("text-muted-foreground");

    // A missing canonical state remains blank; the chip has no legacy-status
    // input and must not recreate a state from a stale lienWaiverStatus value.
    rerender(<WaiverChip status={null} />);
    expect(screen.queryByText("Not required")).not.toBeInTheDocument();
  });

  it("uses persisted bypass state and retains attribution after an unrelated canonical response", () => {
    const canonicalInvoice = {
      status: "bypassed" as const,
      waiverStatus: "bypassed" as const,
      waiverBypassed: true,
      waiverBypassedBy: "approver@example.com",
      waiverBypassedAt: "2026-08-06T12:00:00.000Z",
    };
    const { rerender } = render(<WaiverChip {...canonicalInvoice} />);
    expect(screen.getByLabelText(/Bypassed by approver@example\.com.*\d/)).toBeInTheDocument();

    rerender(<WaiverChip {...canonicalInvoice} />);
    expect(screen.getByLabelText(/Bypassed by approver@example\.com.*\d/)).toBeInTheDocument();
  });
});
