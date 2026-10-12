import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { InvoiceEmailGlance } from "@/modules/accounting/modules/invoices/components/invoices/InvoiceEmailGlance";

const email = {
  from: "sender@example.com",
  subject: "Attached invoice",
  receivedAt: "2026-06-01T12:00:00.000Z",
  bodyPreview: "Please see attached.",
  body: "Full invoice email body",
  bodyContentType: "text" as const,
};

describe("InvoiceEmailGlance", () => {
  it("uses the invoice card treatment while preserving email metadata", () => {
    render(<InvoiceEmailGlance email={email} />);

    const section = screen.getByRole("region", { name: "Invoice email" });
    expect(section).toHaveClass("rounded-xl", "bg-muted/25");
    expect(screen.queryByText("From")).not.toBeInTheDocument();
    expect(screen.queryByText("Received")).not.toBeInTheDocument();
    expect(screen.getByText("sender@example.com")).toBeInTheDocument();
    expect(screen.getByText("Attached invoice")).toBeInTheDocument();
    expect(screen.getByText("Please see attached.")).toBeInTheDocument();
  });

  it("keeps expand-in-place behavior and the existing email body safety boundary", async () => {
    const user = userEvent.setup();
    render(<InvoiceEmailGlance email={email} />);

    await user.click(screen.getByRole("button", { name: /View full email/i }));

    expect(screen.getByText("Full invoice email body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hide full email/i })).toBeInTheDocument();
  });

  it("copies the sender from the compact email header", async () => {
    const user = userEvent.setup();
    render(<InvoiceEmailGlance email={email} />);
    await user.click(screen.getByRole("button", { name: "sender@example.com" }));
    expect(await navigator.clipboard.readText()).toBe(email.from);
    expect(screen.getByText("Copied!")).toBeInTheDocument();
  });
});
