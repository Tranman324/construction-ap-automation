import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  InvoiceAttributeChip,
  InvoiceExceptionMarker,
  InvoiceWaiverChip,
  ReviewPennant,
} from "@/modules/accounting/modules/invoices/components/invoices/renderers/InvoiceMarkerRenderers";

describe("invoice marker renderers", () => {
  it.each([
    ["attached", "Attached"],
    ["required", "Required"],
    ["requested", "Requested"],
    ["bypassed", "Bypassed"],
    ["not-required", "Not required"],
  ] as const)("renders the canonical %s waiver state", (status, label) => {
    render(<InvoiceWaiverChip status={status} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("renders semantic attribute tiers as consistent tinted chips", () => {
    render(<InvoiceAttributeChip label="Required" tone="amber" />);

    expect(screen.getByText("Required")).toHaveClass("border-tone-amber/40", "bg-tone-amber/10");
  });

  it("exposes exception details through an accessible tooltip trigger", async () => {
    const user = userEvent.setup();
    render(<InvoiceExceptionMarker label="Missing vendor" description="Vendor is required for approval" />);

    const marker = screen.getByLabelText("Missing vendor");
    expect(marker).toHaveAttribute("title", "Vendor is required for approval");
    await user.hover(marker);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Vendor is required for approval");
  });

  it("uses the authoritative timestamp and preserves actor/reason detail", () => {
    render(<ReviewPennant flaggedAt="2026-09-03T12:00:00Z" flagReason="Possible duplicate" flaggedBy="reviewer@example.com" />);

    expect(screen.getByRole("button", { name: "Remove review flag" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTitle("Possible duplicate — reviewer@example.com")).toBeInTheDocument();
    const icon = screen.getByRole("button", { name: "Remove review flag" }).querySelector("svg");
    expect(icon).toHaveAttribute("fill", "currentColor");
    expect(icon).toHaveClass("h-[19.2px]", "w-[19.2px]");
  });

  it("does not treat a legacy boolean-only record as flagged", () => {
    render(<ReviewPennant {...({ flagged: true } as unknown as React.ComponentProps<typeof ReviewPennant>)} />);

    expect(screen.getByRole("button", { name: "Flag for review" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Flag for review" }).querySelector("svg")).toHaveAttribute("fill", "none");
  });

  it("passes the toggle event through without owning mutation state", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ReviewPennant onToggle={onToggle} />);

    await user.click(screen.getByRole("button", { name: "Flag for review" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
