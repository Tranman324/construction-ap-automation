import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  cleanEmailPreview,
  DocumentEmailSection,
  prepareDocumentEmailHtmlForFrame,
  sanitizeDocumentEmailHtml,
} from "@/modules/accounting/modules/invoices/components/documents/DocumentEmailSection";
import type { InvoiceEmail } from "@/modules/accounting/modules/invoices/types/invoice";

const email: InvoiceEmail = {
  from: "sender@example.com",
  subject: "Attached invoice",
  receivedAt: "2026-06-01T12:00:00.000Z",
  bodyPreview: "CAUTION: External sender. Open only if this content is safe. Please see attached.",
  body: "Full plain text body",
  bodyContentType: "text",
};

describe("DocumentEmailSection", () => {
  it("renders email metadata and strips caution text from the preview", () => {
    render(<DocumentEmailSection email={email} />);

    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("sender@example.com")).toBeInTheDocument();
    expect(screen.getByText("Attached invoice")).toBeInTheDocument();
    expect(screen.getByText("Please see attached.")).toBeInTheDocument();
    expect(screen.queryByText(/CAUTION/i)).not.toBeInTheDocument();
  });

  it("shows the absolute received date with its relative age", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));

    try {
      render(<DocumentEmailSection email={email} />);
      expect(screen.getByText("June 1, 2026 (24 days ago)")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("expands sanitized HTML email bodies", async () => {
    const user = userEvent.setup();
    render(
      <DocumentEmailSection
        email={{ ...email, bodyContentType: "html" }}
        body={'<p onclick="bad()">Hello</p><script>bad()</script><a href="javascript:bad()">link</a>'}
      />,
    );

    await user.click(screen.getByRole("button", { name: /View full email/i }));

    const frame = screen.getByTitle("Email body");
    expect(frame).toHaveAttribute("srcdoc", '<base target="_blank"><p>Hello</p><a href="#">link</a>');
    expect(frame).toHaveAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
  });

  it("exports deterministic cleanup helpers", () => {
    expect(cleanEmailPreview(email.bodyPreview)).toBe("Please see attached.");
    expect(sanitizeDocumentEmailHtml('<script>x</script><p onload="x">Safe</p>')).toBe("<p>Safe</p>");
    expect(prepareDocumentEmailHtmlForFrame("<html><head></head><body><a href=\"https://example.com\">Open</a></body></html>"))
      .toBe('<html><head><base target="_blank"></head><body><a href="https://example.com">Open</a></body></html>');
  });
});
